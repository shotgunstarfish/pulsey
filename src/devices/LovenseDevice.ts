/** Real Lovense device — HTTP API calls to Lovense Remote app */

import type { DeviceController } from './DeviceController.ts';
import type { PatternKeyframe } from '../engine/patternBlock.ts';

export class LovenseDevice implements DeviceController {
  private baseUrl: string;

  readonly supportsPatternV2 = true;

  constructor(domain: string, port: number, ssl = false) {
    this.baseUrl = `${ssl ? 'https' : 'http'}://${domain}:${port}`;
  }

  async connect(): Promise<void> {
    // Do NOT send Vibrate:0 here — connect() can fire mid-session (reconcile effect)
    // and would interrupt active device output. A ping-style status call isn't needed
    // since the first vibrate() send confirms connectivity.
    console.log('[LovenseDevice] connected to', this.baseUrl);
  }

  async vibrate(strength: number, toyId?: string): Promise<void> {
    const clamped = Math.max(0, Math.min(20, Math.round(strength)));
    // stopPrevious:0 — transition directly to the new level without stopping first.
    // Default (1) stops the device before each command, causing audible/felt gaps on every level change.
    await this.sendCommand('Function', `Vibrate:${clamped}`, toyId, 0);
  }

  async stop(toyId?: string): Promise<void> {
    // stopPrevious:1 (default) — we DO want to stop everything cleanly here
    await this.sendCommand('Function', 'Vibrate:0', toyId, 1);
  }

  disconnect(): void {
    this.stopPattern().catch(() => {});  // stop PatternV2 if active
    this.sendCommand('Function', 'Vibrate:0', undefined, 1).catch(() => {});
  }

  // ── PatternV2 ─────────────────────────────────────────────────────────────

  /**
   * Upload and immediately play a pre-computed PatternV2 block using InitPlay.
   * Single HTTP call vs the two-step Setup→Play.
   * Uses stopPrevious:0 — seamless transition at natural block boundaries.
   * To interrupt an active block, call stopPattern() first, then this method.
   * Requires Lovense Remote firmware v7.76.0+.
   */
  async sendPatternBlock(keyframes: PatternKeyframe[], durationMs: number, toyId?: string): Promise<void> {
    await this.sendPatternV2({
      command:      'PatternV2',
      type:         'InitPlay',
      actions:      keyframes,
      startTime:    0,
      timeMs:       durationMs,
      toy:          toyId ?? '',
      stopPrevious: 0,
      apiVer:       1,
    });
  }

  async stopPattern(toyId?: string): Promise<void> {
    await this.sendPatternV2({
      command: 'PatternV2',
      type: 'Stop',
      toy: toyId ?? '',
      apiVer: 1,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async sendCommand(command: string, action: string, toyId?: string, stopPrevious = 1): Promise<void> {
    const response = await fetch(`${this.baseUrl}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-platform': 'ai-video-reel',
      },
      body: JSON.stringify({
        command,
        action,
        timeSec: 0,
        loopRunningSec: 0,
        loopPauseSec: 0,
        toy: toyId ?? '',
        stopPrevious,
        apiVer: 1,
      }),
    });
    if (!response.ok) {
      throw new Error(`Lovense API ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as { code?: number };
    if (data.code && data.code !== 200) {
      throw new Error(`Lovense returned code ${data.code}`);
    }
  }

  private async sendPatternV2(body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.baseUrl}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-platform': 'ai-video-reel',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Lovense PatternV2 API ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as { code?: number };
    if (data.code && data.code !== 200) {
      throw new Error(`Lovense PatternV2 returned code ${data.code}`);
    }
  }
}
