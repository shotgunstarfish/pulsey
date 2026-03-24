import { useState, useRef, useCallback, useEffect } from 'react';
import type { DeviceSlot, ToyConfig, SessionAction } from '../../engine/sessionMachine.ts';
import { getCapabilities, buildActionsMap } from '../../engine/toyCapabilities.ts';
import type { ToyFunction } from '../../engine/toyCapabilities.ts';
import { getPresetsForToy, getPresetById } from '../../engine/patternPresets.ts';
import type { PatternPreset } from '../../engine/patternPresets.ts';
import { applyPattern } from '../../engine/toyPatterns.ts';
import { LovenseDevice } from '../../devices/LovenseDevice.ts';
import type { DeviceController } from '../../devices/DeviceController.ts';
import { MockDevice } from '../../devices/MockDevice.ts';
import styles from './PatternPreview.module.css';

interface PatternPreviewProps {
  slot: DeviceSlot;
  send: (action: SessionAction) => void;
}

/** Format a ToyFunction[] as human-readable capability labels */
function capsDescription(caps: ToyFunction[]): string {
  return caps.map(fn => fn.charAt(0).toUpperCase() + fn.slice(1)).join(' + ');
}

function ToyPreview({
  tc,
  slot,
  send,
}: {
  tc: ToyConfig;
  slot: DeviceSlot;
  send: (action: SessionAction) => void;
}) {
  const caps = getCapabilities(tc.toy.type);
  const presets = getPresetsForToy(tc.toy.type);
  const currentPreset = tc.presetId ? getPresetById(tc.presetId) : undefined;
  const [previewing, setPreviewing] = useState(false);
  const cancelRef = useRef(false);
  const deviceRef = useRef<DeviceController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRef.current = true;
      deviceRef.current?.stop(tc.toy.id).catch(() => {});
    };
  }, [tc.toy.id]);

  function handlePresetChange(presetId: string) {
    send({ type: 'SET_PRESET', deviceId: slot.id, toyId: tc.toy.id, presetId });
  }

  const runPreview = useCallback(async () => {
    if (previewing) return;
    cancelRef.current = false;
    setPreviewing(true);

    // Create a device for preview
    let device: DeviceController;
    if (slot.mode === 'lovense' && slot.lovenseConfig) {
      device = new LovenseDevice(
        slot.lovenseConfig.domain,
        slot.lovenseConfig.port,
        slot.lovenseConfig.ssl,
      );
    } else {
      device = new MockDevice();
    }
    deviceRef.current = device;

    try {
      await device.connect();

      const preset = tc.presetId ? getPresetById(tc.presetId) : undefined;
      const DURATION = 5000;
      const STEP = 50;
      const steps = DURATION / STEP;

      for (let i = 0; i < steps; i++) {
        if (cancelRef.current) break;
        const t = i * STEP;
        // Sine ramp: 0 -> peak -> 0 over 5s
        const globalIntensity = Math.sin(t * Math.PI / DURATION) * 20;

        if (preset && caps.length > 1) {
          // Multi-axis
          const axisLevels: Partial<Record<ToyFunction, number>> = {};
          for (const fn of caps) {
            const axisCfg = preset.axes[fn];
            if (!axisCfg) continue;
            const patterned = applyPattern(
              axisCfg.pattern,
              globalIntensity,
              t + axisCfg.phaseOffsetMs,
              3,
              20,
            );
            axisLevels[fn] = Math.round(patterned * axisCfg.intensityScale);
          }
          const actions = buildActionsMap(axisLevels);
          if (Object.keys(actions).length > 0) {
            await device.sendActions(actions, tc.toy.id);
          }
        } else {
          // Single axis
          const axisCfg = preset?.axes[caps[0] as ToyFunction];
          const pattern = axisCfg?.pattern ?? tc.pattern ?? 'direct';
          const patterned = applyPattern(pattern, globalIntensity, t, 3, 20);
          const level = Math.round(patterned * (axisCfg?.intensityScale ?? 1.0));
          await device.vibrate(level, tc.toy.id);
        }

        await new Promise(resolve => setTimeout(resolve, STEP));
      }
    } catch (err) {
      console.error('[PatternPreview] preview error:', err);
    } finally {
      await device.stop(tc.toy.id).catch(() => {});
      device.disconnect();
      deviceRef.current = null;
      setPreviewing(false);
    }
  }, [previewing, slot.mode, slot.lovenseConfig, slot.id, tc, caps]);

  const stopPreview = useCallback(() => {
    cancelRef.current = true;
    deviceRef.current?.stop(tc.toy.id).catch(() => {});
  }, [tc.toy.id]);

  return (
    <div className={styles.toySection}>
      <div className={styles.toyHeader}>
        <span className={styles.toyName}>
          {tc.toy.nickName || tc.toy.name || tc.toy.type}
        </span>
        <span className={styles.capsLabel}>{capsDescription(caps)}</span>
      </div>

      <div className={styles.presetRow}>
        <select
          className={styles.presetSelect}
          value={tc.presetId ?? ''}
          onChange={e => handlePresetChange(e.target.value)}
        >
          {presets.map((p: PatternPreset) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {currentPreset && (
        <div className={styles.presetDesc}>{currentPreset.description}</div>
      )}

      {/* Per-axis info for multi-axis toys */}
      {caps.length > 1 && currentPreset && (
        <div className={styles.axisSliders}>
          {caps.map(fn => {
            const axisCfg = currentPreset.axes[fn];
            if (!axisCfg) return null;
            return (
              <div key={fn} className={styles.axisRow}>
                <span className={styles.axisLabel}>{fn}</span>
                <span className={styles.axisValue}>
                  {axisCfg.pattern}
                  {axisCfg.phaseOffsetMs > 0 ? ` +${axisCfg.phaseOffsetMs}ms` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.previewBtn}
          disabled={previewing}
          onClick={runPreview}
        >
          {previewing ? 'Running...' : 'Preview 5s'}
        </button>
        {previewing && (
          <button className={styles.stopBtn} onClick={stopPreview}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

export function PatternPreview({ slot, send }: PatternPreviewProps) {
  if (slot.mode === 'mock') {
    return (
      <div className={styles.container}>
        <div className={styles.presetDesc}>
          Mock mode — preview sends commands to console.
        </div>
      </div>
    );
  }

  if (slot.toyConfigs.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.presetDesc}>
          No toys discovered. Test connection first.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {slot.toyConfigs.map(tc => (
        <ToyPreview
          key={tc.toy.id}
          tc={tc}
          slot={slot}
          send={send}
        />
      ))}
    </div>
  );
}
