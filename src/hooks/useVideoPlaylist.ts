/** Manages in-memory video playlist with file:// URLs, categorised by intensity */

import { useState, useEffect, useCallback } from 'react';
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

/** Convert an absolute file path to a file:// URL safe for use in <video src>. */
function pathToUrl(filePath: string): string {
  const forward = filePath.replace(/\\/g, '/');
  return forward.startsWith('/') ? `file://${forward}` : `file:///${forward}`;
}

export function useVideoPlaylist() {
  const [playlist, setPlaylist] = useState<PlaylistStore>(EMPTY_STORE);

  // Load persisted playlist from IndexedDB on mount
  useEffect(() => {
    dbLoadAll().then(entries => {
      if (entries.length === 0) return;
      const store: PlaylistStore = { low: [], medium: [], intense: [] };
      for (const entry of entries) {
        store[entry.category].push({ name: entry.name, url: pathToUrl(entry.path) });
      }
      setPlaylist(store);
    });
  }, []);

  const addFiles = useCallback((files: File[], category: VideoCategory) => {
    const entries: PlaylistEntry[] = [];
    for (const file of files) {
      // Use Electron's webUtils bridge (Electron 32+); falls back to name in web mode
      const getPath = (window as Window & { electronAPI?: { getPathForFile: (f: File) => string } }).electronAPI?.getPathForFile;
      const filePath = getPath ? getPath(file) : file.name;
      const url = pathToUrl(filePath);
      dbSave({ id: makeId(category, file.name), category, name: file.name, path: filePath });
      entries.push({ name: file.name, url });
    }
    setPlaylist(prev => ({
      ...prev,
      [category]: [...prev[category], ...entries],
    }));
  }, []);

  const removeFile = useCallback((category: VideoCategory, index: number) => {
    setPlaylist(prev => {
      const list = prev[category];
      if (index < 0 || index >= list.length) return prev;
      dbDelete(makeId(category, list[index].name));
      return { ...prev, [category]: list.filter((_, i) => i !== index) };
    });
  }, []);

  const moveFile = useCallback((from: VideoCategory, index: number, to: VideoCategory) => {
    if (from === to) return;
    setPlaylist(prev => {
      const fromList = prev[from];
      if (index < 0 || index >= fromList.length) return prev;
      const entry = fromList[index];
      // Path is already in DB — re-key under new category
      dbDelete(makeId(from, entry.name));
      dbLoadAll().then(all => {
        const existing = all.find(e => e.id === makeId(from, entry.name));
        if (existing) dbSave({ ...existing, id: makeId(to, entry.name), category: to });
      });
      return {
        ...prev,
        [from]: fromList.filter((_, i) => i !== index),
        [to]: [...prev[to], entry],
      };
    });
  }, []);

  const clearCategory = useCallback((category: VideoCategory) => {
    dbDeleteCategory(category);
    setPlaylist(prev => ({ ...prev, [category]: [] }));
  }, []);

  const clearAll = useCallback(() => {
    dbClearAll();
    setPlaylist(EMPTY_STORE);
  }, []);

  return { playlist, addFiles, removeFile, moveFile, clearCategory, clearAll };
}
