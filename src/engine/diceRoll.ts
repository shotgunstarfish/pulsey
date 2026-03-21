/** Release probability table + dice roll logic — pure function */

function getEdgeBucket(edgeCount: number): string {
  if (edgeCount <= 2) return '1-2';
  if (edgeCount <= 4) return '3-4';
  if (edgeCount <= 7) return '5-7';
  if (edgeCount <= 10) return '8-10';
  return '11+';
}

const RELEASE_PROBABILITY: Record<string, number> = {
  '1-2': 0,
  '3-4': 0.10,
  '5-7': 0.25,
  '8-10': 0.40,
  '11+': 0.60,
};

export function getReleaseChance(edgeCount: number): number {
  return RELEASE_PROBABILITY[getEdgeBucket(edgeCount)] ?? 0;
}

export function rollForRelease(edgeCount: number): boolean {
  const chance = getReleaseChance(edgeCount);
  return Math.random() < chance;
}
