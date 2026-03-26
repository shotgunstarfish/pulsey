/** IndexedDB persistence for the video playlist — stores file paths by category + name */

import type { VideoCategory } from '../hooks/useVideoPlaylist.ts';

const DB_NAME = 'pulse-playlist';
const DB_VERSION = 2;
const STORE = 'videos';

export interface StoredVideo {
  id: string;       // `${category}::${name}`
  category: VideoCategory;
  name: string;
  path: string;     // absolute file path — Electron serves these as file:// URLs
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      // v1 stored blobs — drop and recreate clean for v2 (path-based)
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbLoadAll(): Promise<StoredVideo[]> {
  try {
    const db = await openDB();
    return run<StoredVideo[]>(db, 'readonly', s => s.getAll());
  } catch {
    return [];
  }
}

export async function dbSave(entry: StoredVideo): Promise<void> {
  try {
    const db = await openDB();
    await run(db, 'readwrite', s => s.put(entry));
  } catch {
    // storage quota or private browsing — silently skip
  }
}

export async function dbDelete(id: string): Promise<void> {
  try {
    const db = await openDB();
    await run(db, 'readwrite', s => s.delete(id));
  } catch {}
}

export async function dbDeleteCategory(category: VideoCategory): Promise<void> {
  try {
    const db = await openDB();
    const all = await run<StoredVideo[]>(db, 'readonly', s => s.getAll());
    const db2 = await openDB();
    const tx = db2.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const entry of all) {
      if (entry.category === category) store.delete(entry.id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function dbClearAll(): Promise<void> {
  try {
    const db = await openDB();
    await run(db, 'readwrite', s => s.clear());
  } catch {}
}

export function makeId(category: VideoCategory, name: string): string {
  return `${category}::${name}`;
}
