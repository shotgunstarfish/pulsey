/** Device controller interface — abstraction over hardware */

import type { PatternKeyframe } from '../engine/patternBlock.ts';

export interface DeviceController {
  connect(): Promise<void>;
  vibrate(strength: number, toyId?: string): Promise<void>;  // 0-20; toyId='' broadcasts to all toys
  stop(toyId?: string): Promise<void>;
  disconnect(): void;

  /** True if this device supports PatternV2 pre-computed blocks. */
  readonly supportsPatternV2: boolean;

  /**
   * Upload and play a pre-computed PatternV2 block.
   * Only called when supportsPatternV2 is true.
   * Always uses stopPrevious:0 for seamless transitions.
   * To interrupt an active block, call stopPattern() first.
   */
  sendPatternBlock?(keyframes: PatternKeyframe[], durationMs: number, toyId?: string): Promise<void>;

  /** Stop PatternV2 playback. Only called when supportsPatternV2 is true. */
  stopPattern?(toyId?: string): Promise<void>;
}
