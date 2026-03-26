/** Multi-axis pattern preset library — combines per-axis patterns into named presets */

import type { ToyPattern } from './toyPatterns.ts';
import type { ToyFunction } from './toyCapabilities.ts';
import { getCapabilities } from './toyCapabilities.ts';

export interface AxisConfig {
  pattern: ToyPattern;
  /** Scale factor applied to this axis (0.0-1.0) */
  intensityScale: number;
  /** Offset added to elapsedMs for counter/alternating effects */
  phaseOffsetMs: number;
}

export interface PatternPreset {
  id: string;
  name: string;
  description: string;
  /** Sorted canonical list of functions this preset targets */
  forFunctions: ToyFunction[];
  /** Per-axis config — keys are ToyFunction values */
  axes: Partial<Record<ToyFunction, AxisConfig>>;
}

function axis(pattern: ToyPattern, intensityScale = 1.0, phaseOffsetMs = 0): AxisConfig {
  return { pattern, intensityScale, phaseOffsetMs };
}

// ── Single vibrate presets ─────────────────────────────────────────────────

const VIBE_PRESETS: PatternPreset[] = [
  {
    id: 'vibe-direct',
    name: 'Direct',
    description: 'Pass-through — follows global intensity',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('direct') },
  },
  {
    id: 'vibe-complement',
    name: 'Complement',
    description: 'Phase-shifted wave — interleaves with other axes',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('complement') },
  },
  {
    id: 'vibe-pulse',
    name: 'Pulse',
    description: 'Rhythmic gating that speeds up with intensity',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('pulse') },
  },
  {
    id: 'vibe-rumble',
    name: 'Rumble',
    description: 'Low organic drift with overlapping sine waves',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('rumble') },
  },
  {
    id: 'vibe-wave',
    name: 'Wave',
    description: 'Smooth undulation over the global curve',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('wave') },
  },
  {
    id: 'vibe-stutter',
    name: 'Stutter',
    description: 'Irregular micro-interruptions that prevent habituation',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('stutter') },
  },
  {
    id: 'vibe-heartbeat',
    name: 'Heartbeat',
    description: 'Lub-dub rhythm that accelerates with intensity',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('heartbeat') },
  },
  {
    id: 'vibe-bracket',
    name: 'Bracket',
    description: 'Rapid oscillation near current intensity on a 600ms cycle',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('bracket') },
  },
  {
    id: 'vibe-tidal',
    name: 'Tidal',
    description: 'Very slow 14-second swell with wide intensity range',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('tidal') },
  },
  {
    id: 'vibe-deeptissue',
    name: 'Deep Tissue',
    description: 'Self-warming p-spot pattern — gentle ramp over 15 min, slow organic drift',
    forFunctions: ['vibrate'],
    axes: { vibrate: axis('deeptissue') },
  },
];

// ── Oscillate presets (Osci) ───────────────────────────────────────────────

const OSCI_PRESETS: PatternPreset[] = [
  {
    id: 'osci-direct',
    name: 'Direct',
    description: 'Pass-through oscillation',
    forFunctions: ['oscillate'],
    axes: { oscillate: axis('direct') },
  },
  {
    id: 'osci-wave',
    name: 'Wave',
    description: 'Smooth oscillation wave',
    forFunctions: ['oscillate'],
    axes: { oscillate: axis('wave') },
  },
  {
    id: 'osci-pulse',
    name: 'Pulse',
    description: 'Pulsing oscillation',
    forFunctions: ['oscillate'],
    axes: { oscillate: axis('pulse') },
  },
  {
    id: 'osci-rumble',
    name: 'Rumble',
    description: 'Low drift oscillation',
    forFunctions: ['oscillate'],
    axes: { oscillate: axis('rumble') },
  },
];

// ── Nora (vibrate + rotate) ───────────────────────────────────────────────

const NORA_PRESETS: PatternPreset[] = [
  {
    id: 'nora-sync',
    name: 'Sync',
    description: 'Both axes follow global intensity',
    forFunctions: ['rotate', 'vibrate'],
    axes: { vibrate: axis('direct'), rotate: axis('direct') },
  },
  {
    id: 'nora-counter',
    name: 'Counter',
    description: 'Vibrate and rotate interleave — peaks offset by half cycle',
    forFunctions: ['rotate', 'vibrate'],
    axes: { vibrate: axis('direct'), rotate: axis('complement') },
  },
  {
    id: 'nora-wave-spin',
    name: 'Wave Spin',
    description: 'Wave vibration with phased rumble rotation',
    forFunctions: ['rotate', 'vibrate'],
    axes: { vibrate: axis('wave'), rotate: axis('rumble', 1.0, 2000) },
  },
  {
    id: 'nora-anchor',
    name: 'Anchor',
    description: 'Steady rumble rotation as a base; stutter vibration on top',
    forFunctions: ['rotate', 'vibrate'],
    axes: { rotate: axis('rumble', 0.7), vibrate: axis('stutter') },
  },
  {
    id: 'nora-grip',
    name: 'Grip',
    description: 'Rotation and vibration share the same 8s grip rhythm — rotation peaks with vibe. Time-gated warm-up over 12 min.',
    forFunctions: ['rotate', 'vibrate'],
    axes: { rotate: axis('grip'), vibrate: axis('grip') },
  },
];

// ── Edge / Dolce (vibrate + vibrate2) ──────────────────────────────────────

const DUAL_PRESETS: PatternPreset[] = [
  {
    id: 'dual-sync',
    name: 'Sync',
    description: 'Both motors follow global intensity',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('direct'), vibrate2: axis('direct') },
  },
  {
    id: 'dual-split',
    name: 'Split',
    description: 'Motors interleave — one peaks while the other troughs',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('direct'), vibrate2: axis('complement') },
  },
  {
    id: 'dual-wave-alt',
    name: 'Wave Alt',
    description: 'Both motors wave, offset for alternating peaks',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('wave'), vibrate2: axis('wave', 1.0, 4000) },
  },
  {
    id: 'dual-rumble',
    name: 'Rumble',
    description: 'Both motors rumble together',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('rumble'), vibrate2: axis('rumble') },
  },
  {
    id: 'dual-cascade',
    name: 'Cascade',
    description: 'Both motors wave with staggered phase — energy flows between them',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('wave'), vibrate2: axis('wave', 1.0, 6000) },
  },
  {
    id: 'dual-grip',
    name: 'Grip',
    description: 'Motor 1 holds steady while motor 2 pulses against it',
    forFunctions: ['vibrate', 'vibrate2'],
    axes: { vibrate: axis('direct'), vibrate2: axis('pulse') },
  },
];

// ── Max (vibrate + pump) ──────────────────────────────────────────────────

const MAX_PRESETS: PatternPreset[] = [
  {
    id: 'max-squeeze',
    name: 'Squeeze',
    description: 'Direct vibration with pulsing pump',
    forFunctions: ['pump', 'vibrate'],
    axes: { vibrate: axis('direct'), pump: axis('pulse') },
  },
  {
    id: 'max-match',
    name: 'Match',
    description: 'Both axes follow global intensity',
    forFunctions: ['pump', 'vibrate'],
    axes: { vibrate: axis('direct'), pump: axis('direct') },
  },
  {
    id: 'max-wave-pump',
    name: 'Wave Pump',
    description: 'Wave vibration with rumble pump',
    forFunctions: ['pump', 'vibrate'],
    axes: { vibrate: axis('wave'), pump: axis('rumble') },
  },
  {
    id: 'max-edge-pump',
    name: 'Edge Pump',
    description: 'Bracket vibration holds near edge; pump pulses against it',
    forFunctions: ['pump', 'vibrate'],
    axes: { vibrate: axis('bracket'), pump: axis('pulse', 0.6) },
  },
  {
    id: 'max-tighten',
    name: 'Tighten',
    description: 'Pump and vibe share the same 8s grip rhythm — tightest squeeze = peak vibration. Time-gated warm-up over 12 min.',
    forFunctions: ['pump', 'vibrate'],
    axes: { pump: axis('grip'), vibrate: axis('grip') },
  },
];

// ── Gravity / Vulse (vibrate + thrusting) ─────────────────────────────────

const THRUST_PRESETS: PatternPreset[] = [
  {
    id: 'thrust-sync',
    name: 'Sync',
    description: 'Both axes follow global intensity',
    forFunctions: ['thrusting', 'vibrate'],
    axes: { vibrate: axis('direct'), thrusting: axis('direct') },
  },
  {
    id: 'thrust-lead',
    name: 'Lead',
    description: 'Thrusting leads, vibration complements',
    forFunctions: ['thrusting', 'vibrate'],
    axes: { vibrate: axis('complement'), thrusting: axis('direct') },
  },
  {
    id: 'thrust-wave',
    name: 'Wave',
    description: 'Both axes wave together',
    forFunctions: ['thrusting', 'vibrate'],
    axes: { vibrate: axis('wave'), thrusting: axis('wave') },
  },
];

// ── Flexer (vibrate + fingering) ──────────────────────────────────────────

const FLEX_PRESETS: PatternPreset[] = [
  {
    id: 'flex-sync',
    name: 'Sync',
    description: 'Both axes follow global intensity',
    forFunctions: ['fingering', 'vibrate'],
    axes: { vibrate: axis('direct'), fingering: axis('direct') },
  },
  {
    id: 'flex-tease',
    name: 'Tease',
    description: 'Wave vibration with pulsing fingers',
    forFunctions: ['fingering', 'vibrate'],
    axes: { vibrate: axis('wave'), fingering: axis('pulse') },
  },
];

// ── Tenera (suction + vibrate) ────────────────────────────────────────────

const TENERA_PRESETS: PatternPreset[] = [
  {
    id: 'tenera-sync',
    name: 'Sync',
    description: 'Both axes follow global intensity',
    forFunctions: ['suction', 'vibrate'],
    axes: { suction: axis('direct'), vibrate: axis('direct') },
  },
  {
    id: 'tenera-tease',
    name: 'Tease',
    description: 'Pulsing suction with wave vibration',
    forFunctions: ['suction', 'vibrate'],
    axes: { suction: axis('pulse'), vibrate: axis('wave') },
  },
  {
    id: 'tenera-deep',
    name: 'Deep',
    description: 'Rumble suction with complement vibration',
    forFunctions: ['suction', 'vibrate'],
    axes: { suction: axis('rumble'), vibrate: axis('complement') },
  },
  {
    id: 'tenera-grip',
    name: 'Grip',
    description: 'Suction and vibe share the same 8s grip rhythm — suction peaks with vibration. Time-gated warm-up over 12 min.',
    forFunctions: ['suction', 'vibrate'],
    axes: { suction: axis('grip'), vibrate: axis('grip') },
  },
];

// ── Solace (depth + oscillate) ────────────────────────────────────────────

const SOLACE_PRESETS: PatternPreset[] = [
  {
    id: 'solace-sync',
    name: 'Sync',
    description: 'Both axes follow global intensity',
    forFunctions: ['depth', 'oscillate'],
    axes: { depth: axis('direct'), oscillate: axis('direct') },
  },
  {
    id: 'solace-wave',
    name: 'Wave',
    description: 'Direct depth with wave oscillation',
    forFunctions: ['depth', 'oscillate'],
    axes: { depth: axis('direct'), oscillate: axis('wave') },
  },
];

// ── All presets ────────────────────────────────────────────────────────────

const ALL_PRESETS: PatternPreset[] = [
  ...VIBE_PRESETS,
  ...OSCI_PRESETS,
  ...NORA_PRESETS,
  ...DUAL_PRESETS,
  ...MAX_PRESETS,
  ...THRUST_PRESETS,
  ...FLEX_PRESETS,
  ...TENERA_PRESETS,
  ...SOLACE_PRESETS,
];

const PRESET_BY_ID = new Map<string, PatternPreset>(ALL_PRESETS.map(p => [p.id, p]));

/** Canonical key for a sorted function list */
function capsKey(caps: ToyFunction[]): string {
  return [...caps].sort().join(',');
}

/** Index: sorted-capabilities-key -> presets */
const PRESETS_BY_CAPS = new Map<string, PatternPreset[]>();
for (const preset of ALL_PRESETS) {
  const key = capsKey(preset.forFunctions);
  const list = PRESETS_BY_CAPS.get(key);
  if (list) {
    list.push(preset);
  } else {
    PRESETS_BY_CAPS.set(key, [preset]);
  }
}

/** Canonical key for a sorted function list (exported for Pattern Library). */
export function capabilityKey(caps: ToyFunction[]): string {
  return capsKey(caps);
}

/** Returns all preset groups indexed by capability key. */
export function getAllPresetGroups(): Map<string, PatternPreset[]> {
  return new Map(PRESETS_BY_CAPS);
}

/** Get all presets that match a toy's capability class. */
export function getPresetsForToy(toyType: string | null | undefined): PatternPreset[] {
  const caps = getCapabilities(toyType);
  return PRESETS_BY_CAPS.get(capsKey(caps)) ?? VIBE_PRESETS;
}

/** Look up a preset by ID. */
export function getPresetById(id: string): PatternPreset | undefined {
  return PRESET_BY_ID.get(id);
}

/**
 * Smart default preset for a toy type.
 * Tuned per toy for the best out-of-box experience.
 */
export function getDefaultPreset(toyType: string | null | undefined): PatternPreset {
  const key = (toyType ?? '').toLowerCase();
  switch (key) {
    case 'nora':
      return PRESET_BY_ID.get('nora-counter')!;
    case 'edge':
    case 'edge2':
    case 'dolce':
      return PRESET_BY_ID.get('dual-split')!;
    case 'max':
    case 'max2':
      return PRESET_BY_ID.get('max-tighten')!;
    case 'osci':
    case 'osci2':
    case 'osci3':
      return PRESET_BY_ID.get('osci-wave')!;
    case 'gravity':
    case 'vulse':
    case 'spinel':
      return PRESET_BY_ID.get('thrust-sync')!;
    case 'flexer':
      return PRESET_BY_ID.get('flex-tease')!;
    case 'tenera':
    case 'tenera2':
      return PRESET_BY_ID.get('tenera-tease')!;
    case 'solace':
      return PRESET_BY_ID.get('solace-wave')!;
    case 'hush':
    case 'hush2':
      return PRESET_BY_ID.get('vibe-deeptissue')!;
    case 'lush':
    case 'lush2':
    case 'lush3':
    case 'lush4':
      return PRESET_BY_ID.get('vibe-direct')!;
    case 'diamo':
      return PRESET_BY_ID.get('vibe-complement')!;
    case 'domi':
    case 'domi2':
    case 'ferri':
    case 'ferri2':
      return PRESET_BY_ID.get('vibe-pulse')!;
    default: {
      // Return first preset for this capability class
      const presets = getPresetsForToy(toyType);
      return presets[0];
    }
  }
}

/** Map a legacy ToyPattern string to a single-axis preset ID for the given toy type. */
export function patternToPresetId(pattern: ToyPattern, toyType?: string | null): string {
  const caps = getCapabilities(toyType);
  const key = capsKey(caps);

  // For single-axis vibrate toys
  if (key === 'vibrate') {
    return `vibe-${pattern}`;
  }

  // For single-axis oscillate toys
  if (key === 'oscillate') {
    // Map vibrate patterns to osci equivalents; complement has no osci equivalent
    switch (pattern) {
      case 'direct':     return 'osci-direct';
      case 'wave':       return 'osci-wave';
      case 'pulse':      return 'osci-pulse';
      case 'rumble':     return 'osci-rumble';
      case 'complement': return 'osci-direct';
      default:           return 'osci-direct';
    }
  }

  // For multi-axis: just use the default preset for the toy type
  return getDefaultPreset(toyType).id;
}
