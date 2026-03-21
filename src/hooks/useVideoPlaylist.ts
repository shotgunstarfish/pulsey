/** Manages in-memory video playlist with blob URLs, categorised by intensity */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  dbLoadAll,
  dbSave,
  dbDelete,
  dbDeleteCategory,
  dbClearAll,
  makeId,
} from '../engine/videoPlaylistDB.ts';

export type VideoCategory = 'low' | 'medium' | 'intense';

export interface PlaylistEntry {
  name: string;
  url: string;
}

export interface PlaylistStore {
  low: PlaylistEntry[];
  medium: PlaylistEntry[];
  intense: PlaylistEntry[];
}

const EMPTY_STORE: PlaylistStore = { low: [], medium: [], intense: [] };

/**
 * Pure function: maps session phase + intensity to a video category.
 * Exported standalone so VideoPanel can call it without the hook.
 */
export function getCategoryForSession(phase: string, intensity: number): VideoCategory {
  // Phase overrides
  if (phase === 'IDLE' || phase === 'WARMUP' || phase === 'COOLDOWN' || phase === 'PAUSED') {
    return 'low';
  }
  if (phase === 'RELEASE') {
    return 'intense';
  }

  // Intensity-based
  if (intensity >= 14) return 'intense';
  if (intensity >= 7) return 'medium';
  return 'low';
}

function hasAnyVideos(store: PlaylistStore): boolean {
  return store.low.length > 0 || store.medium.length > 0 || store.intense.length > 0;
}

export { hasAnyVideos };

export function useVideoPlaylist() {
  const [playlist, setPlaylist] = useState<PlaylistStore>(EMPTY_STORE);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Revoke all blob URLs on unmount
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Load persisted playlist from IndexedDB on mount
  useEffect(() => {
    dbLoadAll().then(entries => {
      if (entries.length === 0) return;
      const store: PlaylistStore = { low: [], medium: [], intense: [] };
      for (const entry of entries) {
        const url = URL.createObjectURL(entry.blob);
        blobUrlsRef.current.add(url);
        store[entry.category].push({ name: entry.name, url });
      }
      setPlaylist(store);
    });
  }, []);

  const addFiles = useCallback((files: File[], category: VideoCategory) => {
    const entries: PlaylistEntry[] = files.map(file => {
      const url = URL.createObjectURL(file);
      blobUrlsRef.current.add(url);
      dbSave({ id: makeId(category, file.name), category, name: file.name, blob: file });
      return { name: file.name, url };
    });

    setPlaylist(prev => ({
      ...prev,
      [category]: [...prev[category], ...entries],
    }));
  }, []);

  const removeFile = useCallback((category: VideoCategory, index: number) => {
    setPlaylist(prev => {
      const list = prev[category];
      if (index < 0 || index >= list.length) return prev;

      const entry = list[index];
      URL.revokeObjectURL(entry.url);
      blobUrlsRef.current.delete(entry.url);
      dbDelete(makeId(category, entry.name));

      return {
        ...prev,
        [category]: list.filter((_, i) => i !== index),
      };
    });
  }, []);

  const moveFile = useCallback((from: VideoCategory, index: number, to: VideoCategory) => {
    if (from === to) return;

    setPlaylist(prev => {
      const fromList = prev[from];
      if (index < 0 || index >= fromList.length) return prev;

      const entry = fromList[index];
      // Update DB: delete old category entry, save under new category
      dbDelete(makeId(from, entry.name));
      // We don't have the blob here — but the DB entry already exists under the old category.
      // Re-fetch blob from existing URL isn't possible; we handle this by a DB-level move:
      // load existing blob from DB and re-save under new key.
      dbLoadAll().then(all => {
        const existing = all.find(e => e.id === makeId(from, entry.name));
        if (existing) {
          dbSave({ ...existing, id: makeId(to, entry.name), category: to });
        }
      });

      return {
        ...prev,
        [from]: fromList.filter((_, i) => i !== index),
        [to]: [...prev[to], entry],
      };
    });
  }, []);

  const clearCategory = useCallback((category: VideoCategory) => {
    setPlaylist(prev => {
      for (const entry of prev[category]) {
        URL.revokeObjectURL(entry.url);
        blobUrlsRef.current.delete(entry.url);
      }
      dbDeleteCategory(category);
      return { ...prev, [category]: [] };
    });
  }, []);

  const clearAll = useCallback(() => {
    setPlaylist(prev => {
      for (const cat of ['low', 'medium', 'intense'] as VideoCategory[]) {
        for (const entry of prev[cat]) {
          URL.revokeObjectURL(entry.url);
          blobUrlsRef.current.delete(entry.url);
        }
      }
      dbClearAll();
      return EMPTY_STORE;
    });
  }, []);

  return { playlist, addFiles, removeFile, moveFile, clearCategory, clearAll };
}
