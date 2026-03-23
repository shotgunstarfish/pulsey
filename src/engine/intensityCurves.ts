/** Intensity curve functions — all pure, return 0-20 integer */

function clampIntensity(value: number): number {
  return Math.max(0, Math.min(20, Math.round(value)));
}

/**
 * Sine ramp: oscillating intensity that rises over time.
 * 4 full oscillations across the duration, floor rises with progress.
 */
export function sineRamp(
  elapsedMs: number,
  durationMs: number,
  floor: number,
  ceiling: number,
): number {
  const progress = Math.min(1, elapsedMs / durationMs);
  const currentFloor = floor + (ceiling - floor) * progress * 0.5;
  const amplitude = (ceiling - currentFloor) * 0.5;
  const oscillation = Math.sin(progress * 4 * 2 * Math.PI);
  // Clamp to floor so oscillation dips never send intensity below the phase minimum
  return clampIntensity(Math.max(floor, currentFloor + oscillation * amplitude));
}

/**
 * Linear ramp: straight line from floor to ceiling.
 */
export function linearRamp(
  elapsedMs: number,
  durationMs: number,
  floor: number,
  ceiling: number,
): number {
  const progress = Math.min(1, elapsedMs / durationMs);
  return clampIntensity(floor + (ceiling - floor) * progress);
}

/**
 * Pulse train: alternates between ceiling and floor.
 * Frequency increases with progress, duty cycle rises with progress.
 */
export function pulseTrain(
  elapsedMs: number,
  durationMs: number,
  floor: number,
  ceiling: number,
): number {
  const progress = Math.min(1, elapsedMs / durationMs);
  // Frequency increases from 0.5 Hz to 4 Hz over duration
  const frequency = 0.5 + progress * 3.5;
  const dutyCycle = 0.3 + progress * 0.5; // 30% → 80%
  const cyclePosition = (elapsedMs / 1000 * frequency) % 1;
  return clampIntensity(cyclePosition < dutyCycle ? ceiling : floor);
}

/**
 * Cooldown recovery pulse: two non-harmonic sine waves whose interference
 * creates naturally varied peaks between 1 and 6. Some pulses peak at 2-3,
 * others reach 5-6 — giving a living, breathing recovery feel.
 * Returns a float in [1, 6] for use with patternBlock (raw) or Math.round() for display.
 */
export function cooldownPulseRaw(elapsedMs: number, durationMs: number): number {
  const t = Math.min(1, elapsedMs / Math.max(1, durationMs));
  const primary   = 2.0 * Math.sin(t * 3.0 * 2 * Math.PI);
  const secondary = 1.5 * Math.sin(t * 4.7 * 2 * Math.PI);
  return Math.max(1, Math.min(6, 3 + primary + secondary));
}

export type CurveType = 'sine' | 'linear' | 'pulse';

export function computeIntensity(
  curve: CurveType,
  elapsedMs: number,
  durationMs: number,
  floor: number,
  ceiling: number,
): number {
  switch (curve) {
    case 'sine':
      return sineRamp(elapsedMs, durationMs, floor, ceiling);
    case 'linear':
      return linearRamp(elapsedMs, durationMs, floor, ceiling);
    case 'pulse':
      return pulseTrain(elapsedMs, durationMs, floor, ceiling);
  }
}

/**
 * Float-precision version of computeIntensity — returns raw float in [0, 20], no rounding.
 * Used by the PatternV2 block generator for 0-100 position scale.
 */
export function computeIntensityRaw(
  curve: CurveType,
  elapsedMs: number,
  durationMs: number,
  floor: number,
  ceiling: number,
): number {
  function clampF(v: number): number {
    return Math.max(0, Math.min(20, v));
  }
  switch (curve) {
    case 'sine': {
      const progress = Math.min(1, elapsedMs / durationMs);
      const currentFloor = floor + (ceiling - floor) * progress * 0.5;
      const amplitude = (ceiling - currentFloor) * 0.5;
      const oscillation = Math.sin(progress * 4 * 2 * Math.PI);
      return clampF(Math.max(floor, currentFloor + oscillation * amplitude));
    }
    case 'linear': {
      const progress = Math.min(1, elapsedMs / durationMs);
      return clampF(floor + (ceiling - floor) * progress);
    }
    case 'pulse': {
      const progress = Math.min(1, elapsedMs / durationMs);
      const frequency = 0.5 + progress * 3.5;
      const dutyCycle = 0.3 + progress * 0.5;
      const cyclePosition = (elapsedMs / 1000 * frequency) % 1;
      return clampF(cyclePosition < dutyCycle ? ceiling : floor);
    }
  }
}
