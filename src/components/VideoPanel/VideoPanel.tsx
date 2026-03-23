import { useRef, useEffect, useState, useCallback } from 'react';
import type { PlaylistStore, VideoCategory } from '../../hooks/useVideoPlaylist.ts';
import { getCategoryForSession } from '../../hooks/useVideoPlaylist.ts';
import styles from './VideoPanel.module.css';

const CATEGORY_DEBOUNCE_MS = 5000;

/** Fisher-Yates shuffle. If avoidFirst is set and length > 1, ensures deck[0] !== avoidFirst. */
function buildDeck(length: number, avoidFirst = -1): number[] {
  if (length === 0) return [];
  const deck = Array.from({ length }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (length > 1 && deck[0] === avoidFirst) {
    const j = Math.floor(Math.random() * (length - 1)) + 1;
    [deck[0], deck[j]] = [deck[j], deck[0]];
  }
  return deck;
}

/**
 * Load a video at a random seek position.
 * onOrientationDetected fires during loadedmetadata (before onReady/seeked).
 * onReady fires just before play() is called.
 */
function loadVideoRandom(
  video: HTMLVideoElement,
  url: string,
  onReady?: () => void,
  onOrientationDetected?: (portrait: boolean) => void,
) {
  video.src = url;
  video.load();
  const onMeta = () => {
    video.removeEventListener('loadedmetadata', onMeta);
    onOrientationDetected?.(video.videoHeight > video.videoWidth);
    if (isFinite(video.duration) && video.duration > 0) {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        onReady?.();
        video.play().catch(() => {});
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.random() * video.duration;
    } else {
      onReady?.();
      video.play().catch(() => {});
    }
  };
  video.addEventListener('loadedmetadata', onMeta);
}

interface VideoPanelProps {
  playlist: PlaylistStore;
  phase: string;
  intensity: number;
  isBeat?: boolean;
  tauntText?: string | null;
}

const BADGE_LABELS: Record<VideoCategory, string> = {
  low: 'LOW',
  medium: 'MED',
  intense: 'INTENSE',
};

/**
 * Layout modes per layer:
 *   single — one video fills the frame
 *   triple — three portrait videos in equal columns
 *   mixed  — landscape fills the background, portrait videos overlay at left/right edges
 */
type LayerMode = 'single' | 'triple' | 'mixed';

export function VideoPanel({ playlist, phase, intensity, isBeat = false, tauntText }: VideoPanelProps) {
  const [fitContain, setFitContain] = useState(true); // auto-adjusted by layout mode
  const rawCategory = getCategoryForSession(phase, intensity);

  // Debounce category changes so rapid intensity oscillation doesn't cause constant cuts
  const [stableCategory, setStableCategory] = useState<VideoCategory>(rawCategory);
  const pendingCategoryRef = useRef<VideoCategory | null>(null);
  const categoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rawCategory === stableCategory) {
      if (categoryTimerRef.current) {
        clearTimeout(categoryTimerRef.current);
        categoryTimerRef.current = null;
        pendingCategoryRef.current = null;
      }
      return;
    }
    if (pendingCategoryRef.current === rawCategory) return;
    if (categoryTimerRef.current) clearTimeout(categoryTimerRef.current);
    pendingCategoryRef.current = rawCategory;
    categoryTimerRef.current = setTimeout(() => {
      setStableCategory(rawCategory);
      pendingCategoryRef.current = null;
      categoryTimerRef.current = null;
    }, CATEGORY_DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCategory]);

  const currentCategory = stableCategory;
  const categoryVideos = playlist[currentCategory];

  // Per-category shuffle deck
  const currentIdxRef = useRef<Record<VideoCategory, number>>({ low: 0, medium: 0, intense: 0 });
  const deckRef = useRef<Record<VideoCategory, number[]>>({ low: [], medium: [], intense: [] });

  // Rebuild decks when playlist sizes change (videos added/removed)
  const prevLengthsRef = useRef<Record<VideoCategory, number>>({ low: 0, medium: 0, intense: 0 });
  (['low', 'medium', 'intense'] as VideoCategory[]).forEach(cat => {
    const newLen = playlist[cat].length;
    if (newLen !== prevLengthsRef.current[cat]) {
      prevLengthsRef.current[cat] = newLen;
      deckRef.current[cat] = [];
      currentIdxRef.current[cat] = Math.floor(Math.random() * Math.max(newLen, 1));
    }
  });

  // ── Layer crossfade system ─────────────────────────────────────────────────
  //
  // Two layers (slot 0 and 1). Active slot is visible; inactive is preloaded
  // and crossfaded in on transition.
  //
  // When category has 3+ videos, all 3 lanes are always loaded. After all three
  // loadedmetadata events fire, orientations are counted to choose layout:
  //   3 portrait              → 'triple' (equal columns)
  //   1 landscape + 2 portrait → 'mixed'  (landscape bg + portrait overlays)
  //   other                   → 'single' (lane 0 only)
  //
  // All 6 video elements are always in the DOM so refs are always valid.

  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [layerMode, setLayerMode] = useState<[LayerMode, LayerMode]>(['single', 'single']);
  const layerModeRef = useRef<[LayerMode, LayerMode]>(['single', 'single']);

  // For 'mixed' mode: which lane (0|1|2) holds the landscape video per slot
  const [landscapeLane, setLandscapeLane] = useState<[number, number]>([-1, -1]);
  const landscapeLaneRef = useRef<[number, number]>([-1, -1]);

  // For 'mixed' mode: mirror the right portrait when the same video fills both portrait lanes
  const [mirrorRight, setMirrorRight] = useState<[boolean, boolean]>([false, false]);
  const mirrorRightRef = useRef<[boolean, boolean]>([false, false]);

  // layerRefs[slot][lane] — 2 layers × 3 lanes = 6 elements, always mounted
  const layerRefs = [
    [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)],
    [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)],
  ] as const;

  // Auto crop for multi-video layouts, fit for single
  useEffect(() => {
    setFitContain(layerMode[activeSlot] === 'single');
  }, [layerMode, activeSlot]);

  const prevCategoryRef = useRef<VideoCategory>(currentCategory);

  const getVideoUrl = useCallback(
    (category: VideoCategory): string | null => {
      const list = playlist[category];
      if (list.length === 0) return null;
      return list[currentIdxRef.current[category] % list.length].url;
    },
    [playlist],
  );

  const advanceIndex = useCallback(
    (category: VideoCategory) => {
      const list = playlist[category];
      if (list.length === 0) return;
      if (deckRef.current[category].length === 0) {
        deckRef.current[category] = buildDeck(list.length, currentIdxRef.current[category]);
      }
      currentIdxRef.current[category] = deckRef.current[category].shift()!;
    },
    [playlist],
  );

  const clearLayer = useCallback(
    (slot: 0 | 1) => {
      for (const ref of layerRefs[slot]) {
        const v = ref.current;
        if (v) { v.pause(); v.src = ''; v.load(); }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Load a layer. When the category has 3+ videos all three lanes are loaded;
   * once all three loadedmetadata events fire the final layout mode is chosen
   * based on the ratio of portrait vs landscape videos detected.
   * onDone is called once all required videos are ready to play.
   */
  const loadLayer = useCallback(
    (inSlot: 0 | 1, firstUrl: string, onDone: () => void) => {
      const list = playlist[currentCategory];
      const canMulti = list.length >= 2;
      const targetCount = canMulti ? 3 : 1;

      let readyCount = 0;
      let metaCount = 0;
      const orientations: (boolean | null)[] = [null, null, null]; // true = portrait

      function onOrientation(lane: number, portrait: boolean) {
        orientations[lane] = portrait;
        metaCount++;
        if (metaCount < targetCount) return; // wait for all orientations

        // All orientations known — choose layout mode
        const portraitCount = orientations.slice(0, targetCount).filter(p => p === true).length;
        let mode: LayerMode;
        let lscape = -1;

        if (!canMulti) {
          mode = 'single';
        } else if (portraitCount === targetCount) {
          mode = 'triple';
        } else if (portraitCount === 2 && targetCount === 3) {
          // 1 landscape + 2 portrait → mixed overlay layout
          mode = 'mixed';
          lscape = orientations.findIndex(p => p === false);
        } else {
          // 0 or 1 portrait — not enough for a multi layout, show lane 0 solo
          mode = 'single';
        }

        // Mirror the right portrait when only 1 unique portrait exists in the category
        // (deck cycling causes lane 0 and lane 2 to share the same URL)
        const mirror = mode === 'mixed' && list.length <= 2;

        const nextMode: [LayerMode, LayerMode] = inSlot === 0
          ? [mode, layerModeRef.current[1]]
          : [layerModeRef.current[0], mode];
        const nextLscape: [number, number] = inSlot === 0
          ? [lscape, landscapeLaneRef.current[1]]
          : [landscapeLaneRef.current[0], lscape];
        const nextMirror: [boolean, boolean] = inSlot === 0
          ? [mirror, mirrorRightRef.current[1]]
          : [mirrorRightRef.current[0], mirror];

        layerModeRef.current = nextMode;
        landscapeLaneRef.current = nextLscape;
        mirrorRightRef.current = nextMirror;
        setLayerMode(nextMode);
        setLandscapeLane(nextLscape);
        setMirrorRight(nextMirror);
      }

      function checkDone() {
        readyCount++;
        if (readyCount >= targetCount) onDone();
      }

      // Always load lane 0
      const firstVideo = layerRefs[inSlot][0].current;
      if (!firstVideo) return;
      loadVideoRandom(firstVideo, firstUrl, checkDone, p => onOrientation(0, p));

      if (canMulti) {
        // Load lanes 1 and 2 regardless of lane 0's orientation
        for (let lane = 1; lane <= 2; lane++) {
          advanceIndex(currentCategory);
          const url = getVideoUrl(currentCategory);
          const el = layerRefs[inSlot][lane].current;
          const l = lane;
          if (url && el) {
            loadVideoRandom(el, url, checkDone, p => onOrientation(l, p));
          } else {
            onOrientation(l, false); // treat as landscape if no video
            checkDone();
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlist, currentCategory, advanceIndex, getVideoUrl],
  );

  // When category changes, crossfade to new category in inactive slot
  useEffect(() => {
    if (currentCategory === prevCategoryRef.current && categoryVideos.length > 0) return;
    prevCategoryRef.current = currentCategory;

    const url = getVideoUrl(currentCategory);
    if (!url) return;

    const nextSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;
    clearLayer(nextSlot);
    loadLayer(nextSlot, url, () => setActiveSlot(nextSlot));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategory, categoryVideos.length]);

  // On mount: load first video into active slot
  useEffect(() => {
    const url = getVideoUrl(currentCategory);
    if (!url) return;
    const video = layerRefs[activeSlot][0].current;
    if (video && !video.src) {
      loadLayer(activeSlot, url, () => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip to next: advance deck and load a fresh layer (with orientation re-detection)
  const handleNext = useCallback(
    () => {
      const nextSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;
      advanceIndex(currentCategory);
      const url = getVideoUrl(currentCategory);
      if (!url) return;
      clearLayer(nextSlot);
      loadLayer(nextSlot, url, () => setActiveSlot(nextSlot));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSlot, currentCategory, advanceIndex, getVideoUrl, loadLayer, clearLayer],
  );

  // Single/mixed video ended: crossfade to next layer (with orientation re-detection)
  const handleEnded = useCallback(
    (slot: 0 | 1) => {
      if (slot !== activeSlot) return;
      if (layerModeRef.current[slot] === 'triple') return; // triple uses handleTripleEnded

      advanceIndex(currentCategory);
      const url = getVideoUrl(currentCategory);
      if (!url) return;

      const nextSlot: 0 | 1 = slot === 0 ? 1 : 0;
      clearLayer(nextSlot);
      loadLayer(nextSlot, url, () => setActiveSlot(nextSlot));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSlot, currentCategory, advanceIndex, getVideoUrl, loadLayer, clearLayer],
  );

  // Triple-mode lane ended: hard cut reload of just that lane
  const handleTripleEnded = useCallback(
    (slot: 0 | 1, lane: 0 | 1 | 2) => {
      if (slot !== activeSlot) return;
      if (layerModeRef.current[slot] !== 'triple') return;

      advanceIndex(currentCategory);
      const url = getVideoUrl(currentCategory);
      const el = layerRefs[slot][lane].current;
      if (url && el) loadVideoRandom(el, url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSlot, currentCategory, advanceIndex, getVideoUrl],
  );

  // Keep a ref to activeSlot so ducking callbacks always see the current value
  const activeSlotRef = useRef<0 | 1>(0);
  useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot]);

  // ── Occasional audio ducking ────────────────────────────────────────────────
  // Every 30-90 seconds, unmute one playing video for ~10 seconds with fade in/out
  useEffect(() => {
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    let duckHoldTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeInterval: ReturnType<typeof setInterval> | null = null;
    let duckVideo: HTMLVideoElement | null = null;

    const TARGET_VOL = 0.75;
    const FADE_STEPS = 20;
    const FADE_STEP_MS = 50; // 1s total fade

    function stopDucking() {
      if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
      if (duckHoldTimer) { clearTimeout(duckHoldTimer); duckHoldTimer = null; }
      if (duckVideo) {
        duckVideo.volume = 0;
        duckVideo.muted = true;
        duckVideo = null;
      }
    }

    function schedule() {
      const delay = 30_000 + Math.random() * 60_000;
      scheduleTimer = setTimeout(doDuck, delay);
    }

    function doFadeOut() {
      const video = duckVideo;
      if (!video) { schedule(); return; }
      let step = 0;
      fadeInterval = setInterval(() => {
        step++;
        video.volume = Math.max(TARGET_VOL * (1 - step / FADE_STEPS), 0);
        if (step >= FADE_STEPS) {
          if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
          video.muted = true;
          video.volume = 0;
          duckVideo = null;
          schedule();
        }
      }, FADE_STEP_MS);
    }

    function doDuck() {
      const slot = activeSlotRef.current;
      const mode = layerModeRef.current[slot];
      const lanes: number[] = mode === 'single' ? [0] : [0, 1, 2];
      const lane = lanes[Math.floor(Math.random() * lanes.length)] as 0 | 1 | 2;
      const video = layerRefs[slot][lane].current;
      if (!video || !video.src) { schedule(); return; }

      duckVideo = video;
      video.muted = false;
      video.volume = 0;
      let step = 0;
      fadeInterval = setInterval(() => {
        step++;
        video.volume = Math.min((step / FADE_STEPS) * TARGET_VOL, TARGET_VOL);
        if (step >= FADE_STEPS) {
          if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
          duckHoldTimer = setTimeout(doFadeOut, 10_000);
        }
      }, FADE_STEP_MS);
    }

    schedule();
    return () => {
      if (scheduleTimer) clearTimeout(scheduleTimer);
      stopDucking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapperClass = `${styles.wrapper}${isBeat ? ` ${styles.wrapperBeat}` : ''}`;

  if (categoryVideos.length === 0) {
    return (
      <div className={styles.outer}>
        {tauntText && <p className={styles.tauntBelow}>{tauntText}</p>}
        <div className={wrapperClass} data-category={currentCategory}>
          <span className={styles.badge} data-category={currentCategory}>
            {BADGE_LABELS[currentCategory]}
          </span>
          <div className={styles.placeholder}>
            No {currentCategory} videos — add some in Playlist
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.outer}>
    {tauntText && <p className={styles.tauntBelow}>{tauntText}</p>}
    <div className={wrapperClass} data-category={currentCategory}>
      <span className={styles.badge} data-category={currentCategory}>
        {BADGE_LABELS[currentCategory]}
      </span>

      {([0, 1] as const).map(slot => {
        const mode = layerMode[slot];
        const lscape = landscapeLane[slot]; // lane index holding the landscape video (-1 if n/a)

        return (
          <div
            key={slot}
            className={`${styles.layer} ${activeSlot === slot ? styles.videoVisible : styles.videoHidden}`}
          >
            {mode === 'triple' ? (
              // Three portrait videos in equal-width columns
              <div className={styles.tripleRow}>
                {([0, 1, 2] as const).map(lane => (
                  <video
                    key={lane}
                    ref={layerRefs[slot][lane]}
                    className={`${styles.tripleVideo}${fitContain ? ` ${styles.videoContain}` : ''}`}
                    autoPlay muted playsInline
                    onEnded={() => handleTripleEnded(slot, lane)}
                  />
                ))}
              </div>
            ) : mode === 'mixed' ? (
              // Landscape fills full frame; portrait videos overlay at left/right edges
              <div className={styles.singleRow}>
                {([0, 1, 2] as const).map(lane => {
                  const isLandscape = lane === lscape;
                  // Which portrait position is this lane? (0 = left, 1 = right)
                  const portraitLanes = ([0, 1, 2] as const).filter(l => l !== lscape);
                  const portraitPos = portraitLanes.indexOf(lane);
                  const cls = isLandscape
                    ? `${styles.video}${fitContain ? ` ${styles.videoContain}` : ''}`
                    : portraitPos === 0
                      ? `${styles.mixedPortraitLeft}${fitContain ? ` ${styles.videoContain}` : ''}`
                      : `${styles.mixedPortraitRight}${fitContain ? ` ${styles.videoContain}` : ''}`;
                  const shouldMirror = !isLandscape && portraitPos === 1 && mirrorRight[slot];
                  return (
                    <video
                      key={lane}
                      ref={layerRefs[slot][lane]}
                      className={cls}
                      style={shouldMirror ? { transform: 'scaleX(-1)' } : undefined}
                      autoPlay muted playsInline
                      onEnded={() => handleEnded(slot)}
                    />
                  );
                })}
              </div>
            ) : (
              // Single mode: lane 0 fills frame, lanes 1+2 hidden (display:none but refs valid)
              <div className={styles.singleRow}>
                {([0, 1, 2] as const).map(lane => (
                  <video
                    key={lane}
                    ref={layerRefs[slot][lane]}
                    className={`${styles.video}${fitContain ? ` ${styles.videoContain}` : ''}`}
                    style={lane > 0 ? { display: 'none' } : undefined}
                    autoPlay muted playsInline
                    onEnded={() => handleEnded(slot)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button className={styles.nextBtn} onClick={handleNext} title="Skip to next video">
        NEXT ›
      </button>
      <button
        className={styles.fitToggle}
        onClick={() => setFitContain(f => !f)}
        title={fitContain ? 'Switch to fill (crop)' : 'Switch to fit (show all)'}
      >
        {fitContain ? 'FIT' : 'CROP'}
      </button>
    </div>
    </div>
  );
}
