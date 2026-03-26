/** Curve rating persistence and weighted selection */

import type { CurveType } from './intensityCurves.ts';

const STORAGE_KEY = 'pulse:curve-ratings';

export type CurveRatings = Partial<Record<string, number>>;

// Base weights for each curve — normalized to sum to 1.0
const BASE_WEIGHTS: Record<CurveType, number> = {
  sine:       0.25,
  pulse:      0.20,
  beat:       0.15,
  linear:     0.08,
  staircase:  0.17,
  plateau:    0.15,
};

export function loadCurveRatings(): CurveRatings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: CurveRatings = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

/** Rate a curve +1 or -1 and persist. Returns updated ratings. */
export function rateCurve(curve: CurveType, direction: 1 | -1): CurveRatings {
  const ratings = loadCurveRatings();
  ratings[curve] = (ratings[curve] ?? 0) + direction;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  } catch {
    // localStorage unavailable — still return the updated ratings
  }
  return ratings;
}

/**
 * Pick the next curve using weighted random selection influenced by ratings.
 * Liked curves get higher probability; disliked get lower — but never zero.
 * The current curve gets halved weight to reduce consecutive repeats.
 */
export function pickWeightedCurve(ratings: CurveRatings, currentCurve: CurveType): CurveType {
  const curves = Object.keys(BASE_WEIGHTS) as CurveType[];

  // Compute adjusted weights
  const adjusted: Record<string, number> = {};
  let total = 0;
  for (const curve of curves) {
    const score = Math.max(-5, Math.min(5, ratings[curve] ?? 0));
    const multiplier = 1.0 + score * 0.15;
    // Halve weight for the current curve to reduce repeats
    const repeatPenalty = curve === currentCurve ? 0.5 : 1.0;
    adjusted[curve] = BASE_WEIGHTS[curve] * Math.max(0.2, multiplier) * repeatPenalty;
    total += adjusted[curve];
  }

  // Normalize and pick
  let r = Math.random() * total;
  for (const curve of curves) {
    r -= adjusted[curve];
    if (r <= 0) return curve;
  }
  return curves[0];
}
