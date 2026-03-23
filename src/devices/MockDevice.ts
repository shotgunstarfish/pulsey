/** Mock device — logs to console, simulates latency */

import type { DeviceController } from './DeviceController.ts';

export class MockDevice implements DeviceController {
  private connected = false;

  /** Mock device uses the 50ms ticker path — no PatternV2 */
  readonly supportsPatternV2 = false;

  async connect(): Promise<void> {
    await this.simulateLatency();
    this.connected = true;
    console.log('[MockDevice] connected');
  }

  async vibrate(strength: number, _toyId?: string): Promise<void> {
    if (!this.connected) return;
    await this.simulateLatency();
    console.log(`[MockDevice] vibrate(${strength})`);
  }

  async stop(_toyId?: string): Promise<void> {
    await this.simulateLatency();
    console.log('[MockDevice] stop');
  }

  disconnect(): void {
    this.connected = false;
    console.log('[MockDevice] disconnected');
  }

  private simulateLatency(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 50));
  }
}
