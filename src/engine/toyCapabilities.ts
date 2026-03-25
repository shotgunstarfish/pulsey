/** Toy capability definitions — maps toy types to supported hardware functions */

export type ToyFunction =
  | 'vibrate'
  | 'vibrate2'
  | 'rotate'
  | 'pump'
  | 'thrusting'
  | 'fingering'
  | 'suction'
  | 'oscillate'
  | 'depth';

interface FunctionDef {
  /** Lovense API action name (PascalCase) */
  action: string;
  /** Hardware maximum level (20 for most axes, 3 for pump/depth) */
  maxLevel: number;
}

const FUNCTION_DEFS: Record<ToyFunction, FunctionDef> = {
  vibrate:    { action: 'Vibrate',    maxLevel: 20 },
  vibrate2:   { action: 'Vibrate2',   maxLevel: 20 },
  rotate:     { action: 'Rotate',     maxLevel: 20 },
  pump:       { action: 'Pump',       maxLevel: 3 },
  thrusting:  { action: 'Thrusting',  maxLevel: 20 },
  fingering:  { action: 'Fingering',  maxLevel: 20 },
  suction:    { action: 'Suction',    maxLevel: 20 },
  oscillate:  { action: 'Oscillate',  maxLevel: 20 },
  depth:      { action: 'Depth',      maxLevel: 3 },
};

/**
 * Toy type -> supported functions.
 * Entries are sorted alphabetically by function name for canonical comparison.
 */
const TOY_CAPABILITIES: Record<string, ToyFunction[]> = {
  // Vibrate only
  lush:       ['vibrate'],
  lush2:      ['vibrate'],
  lush3:      ['vibrate'],
  lush4:      ['vibrate'],
  hush:       ['vibrate'],
  hush2:      ['vibrate'],
  ambi:       ['vibrate'],
  ferri:      ['vibrate'],
  ferri2:     ['vibrate'],
  domi:       ['vibrate'],
  domi2:      ['vibrate'],
  diamo:      ['vibrate'],
  gush:       ['vibrate'],
  gush2:      ['vibrate'],
  mission:    ['vibrate'],
  mission2:   ['vibrate'],
  exomoon:    ['vibrate'],
  gemini:     ['vibrate'],
  ridge:      ['vibrate'],

  // Vibrate + Rotate
  nora:       ['rotate', 'vibrate'],

  // Vibrate + Pump
  max:        ['pump', 'vibrate'],
  max2:       ['pump', 'vibrate'],

  // Dual vibrate (vibrate + vibrate2)
  edge:       ['vibrate', 'vibrate2'],
  edge2:      ['vibrate', 'vibrate2'],
  dolce:      ['vibrate', 'vibrate2'],

  // Oscillate only
  osci:       ['oscillate'],
  osci2:      ['oscillate'],
  osci3:      ['oscillate'],

  // Vibrate + Thrusting
  gravity:    ['thrusting', 'vibrate'],
  vulse:      ['thrusting', 'vibrate'],
  spinel:     ['thrusting', 'vibrate'],

  // Vibrate + Fingering
  flexer:     ['fingering', 'vibrate'],

  // Suction + Vibrate
  tenera:     ['suction', 'vibrate'],
  tenera2:    ['suction', 'vibrate'],

  // Depth + Oscillate
  solace:     ['depth', 'oscillate'],
};

/** Get the supported functions for a toy type. Unknown types default to ['vibrate']. */
export function getCapabilities(toyType: string | null | undefined): ToyFunction[] {
  const key = (toyType ?? '').toLowerCase();
  return TOY_CAPABILITIES[key] ?? ['vibrate'];
}

/** Returns true if the toy type is explicitly recognized (has tailored capability/preset data). */
export function isKnownToyType(toyType: string | null | undefined): boolean {
  return (toyType ?? '').toLowerCase() in TOY_CAPABILITIES;
}

/**
 * Build a Lovense Function API action string from ToyFunction->level (0-20 scale) pairs.
 * Scales pump/depth from 0-20 to their hardware range internally.
 * Returns e.g. "Vibrate:10,Rotate:15"
 */
export function buildActionString(levels: Partial<Record<ToyFunction, number>>): string {
  const parts: string[] = [];
  for (const [fn, level] of Object.entries(levels)) {
    if (level == null || level <= 0) continue;
    const def = FUNCTION_DEFS[fn as ToyFunction];
    if (!def) continue;
    const scaled = def.maxLevel < 20
      ? Math.max(0, Math.min(def.maxLevel, Math.round(level * def.maxLevel / 20)))
      : Math.max(0, Math.min(20, Math.round(level)));
    if (scaled > 0) {
      parts.push(`${def.action}:${scaled}`);
    }
  }
  return parts.join(',');
}

/**
 * Build an actions map {ActionName: scaledLevel} suitable for DeviceController.sendActions().
 * Input levels are 0-20 scale; pump/depth are scaled down to their hardware range.
 */
export function buildActionsMap(levels: Partial<Record<ToyFunction, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [fn, level] of Object.entries(levels)) {
    if (level == null || level <= 0) continue;
    const def = FUNCTION_DEFS[fn as ToyFunction];
    if (!def) continue;
    const scaled = def.maxLevel < 20
      ? Math.max(0, Math.min(def.maxLevel, Math.round(level * def.maxLevel / 20)))
      : Math.max(0, Math.min(20, Math.round(level)));
    if (scaled > 0) {
      result[def.action] = scaled;
    }
  }
  return result;
}

/** Returns true if the toy has more than one hardware axis. */
export function isMultiAxis(toyType: string | null | undefined): boolean {
  return getCapabilities(toyType).length > 1;
}
