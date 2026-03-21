/**
 * Pure functions for beat detection via Web Audio API.
 * No React/DOM dependencies — fully testable in isolation.
 */

/**
 * Compute bass energy from frequency data in the ~60-150 Hz range.
 * @param frequencyData - Uint8Array from AnalyserNode.getByteFrequencyData
 * @param sampleRate    - AudioContext.sampleRate (typically 44100 or 48000)
 * @param fftSize       - AnalyserNode.fftSize
 */
export function computeBassEnergy(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): number {
  const hzPerBin = sampleRate / fftSize;
  const lowBin = Math.floor(60 / hzPerBin);
  const highBin = Math.ceil(150 / hzPerBin);
  const binCount = fftSize / 2;

  let energy = 0;
  for (let i = lowBin; i <= highBin && i < binCount; i++) {
    energy += frequencyData[i];
  }
  return energy;
}

/**
 * Returns true if current energy exceeds threshold × rolling average.
 */
export function isBeatDetected(
  currentEnergy: number,
  rollingAverage: number,
  threshold = 1.4,
): boolean {
  return rollingAverage > 0 && currentEnergy > threshold * rollingAverage;
}

/**
 * Returns a new history array with newValue appended, capped at windowSize.
 */
export function updateRollingAverage(
  history: number[],
  newValue: number,
  windowSize = 30,
): number[] {
  const updated = [...history, newValue];
  if (updated.length > windowSize) updated.shift();
  return updated;
}

/**
 * Compute mean of history array. Returns 0 for empty array.
 */
export function getRollingAverage(history: number[]): number {
  if (history.length === 0) return 0;
  return history.reduce((sum, v) => sum + v, 0) / history.length;
}
