/** Per-toy pattern transforms — pure functions, no side effects */

export type ToyPattern = 'direct' | 'complement' | 'pulse' | 'rumble' | 'wave' | 'stutter' | 'heartbeat' | 'bracket' | 'tidal' | 'deeptissue' | 'grip';

export const ALL_PATTERNS: ToyPattern[] = ['direct', 'complement', 'pulse', 'rumble', 'wave', 'stutter', 'heartbeat', 'bracket', 'tidal', 'deeptissue', 'grip'];

export const PATTERN_LABELS: Record<ToyPattern, string> = {
  direct: 'Direct',
  complement: 'Complement',
  pulse: 'Pulse',
  rumble: 'Rumble',
  wave: 'Wave',
  stutter: 'Stutter',
  heartbeat: 'Heartbeat',
  bracket: 'Bracket',
  tidal: 'Tidal',
  deeptissue: 'Deep Tissue',
  grip: 'Grip',
};

export const PATTERN_DESCRIPTIONS: Record<ToyPattern, string> = {
  direct: 'Pass-through — follows global intensity',
  complement: 'Phase-shifted wave — interleaves with direct at similar intensity',
  pulse: 'Rhythmic gating that speeds up with intensity',
  rumble: 'Low organic drift with overlapping sine waves',
  wave: 'Smooth undulation over the global curve',
  stutter: 'Irregular micro-interruptions that prevent habituation',
  heartbeat: 'Lub-dub rhythm that accelerates with intensity',
  bracket: 'Rapid oscillation near current intensity on a 600ms cycle',
  tidal: 'Very slow 14-second swell with wide intensity range',
  deeptissue: 'Come-hither p-spot rhythm — 9s rock cycle, self-warming over 20 min, max 60%',
  grip: 'Rhythmic tighten/release — 8s squeeze cycle, valley holds 35%, time-gated over 12 min. Sync pump+vibe for "tighter = more intense" coupling.',
};

/** Type-based default patterns — unlisted types fall back to direct */
export const TOY_TYPE_DEFAULT_PATTERN: Record<string, ToyPattern> = {
  hush: 'deeptissue',
  lush: 'direct',
  nora: 'wave',
  edge: 'complement',
  max: 'complement',
  domi: 'pulse',
  osci: 'wave',
  dolce: 'rumble',
  diamo: 'complement',
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
    case 'complement': {
      // Phase-shifted wave (π offset) — tracks global intensity but oscillates
      // opposite to 'wave', creating interleaving peaks on paired axes
      const raw = globalIntensity + Math.sin(elapsedMs / 4000 + Math.PI) * 4;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'pulse': {
      const periodMs = 2000 - (globalIntensity / ceiling) * 800;
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
      const raw = Math.min(ceiling * 0.5, base + drift);
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'wave': {
      const raw = globalIntensity + Math.sin(elapsedMs / 4000) * 4;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'stutter': {
      // Deterministic pseudo-random gating at human-perceptible rates (~3Hz and ~5Hz).
      // Product of two incommensurable sines creates irregular beating.
      // Gate drops (~25% of time) when product is negative and large in magnitude.
      const chaos = Math.sin(elapsedMs * 0.020) * Math.sin(elapsedMs * 0.031);
      const gate = chaos < -0.2 ? 0.1 : 1.0;
      const raw = globalIntensity * gate;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'heartbeat': {
      const bpm = 60 + (globalIntensity / ceiling) * 90;
      const periodMs = 60000 / bpm;
      const cyclePos = (elapsedMs % periodMs) / periodMs;
      let gate: number;
      if (cyclePos < 0.15) gate = 1.0;           // lub
      else if (cyclePos < 0.20) gate = 0.1;       // gap
      else if (cyclePos < 0.35) gate = 0.7;       // dub
      else gate = 0.1;                            // pause
      const raw = globalIntensity * gate;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'bracket': {
      const raw = globalIntensity - 1.5 + Math.sin((elapsedMs / 600) * 2 * Math.PI) * 1.5;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'tidal': {
      const raw = globalIntensity + Math.sin((elapsedMs / 14000) * 2 * Math.PI) * 6;
      return clampF(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }
    case 'deeptissue': {
      // P-spot / come-hither pattern. Two key principles from physiology:
      //   1. Rhythmic rocking beats sustained pressure — prostate responds to cycles,
      //      not constant intensity. Sustained blasts cause numbness.
      //   2. Very gentle warmup — tissue needs to relax and engorge before any depth.
      //
      // Time-gated ceiling:
      //   0–5 min  : max 3  (barely present — just enough to feel it)
      //   5–20 min : ramp 3 → 60% of ceiling
      //   20 min+  : 60% ceiling (depth over intensity, always)
      const minCap = Math.min(3, ceiling * 0.15);
      const maxCap = ceiling * 0.60;
      const allowedCeiling =
        elapsedMs < 300_000 ? minCap :
        elapsedMs < 1_200_000 ? minCap + ((elapsedMs - 300_000) / 900_000) * (maxCap - minCap) :
        maxCap;
      // Two incommensurable sines (same approach as cooldownPulseRaw) produce an
      // organic, irregular beat — never robotic, drops to near-0 at valleys.
      // Primary: 9s come-hither rock. Secondary: 14.3s modifier (ratio ≈ 0.63, irrational).
      const a = 2.0, b = 1.5;
      const p = Math.sin((elapsedMs / 9000)  * 2 * Math.PI);
      const q = Math.sin((elapsedMs / 14300) * 2 * Math.PI);
      // Normalize combined [-3.5, 3.5] → [0, 1]; valleys reach 0, peaks reach 1
      const normalized = (a * p + b * q + (a + b)) / (2 * (a + b));
      // Envelope: session intensity scales depth, but warmup ceiling gates it hard
      const envelope = Math.min(allowedCeiling, globalIntensity * 0.50);
      const raw = envelope * normalized;
      // No floor — allow full drop to 0; clampF handles float negatives
      return clampF(raw);
    }
    case 'grip': {
      // Rhythmic tighten/release — designed for pressure axes (pump, suction, rotate)
      // coupled with vibrate. When both axes use 'grip' with the same phase, they
      // peak and valley together: tightest squeeze = most intense vibration.
      //
      // Physiology: sustained partial pressure + rhythmic modulation is more
      // effective than constant max. Valley floor at 35% keeps tissue engaged
      // without fully releasing between cycles.
      //
      // Time gate (warms up gradually):
      //   0–3 min  : max 45% ceiling
      //   3–12 min : ramp 45% → 90%
      //   12 min+  : 90% ceiling
      const minCap = ceiling * 0.45;
      const maxCap = ceiling * 0.90;
      const allowedCeiling =
        elapsedMs < 180_000 ? minCap :
        elapsedMs < 720_000 ? minCap + ((elapsedMs - 180_000) / 540_000) * (maxCap - minCap) :
        maxCap;
      // 8s primary squeeze + 13s organic modifier (ratio ≈ 0.615, near golden ratio inverse)
      const a = 2.0, b = 1.0;
      const p = Math.sin((elapsedMs / 8000)  * 2 * Math.PI);
      const q = Math.sin((elapsedMs / 13000) * 2 * Math.PI);
      const normalized = (a * p + b * q + (a + b)) / (2 * (a + b)); // [0, 1]
      const shaped = 0.35 + 0.65 * normalized; // valley at 35%, peak at 100%
      const envelope = Math.min(allowedCeiling, globalIntensity * 0.80);
      const raw = envelope * shaped;
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

    case 'complement': {
      // Phase-shifted wave (π offset) — tracks global intensity but oscillates
      // opposite to 'wave', creating interleaving peaks on paired axes
      const raw = globalIntensity + Math.sin(elapsedMs / 4000 + Math.PI) * 4;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'pulse': {
      // Period shrinks from 2000ms → 1200ms as intensity rises to ceiling
      const periodMs = 2000 - (globalIntensity / ceiling) * 800;
      const cyclePos = (elapsedMs % periodMs) / periodMs;
      const gate = cyclePos < 0.5 ? 1.0 : 0.15;
      const raw = globalIntensity * gate;
      // Floor at 1 when active so pulse never fully stops mid-session
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'rumble': {
      // Compress to 50% of input; two slow sines add ±25% drift; cap at 50% ceiling
      const base = globalIntensity * 0.5;
      const drift =
        Math.sin(elapsedMs / 3000) * ceiling * 0.125 +
        Math.sin(elapsedMs / 7000) * ceiling * 0.125;
      const raw = Math.min(ceiling * 0.5, base + drift);
      // Floor at 1 when active so oscillation never drops to 0 mid-session
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'wave': {
      // +/- 4 levels on a 4s sine cycle; floor at 1 when active
      const raw = globalIntensity + Math.sin(elapsedMs / 4000) * 4;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'stutter': {
      // Deterministic pseudo-random gating at human-perceptible rates (~3Hz and ~5Hz).
      // Gate drops (~25% of time) when product is negative and large in magnitude.
      const chaos = Math.sin(elapsedMs * 0.020) * Math.sin(elapsedMs * 0.031);
      const gate = chaos < -0.2 ? 0.1 : 1.0;
      const raw = globalIntensity * gate;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'heartbeat': {
      const bpm = 60 + (globalIntensity / ceiling) * 90;
      const periodMs = 60000 / bpm;
      const cyclePos = (elapsedMs % periodMs) / periodMs;
      let gate: number;
      if (cyclePos < 0.15) gate = 1.0;
      else if (cyclePos < 0.20) gate = 0.1;
      else if (cyclePos < 0.35) gate = 0.7;
      else gate = 0.1;
      const raw = globalIntensity * gate;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'bracket': {
      const raw = globalIntensity - 1.5 + Math.sin((elapsedMs / 600) * 2 * Math.PI) * 1.5;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'tidal': {
      const raw = globalIntensity + Math.sin((elapsedMs / 14000) * 2 * Math.PI) * 6;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    case 'deeptissue': {
      // P-spot / come-hither pattern. Two key principles from physiology:
      //   1. Rhythmic rocking beats sustained pressure — prostate responds to cycles,
      //      not constant intensity. Sustained blasts cause numbness.
      //   2. Very gentle warmup — tissue needs to relax and engorge before any depth.
      //
      // Time-gated ceiling:
      //   0–5 min  : max 3  (barely present — just enough to feel it)
      //   5–20 min : ramp 3 → 60% of ceiling
      //   20 min+  : 60% ceiling (depth over intensity, always)
      const minCap = Math.min(3, ceiling * 0.15);
      const maxCap = ceiling * 0.60;
      const allowedCeiling =
        elapsedMs < 300_000 ? minCap :
        elapsedMs < 1_200_000 ? minCap + ((elapsedMs - 300_000) / 900_000) * (maxCap - minCap) :
        maxCap;
      // Two incommensurable sines (same approach as cooldownPulseRaw) produce an
      // organic, irregular beat — never robotic, drops to near-0 at valleys.
      // Primary: 9s come-hither rock. Secondary: 14.3s modifier (ratio ≈ 0.63, irrational).
      const a = 2.0, b = 1.5;
      const p = Math.sin((elapsedMs / 9000)  * 2 * Math.PI);
      const q = Math.sin((elapsedMs / 14300) * 2 * Math.PI);
      // Normalize combined [-3.5, 3.5] → [0, 1]; valleys reach 0, peaks reach 1
      const normalized = (a * p + b * q + (a + b)) / (2 * (a + b));
      // Envelope: session intensity scales depth, but warmup ceiling gates it hard
      const envelope = Math.min(allowedCeiling, globalIntensity * 0.50);
      const raw = envelope * normalized;
      // No floor — allow full drop to 0; clamp handles float negatives
      return clamp(raw);
    }

    case 'grip': {
      const minCap = ceiling * 0.45;
      const maxCap = ceiling * 0.90;
      const allowedCeiling =
        elapsedMs < 180_000 ? minCap :
        elapsedMs < 720_000 ? minCap + ((elapsedMs - 180_000) / 540_000) * (maxCap - minCap) :
        maxCap;
      const a = 2.0, b = 1.0;
      const p = Math.sin((elapsedMs / 8000)  * 2 * Math.PI);
      const q = Math.sin((elapsedMs / 13000) * 2 * Math.PI);
      const normalized = (a * p + b * q + (a + b)) / (2 * (a + b));
      const shaped = 0.35 + 0.65 * normalized;
      const envelope = Math.min(allowedCeiling, globalIntensity * 0.80);
      const raw = envelope * shaped;
      return clamp(globalIntensity > 0 ? Math.max(1, raw) : raw);
    }

    default:
      return clamp(globalIntensity);
  }
}
