import { useRef, useState, useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import {
  computeBassEnergy,
  isBeatDetected,
  updateRollingAverage,
  getRollingAverage,
} from '../engine/beatDetector.ts';

const BEAT_WINDOW_MS = 150;
const ROLLING_WINDOW_SIZE = 30;
const BEAT_THRESHOLD = 1.4;

// ── IndexedDB persistence ─────────────────────────────────────────────────────

const IDB_NAME  = 'ai-video-reel:music';
const IDB_STORE = 'tracks';

interface IDBTrackRecord {
  id:   number;
  name: string;
  file: File;
}

function openMusicDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbLoadAll(): Promise<IDBTrackRecord[]> {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as IDBTrackRecord[]);
    req.onerror   = () => reject(req.error);
  });
}

async function idbAddFile(file: File): Promise<number> {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).add({ name: file.name, file });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror   = () => reject(req.error);
  });
}

async function idbRemove(id: number): Promise<void> {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openMusicDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export interface Track {
  name:   string;
  url:    string;
  idbId?: number;  // set for persisted tracks; absent for tracks not yet saved
}

export interface BeatDetectionControls {
  isBeat: boolean;
  isPlaying: boolean;
  tracks: Track[];
  currentTrackIndex: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  bassEnergyRef: RefObject<number>;
  analyserRef: RefObject<AnalyserNode | null>;
  bpm: number;
  addTracks: (files: FileList | File[]) => void;
  removeTrack: (index: number) => void;
  clearAllTracks: () => void;
  playTrack: (index: number) => void;
  togglePlayback: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  fadeOutAndStop: () => void;
}

export function useBeatDetection(): BeatDetectionControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const sourceCreatedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const historyRef = useRef<number[]>([]);
  const beatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bassEnergyRef = useRef(0);
  const beatTimestampsRef = useRef<number[]>([]);

  // Stable refs so callbacks with [] deps can always read current values
  const tracksRef = useRef<Track[]>([]);
  const currentTrackIndexRef = useRef(0);
  const isPlayingRef = useRef(false);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isBeat, setIsBeat] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(0);

  tracksRef.current = tracks;
  currentTrackIndexRef.current = currentTrackIndex;
  isPlayingRef.current = isPlaying;

  // ── Audio context setup ──────────────────────────────────

  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;
    analyser.connect(ctx.destination);
    audioContextRef.current = ctx;
    analyserRef.current = analyser;
  }, []);

  const ensureSourceConnected = useCallback(() => {
    if (sourceCreatedRef.current) return;
    if (!audioContextRef.current || !analyserRef.current || !audioRef.current) return;
    sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
    sourceNodeRef.current.connect(analyserRef.current);
    sourceCreatedRef.current = true;
  }, []);

  // ── Beat detection rAF loop ──────────────────────────────

  const stopBeatLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startBeatLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const analyser = analyserRef.current;
    const ctx = audioContextRef.current;
    if (!analyser || !ctx) return;

    const freqData = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      analyser!.getByteFrequencyData(freqData);
      const energy = computeBassEnergy(freqData, ctx!.sampleRate, analyser!.fftSize);
      const avg = getRollingAverage(historyRef.current);
      historyRef.current = updateRollingAverage(historyRef.current, energy, ROLLING_WINDOW_SIZE);

      // Update bass energy ref every tick (no re-render)
      bassEnergyRef.current = Math.min(1, energy / Math.max(0.001, avg * 1.5));

      if (isBeatDetected(energy, avg, BEAT_THRESHOLD)) {
        setIsBeat(true);
        if (beatTimeoutRef.current) clearTimeout(beatTimeoutRef.current);
        beatTimeoutRef.current = setTimeout(() => setIsBeat(false), BEAT_WINDOW_MS);

        // BPM tracking via rolling window of beat timestamps
        const now = performance.now();
        beatTimestampsRef.current.push(now);
        if (beatTimestampsRef.current.length > 8) beatTimestampsRef.current.shift();
        if (beatTimestampsRef.current.length >= 4) {
          const intervals: number[] = [];
          for (let i = 1; i < beatTimestampsRef.current.length; i++) {
            intervals.push(beatTimestampsRef.current[i] - beatTimestampsRef.current[i - 1]);
          }
          intervals.sort((a, b) => a - b);
          const median = intervals[Math.floor(intervals.length / 2)];
          setBpm(Math.round(Math.min(200, Math.max(60, 60000 / median))));
        }
      }
    }

    tick();
  }, []);

  // ── Restore persisted playlist on mount ─────────────────

  useEffect(() => {
    idbLoadAll().then(records => {
      if (records.length === 0) return;
      const restored: Track[] = records.map(r => ({
        name:  r.name,
        url:   URL.createObjectURL(r.file),
        idbId: r.id,
      }));
      setTracks(restored);
      ensureAudioContext();
      // Wire up audio pipeline for the first track (don't autoplay)
      setTimeout(() => {
        ensureSourceConnected();
        startBeatLoop();
        if (audioRef.current) {
          audioRef.current.src = restored[0].url;
          audioRef.current.load();
        }
        setCurrentTrackIndex(0);
      }, 0);
    }).catch(() => { /* IDB unavailable — no-op */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  // ── Auto-advance on track end ────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function handleEnded() {
      const list = tracksRef.current;
      if (list.length === 0) return;
      const nextIndex = (currentTrackIndexRef.current + 1) % list.length;
      const next = list[nextIndex];
      if (!next || !audioRef.current) return;
      audioRef.current.src = next.url;
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
      setCurrentTrackIndex(nextIndex);
      // Reset BPM so we detect fresh tempo for the new track
      beatTimestampsRef.current = [];
      setBpm(0);
      // isPlaying stays true — playback continues uninterrupted
    }

    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, []); // mount-only — reads exclusively from refs

  // ── Internal helper: load track src, optionally play ────

  const _loadTrack = useCallback((index: number, autoPlay: boolean) => {
    const track = tracksRef.current[index];
    if (!track || !audioRef.current) return;
    const audio = audioRef.current;
    audio.src = track.url;
    audio.load();
    setCurrentTrackIndex(index);
    // Reset BPM so we detect fresh tempo for the new track
    beatTimestampsRef.current = [];
    setBpm(0);
    if (autoPlay) {
      if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }, []);

  // ── Public API ───────────────────────────────────────────

  const addTracks = useCallback(
    (files: FileList | File[]) => {
      ensureAudioContext();
      const fileArray = Array.from(files);

      const wasEmpty = tracksRef.current.length === 0;

      // Persist to IDB and create blob URLs; update state once all saves complete
      Promise.all(
        fileArray.map(async f => {
          const id = await idbAddFile(f).catch(() => undefined);
          return { name: f.name, url: URL.createObjectURL(f), idbId: id } as Track;
        })
      ).then(newTracks => {
        setTracks(prev => [...prev, ...newTracks]);

        if (wasEmpty && newTracks.length > 0) {
          ensureSourceConnected();
          startBeatLoop();
          if (audioRef.current) {
            audioRef.current.src = newTracks[0].url;
            audioRef.current.load();
          }
          setCurrentTrackIndex(0);
        }
      });
    },
    [ensureAudioContext, ensureSourceConnected, startBeatLoop],
  );

  const removeTrack = useCallback((index: number) => {
    const current = currentTrackIndexRef.current;
    const list = tracksRef.current;
    const wasPlaying = isPlayingRef.current;

    const updated = [...list];
    const removed = updated.splice(index, 1);
    if (removed[0]) {
      URL.revokeObjectURL(removed[0].url);
      if (removed[0].idbId !== undefined) idbRemove(removed[0].idbId).catch(() => {});
    }
    setTracks(updated);

    if (updated.length === 0) {
      // Playlist now empty
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.src = ''; }
      setIsPlaying(false);
      setCurrentTrackIndex(0);
      setIsBeat(false);
      historyRef.current = [];
      if (beatTimeoutRef.current) { clearTimeout(beatTimeoutRef.current); beatTimeoutRef.current = null; }
    } else if (index === current) {
      // Removed the currently loaded track — load adjacent track
      const newIndex = Math.min(current, updated.length - 1);
      const audio = audioRef.current;
      if (audio) {
        audio.src = updated[newIndex].url;
        audio.load();
        if (wasPlaying) audio.play().catch(() => {});
      }
      setCurrentTrackIndex(newIndex);
    } else if (index < current) {
      // Removed a track before current — adjust index without reloading
      setCurrentTrackIndex(current - 1);
    }
  }, []);

  const clearAllTracks = useCallback(() => {
    tracksRef.current.forEach(t => URL.revokeObjectURL(t.url));
    idbClear().catch(() => {});
    setTracks([]);
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ''; }
    stopBeatLoop();
    historyRef.current = [];
    beatTimestampsRef.current = [];
    bassEnergyRef.current = 0;
    if (beatTimeoutRef.current) { clearTimeout(beatTimeoutRef.current); beatTimeoutRef.current = null; }
    setIsPlaying(false);
    setCurrentTrackIndex(0);
    setIsBeat(false);
    setBpm(0);
  }, [stopBeatLoop]);

  const playTrack = useCallback((index: number) => {
    _loadTrack(index, true);
  }, [_loadTrack]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || tracksRef.current.length === 0) return;

    if (audio.paused) {
      if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();
      // If no src set yet, load the current track
      if (!audio.src || audio.src === window.location.href) {
        const track = tracksRef.current[currentTrackIndexRef.current];
        if (track) { audio.src = track.url; audio.load(); }
      }
      audio.play().catch(() => {});
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  const nextTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    _loadTrack((currentTrackIndexRef.current + 1) % list.length, isPlayingRef.current);
  }, [_loadTrack]);

  const prevTrack = useCallback(() => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    _loadTrack((currentTrackIndexRef.current - 1 + list.length) % list.length, isPlayingRef.current);
  }, [_loadTrack]);

  const fadeOutAndStop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const startVolume = audio.volume;
    const STEPS = 40;                        // ~700 ms at 17.5 ms/step
    const INTERVAL_MS = 700 / STEPS;
    let step = 0;
    const id = setInterval(() => {
      step++;
      const a = audioRef.current;
      if (!a) { clearInterval(id); return; }
      a.volume = Math.max(0, startVolume * (1 - step / STEPS));
      if (step >= STEPS) {
        clearInterval(id);
        a.pause();
        a.volume = 1;          // restore for next session
        setIsPlaying(false);
      }
    }, INTERVAL_MS);
  }, []);

  return {
    isBeat,
    isPlaying,
    tracks,
    currentTrackIndex,
    audioRef,
    bassEnergyRef,
    analyserRef,
    bpm,
    addTracks,
    removeTrack,
    clearAllTracks,
    playTrack,
    togglePlayback,
    nextTrack,
    prevTrack,
    fadeOutAndStop,
  };
}
