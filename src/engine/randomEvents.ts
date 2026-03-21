/** Random event scheduler + event types — pure logic */

export type RandomEventType = 'INTENSITY_SPIKE' | 'FORCED_PAUSE' | 'HOLD_CHALLENGE';

export interface RandomEvent {
  type: RandomEventType;
  startedAt: number;
  durationMs: number;
}

/** 60 seconds minimum between events */
const EVENT_COOLDOWN_MS = 60_000;

/** 0.2% chance per tick when conditions met */
const EVENT_PROBABILITY_PER_TICK = 0.002;

const EVENT_POOL: RandomEventType[] = [
  'INTENSITY_SPIKE',
  'FORCED_PAUSE',
  'HOLD_CHALLENGE',
];

export function shouldTriggerEvent(
  phase: string,
  lastEventAt: number | null,
  currentTimeMs: number,
  activeEvent: RandomEvent | null,
): boolean {
  if (activeEvent !== null) return false;
  if (phase !== 'BUILD' && phase !== 'PLATEAU') return false;
  if (lastEventAt !== null && currentTimeMs - lastEventAt < EVENT_COOLDOWN_MS) return false;
  return Math.random() < EVENT_PROBABILITY_PER_TICK;
}

export function pickRandomEvent(currentTimeMs: number): RandomEvent {
  const type = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)];
  const durationMs = type === 'INTENSITY_SPIKE' ? 3000
    : type === 'FORCED_PAUSE' ? 3000 + Math.random() * 12000  // 3–15s random
    : 10000; // HOLD_CHALLENGE
  return { type, startedAt: currentTimeMs, durationMs };
}

export function isEventExpired(event: RandomEvent, currentTimeMs: number): boolean {
  return currentTimeMs - event.startedAt >= event.durationMs;
}

export function getEventRemainingMs(event: RandomEvent, currentTimeMs: number): number {
  return Math.max(0, event.durationMs - (currentTimeMs - event.startedAt));
}
