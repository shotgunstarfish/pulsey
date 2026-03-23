/**
 * PatternV2 block generator — pre-computes Lovense PatternV2 keyframe arrays
 * from the session machine's intensity curves and toy patterns.
 *
 * One block = 10 seconds of {ts, pos}[] keyframes sampled every 100ms.
 * Position scale is 0-100 (5× finer than the Function command's 0-20).
 * The Lovense firmware interpolates linearly between keyframes.
 */

import type { Phase } from './sessionMachine.ts';
import type { CurveType } from './intensityCurves.ts';
import type { ToyPattern } from './toyPatterns.ts';
import { computeIntensityRaw, cooldownPulseRaw } from './intensityCurves.ts';
import { applyPatternRaw } from './toyPatterns.ts';
import type { RandomEventType } from './randomEvents.ts';

// Mirror of sessionMachine constants (these don't change)
const WARMUP_DURATION              = 10_000;
const BUILD_CEILING                = 18;
const PLATEAU_OSCILLATION_PERIOD   = 9_000;
const RELEASE_DURATION             = 10_000;

export const PATTERN_BLOCK_DURATION = 10_000; // ms per block
const SAMPLE_INTERVAL               = 100;    // ms between keyframes

// ── Types ────────────────────────────────────────────────────────────────────

export interface PatternKeyframe {
  ts:  number;  // ms from block start (0-based)
  pos: number;  // vibration position 0-100
}

export interface PatternBlock {
  keyframes:              PatternKeyframe[];
  durationMs:             number;
  phaseAtStart:           Phase;
  phaseElapsedAtStart:    number;
  sessionElapsedAtStart:  number;
  bpm:                    number;
  // Generation inputs — compared each RAF frame to detect when to regenerate
  buildFloorAtGeneration:  number;
  eventTypeAtGeneration:   RandomEventType | null;
}

export interface BlockGenParams {
  // Phase context
  phase:             Phase;
  phaseElapsedMs:    number;   // phase-relative elapsed at block start
  sessionElapsedMs:  number;   // session-total elapsed at block start
  buildFloor:        number;
  buildDuration:     number;
  cooldownDuration:  number;
  currentCurve:      CurveType;
  currentIntensity:  number;   // for hold-phases (EDGE_CHECK, DECISION)

  // Active random event to apply at the start of the block (if any)
  activeEvent: { type: RandomEventType; remainingMs: number } | null;

  // Per-toy params
  toyPattern:     ToyPattern;
  intensityScale: number;      // 0.0 – 2.0

  // Music: 0 = no beat pulses
  bpm: number;

  // Override block duration (defaults to PATTERN_BLOCK_DURATION)
  blockDurationMs?: number;
}

// ── Phase intensity (mirrors sessionMachine TICK logic exactly) ──────────────

function computePhaseIntensityRaw(params: BlockGenParams, phaseElapsed: number): number {
  switch (params.phase) {
    case 'WARMUP':
      return computeIntensityRaw('linear', phaseElapsed, WARMUP_DURATION, 1, params.buildFloor);

    case 'BUILD':
      return computeIntensityRaw(params.currentCurve, phaseElapsed, params.buildDuration, params.buildFloor, BUILD_CEILING);

    case 'PLATEAU':
      return computeIntensityRaw('sine', phaseElapsed % PLATEAU_OSCILLATION_PERIOD, PLATEAU_OSCILLATION_PERIOD, 15, BUILD_CEILING);

    case 'COOLDOWN':
      return cooldownPulseRaw(phaseElapsed, params.cooldownDuration);

    case 'RELEASE': {
      const halfway = RELEASE_DURATION / 2;
      if (phaseElapsed < halfway) return 20;
      return computeIntensityRaw('linear', phaseElapsed - halfway, halfway, 20, 0);
    }

    default:
      // EDGE_CHECK, DECISION, PAUSED — hold current intensity
      return params.currentIntensity;
  }
}

// ── Beat pulse baking ────────────────────────────────────────────────────────

function bakeBeatPulses(
  keyframes: PatternKeyframe[],
  bpm: number,
  blockDurationMs: number,
): PatternKeyframe[] {
  if (bpm <= 0) return keyframes;

  const beatIntervalMs = 60_000 / bpm;
  const result = keyframes.map(kf => ({ ...kf }));

  for (let beatMs = 0; beatMs < blockDurationMs; beatMs += beatIntervalMs) {
    // Snap to nearest 100ms grid point
    const snapTs = Math.round(beatMs / SAMPLE_INTERVAL) * SAMPLE_INTERVAL;
    const kf = result.find(k => k.ts === snapTs);
    if (kf) {
      // +15 pos ≈ +3 on 0-20 scale — same as BEAT_NUDGE boost
      kf.pos = Math.min(100, kf.pos + 15);
    }
  }

  return result;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a PatternV2 block of keyframes for a single toy.
 *
 * Samples the phase intensity curve at 100ms resolution, applies the toy's
 * pattern transform and intensity scale, bakes in BPM-timed beat pulses,
 * and applies any currently active random event (FORCED_PAUSE / INTENSITY_SPIKE).
 */
export function generateBlock(params: BlockGenParams): PatternBlock {
  const duration = params.blockDurationMs ?? PATTERN_BLOCK_DURATION;
  const keyframes: PatternKeyframe[] = [];

  for (let t = 0; t < duration; t += SAMPLE_INTERVAL) {
    const phaseElapsed   = params.phaseElapsedMs + t;
    const sessionElapsed = params.sessionElapsedMs + t;

    // 1. Base intensity from phase curve
    let raw = computePhaseIntensityRaw(params, phaseElapsed);

    // 2. Active random event modifier (for the remaining event duration)
    const inEvent = params.activeEvent !== null && t < params.activeEvent.remainingMs;
    const isForcedPause = inEvent && params.activeEvent!.type === 'FORCED_PAUSE';
    if (inEvent && params.activeEvent!.type === 'INTENSITY_SPIKE') {
      raw = Math.min(20, raw + 5);
    }
    // HOLD_CHALLENGE: no intensity change, holds the curve value
    // FORCED_PAUSE: raw left as-is here; pos forced to 0 after transforms (see below)

    // 3. Apply per-toy pattern transform
    const patterned = applyPatternRaw(params.toyPattern, raw, sessionElapsed, params.buildFloor, 20);

    // 4. Scale by intensityScale
    const scaled = patterned * params.intensityScale;

    // 5. Convert to 0-100 PatternV2 position (float → integer)
    //    FORCED_PAUSE: force to 0 *after* transforms — rumble/wave patterns add
    //    sine drift on top of raw=0 that can produce non-zero positions otherwise.
    const pos = isForcedPause
      ? 0
      : Math.max(0, Math.min(100, Math.round((scaled / 20) * 100)));

    keyframes.push({ ts: t, pos });
  }

  const finalKeyframes = params.bpm > 0
    ? bakeBeatPulses(keyframes, params.bpm, duration)
    : keyframes;

  return {
    keyframes:             finalKeyframes,
    durationMs:            duration,
    phaseAtStart:          params.phase,
    phaseElapsedAtStart:   params.phaseElapsedMs,
    sessionElapsedAtStart: params.sessionElapsedMs,
    bpm:                   params.bpm,
    buildFloorAtGeneration: params.buildFloor,
    eventTypeAtGeneration:  params.activeEvent?.type ?? null,
  };
}

/**
 * Linearly interpolate the vibration position within a block at the given
 * playback offset. Used by the RAF loop to drive the display in sync with
 * what the device firmware is executing.
 *
 * Returns pos in 0-100.
 */
export function interpolateBlockAt(block: PatternBlock, offsetMs: number): number {
  const kfs = block.keyframes;
  if (kfs.length === 0) return 0;
  if (offsetMs <= kfs[0].ts) return kfs[0].pos;

  const last = kfs[kfs.length - 1];
  if (offsetMs >= last.ts) return last.pos;

  // Binary search for the surrounding pair
  let lo = 0, hi = kfs.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].ts <= offsetMs) lo = mid;
    else hi = mid;
  }

  const a = kfs[lo];
  const b = kfs[hi];
  const t = (offsetMs - a.ts) / (b.ts - a.ts);
  return a.pos + t * (b.pos - a.pos);
}

/**
 * Convert a 0-100 PatternV2 position back to a 0-20 display intensity.
 */
export function posToIntensity(pos: number): number {
  return Math.round(pos / 5);
}
