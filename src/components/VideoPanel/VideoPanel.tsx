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

/** Load a video at a random seek position; calls onReady() just before play starts. */
function loadVideoRandom(video: HTMLVideoElement, url: string, onReady?: () => void) {
  video.src = url;
  video.load();
  const onMeta = () => {
    video.removeEventListener('loadedmetadata', onMeta);
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
}

const BADGE_LABELS: Record<VideoCategory, string> = {
  low: 'LOW',
  medium: 'MED',
  intense: 'INTENSE',
};

export function VideoPanel({ playlist, phase, intensity, isBeat = false }: VideoPanelProps) {
  const [fitContain, setFitContain] = useState(false);
  const rawCategory = getCategoryForSession(phase, intensity);

  // Debounce category changes so rapid intensity oscillation doesn't cause constant cuts
  const [stableCategory, setStableCategory] = useState<VideoCategory>(rawCategory);
  const pendingCategoryRef = useRef<VideoCategory | null>(null);
  const categoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rawCategory === stableCategory) {
      // Cancelled — came back to current, clear any pending switch
      if (categoryTimerRef.current) {
        clearTimeout(categoryTimerRef.current);
        categoryTimerRef.current = null;
        pendingCategoryRef.current = null;
      }
      return;
    }
    // Already pending this same change — do nothing
    if (pendingCategoryRef.current === rawCategory) return;

    // Start debounce for new target category
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

  // Per-category: which video is currently playing
  const currentIdxRef = useRef<Record<VideoCategory, number>>({ low: 0, medium: 0, intense: 0 });
  // Per-category: shuffled queue of upcoming video indices (no-repeat deck)
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

  // Track which video element (0 or 1) is "active" for crossfade
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const prevCategoryRef = useRef<VideoCategory>(currentCategory);

  // Resolve current video URL for a category
  const getVideoUrl = useCallback(
    (category: VideoCategory): string | null => {
      const list = playlist[category];
      if (list.length === 0) return null;
      return list[currentIdxRef.current[category] % list.length].url;
    },
    [playlist],
  );

  // Advance to next video using the no-repeat shuffle deck
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

  // When category changes, crossfade to the new category's current video
  useEffect(() => {
    if (currentCategory === prevCategoryRef.current && categoryVideos.length > 0) return;
    prevCategoryRef.current = currentCategory;

    const url = getVideoUrl(currentCategory);
    if (!url) return;

    const nextSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;
    const nextVideo = videoRefs[nextSlot].current;
    if (nextVideo) {
      loadVideoRandom(nextVideo, url);
    }
    setActiveSlot(nextSlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategory, categoryVideos.length]);

  // On initial mount, load active slot
  useEffect(() => {
    const url = getVideoUrl(currentCategory);
    if (!url) return;
    const video = videoRefs[activeSlot].current;
    if (video && !video.src) {
      loadVideoRandom(video, url);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle video ended: crossfade into the other slot once the new video is ready
  const handleEnded = useCallback(
    (slot: 0 | 1) => {
      if (slot !== activeSlot) return;

      advanceIndex(currentCategory);
      const url = getVideoUrl(currentCategory);
      if (!url) return;

      const nextSlot: 0 | 1 = slot === 0 ? 1 : 0;
      const nextVideo = videoRefs[nextSlot].current;
      if (nextVideo) {
        loadVideoRandom(nextVideo, url, () => setActiveSlot(nextSlot));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSlot, currentCategory, advanceIndex, getVideoUrl],
  );

  const wrapperClass = `${styles.wrapper}${isBeat ? ` ${styles.wrapperBeat}` : ''}`;
  const videoClass = (slot: 0 | 1) =>
    `${styles.video}${fitContain ? ` ${styles.videoContain}` : ''} ${activeSlot === slot ? styles.videoVisible : styles.videoHidden}`;

  if (categoryVideos.length === 0) {
    return (
      <div className={wrapperClass} data-category={currentCategory}>
        <span className={styles.badge} data-category={currentCategory}>
          {BADGE_LABELS[currentCategory]}
        </span>
        <div className={styles.placeholder}>
          No {currentCategory} videos — add some in Playlist
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass} data-category={currentCategory}>
      <span className={styles.badge} data-category={currentCategory}>
        {BADGE_LABELS[currentCategory]}
      </span>
      <video
        ref={videoRefs[0]}
        className={videoClass(0)}
        autoPlay
        muted
        playsInline
        onEnded={() => handleEnded(0)}
      />
      <video
        ref={videoRefs[1]}
        className={videoClass(1)}
        autoPlay
        muted
        playsInline
        onEnded={() => handleEnded(1)}
      />
      <button
        className={styles.fitToggle}
        onClick={() => setFitContain(f => !f)}
        title={fitContain ? 'Switch to fill (crop)' : 'Switch to fit (show all)'}
      >
        {fitContain ? 'CROP' : 'FIT'}
      </button>
    </div>
  );
}
