/** localStorage read/write helpers for session history — pure data layer */

const STORAGE_KEY = 'edging-session-history';

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  edgeCount: number;
  outcome: 'release' | 'stopped';
}

export function loadHistory(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionRecord[];
  } catch {
    return [];
  }
}

export function saveSession(record: SessionRecord): void {
  const history = loadHistory();
  history.unshift(record);
  // Keep last 100 sessions
  const trimmed = history.slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
