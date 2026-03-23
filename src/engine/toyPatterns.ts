/** Per-toy pattern transforms — pure functions, no side effects */

export type ToyPattern = 'direct' | 'complement' | 'pulse' | 'rumble' | 'wave';

export const ALL_PATTERNS: ToyPattern[] = ['direct', 'complement', 'pulse', 'rumble', 'wave'];

export const PATTERN_LABELS: Record<ToyPattern, string> = {
  direct: 'Direct',
  complement: 'Complement',
  pulse: 'Pulse',
  rumble: 'Rumble',
  wave: 'Wave',
};

export const PATTERN_DESCRIPTIONS: Record<ToyPattern, string> = {
  direct: 'Pass-through — follows global intensity',
  complement: 'Inverted — high when others are low',
  pulse: 'Rhythmic gating that speeds up with intensity',
  rumble: 'Low organic drift with overlapping sine waves',
  wave: 'Smooth undulation over the global curve',
};

/** Type-based default patterns — unlisted types fall back to direct */
export const TOY_TYPE_DEFAULT_PATTERN: Record<string, ToyPattern> = {
  hush: 'rumble',
  lush: 'direct',
  nora: 'wave',
  edge: 'complement',
  max: 'complement',
  domi: 'pulse',
  osci: 'wave',
  dolce: 'rumble',
  diamo: 'pulse',
  ferri: 'pulse',
  ambi: 'direct',
};

export function defaultPatternForToyType(type: string | undefined | null): ToyPattern {
  return TOY_TYPE_DEFAULT_PATTERN[(type ?? '').toLowerCase()] ?? 'direct';
}

/**
 * Float-precision version of applyPattern — no rounding on output.
 * Used by the PatternV2 block generator for 0-100 position scale.
 */
export function applyPatternRaw(
  pattern: ToyPattern,
  globalIntensity: number,
  elapsedMs: number,
  _floor: number,
  ceiling: number,
): number {
  function clampF(v: number): number {
    return Math.max(0, Math.min(ceiling, v));
  }
  switch (pattern) {
    case 'direct':
      return clampF(globalIntensity);
    case 'complement':
      return globalIntensity === 0 ? 0 : clampF(ceiling - globalIntensity);
    case 'pulse': {
      const periodMs = 2000 - (globalIntensity / ceiling) * 1200;
      const cyclePos = (elapsedMs % periodMs) / periodMs;
      const gate = cyclePos < 0.5 ? 1.0 : 0.15;
      const raw = globalIntensity * gate;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'rumble': {
      const base = globalIntensity * 0.5;
      const drift =
        Math.sin(elapsedMs / 3000) * ceiling * 0.125 +
        Math.sin(elapsedMs / 7000) * ceiling * 0.125;
      return clampF(globalIntensity > 0 ? Math.max(1, base + drift) : base + drift);
    }
    case 'wave': {
      const raw = globalIntensity + Math.sin(elapsedMs / 4000) * 4;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    default:
      return clampF(globalIntensity);
  }
}

/**
 * Apply a per-toy pattern transform to the global intensity.
 * Pure function — returns a value clamped to [0, ceiling].
 */
export function applyPattern(
  pattern: ToyPattern,
  globalIntensity: number,
  elapsedMs: number,
  _floor: number,
  ceiling: number,
): number {
  function clamp(v: number): number {
    return Math.max(0, Math.min(ceiling, Math.round(v)));
  }

  switch (pattern) {
    case 'direct':
      return clamp(globalIntensity);

    case 'complement':
      // Inverted: high when global is low, low when global is high
      // Zero when global is zero so the device stops when the session stops
      return globalIntensity === 0 ? 0 : clamp(ceiling - globalIntensity);

    case 'pulse': {
      // Period shrinks from 2000ms → 800ms as intensity rises to ceiling
      const periodMs = 2000 - (globalIntensity / ceiling) * 1200;
      const cyclePos = (elapsedMs % periodMs) / periodMs;
      const gate = cyclePos < 0.5 ? 1.0 : 0.15;
      const raw = globalIntensity * gate;
      // Floor at 1 when active so pulse never fully stops mid-session
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'rumble': {
      // Compress to 50% of input; two slow sines add ±25% drift
      const base = globalIntensity * 0.5;
      const drift =
        Math.sin(elapsedMs / 3000) * ceiling * 0.125 +
        Math.sin(elapsedMs / 7000) * ceiling * 0.125;
      // Floor at 1 when active so oscillation never drops to 0 mid-session
      return clamp(globalIntensity > 0 ? Math.max(1, base + drift) : base + drift);
    }

    case 'wave': {
      // +/- 4 levels on a 4s sine cycle; floor at 1 when active
      const raw = globalIntensity + Math.sin(elapsedMs / 4000) * 4;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    default:
      return clamp(globalIntensity);
  }
}
