import { useState, useRef, useEffect, useCallback } from 'react';
import type { SessionAction, DeviceSlot, ToyConfig } from '../../engine/sessionMachine.ts';
import { getAllCapabilityGroups, getCapabilities, buildActionsMap } from '../../engine/toyCapabilities.ts';
import type { CapabilityGroup, ToyFunction } from '../../engine/toyCapabilities.ts';
import { getAllPresetGroups, capabilityKey } from '../../engine/patternPresets.ts';
import type { PatternPreset, AxisConfig } from '../../engine/patternPresets.ts';
import { applyPattern } from '../../engine/toyPatterns.ts';
import { LovenseDevice } from '../../devices/LovenseDevice.ts';
import type { DeviceController } from '../../devices/DeviceController.ts';
import { MockDevice } from '../../devices/MockDevice.ts';
import { WaveformCanvas } from '../WaveformCanvas/WaveformCanvas.tsx';
import styles from './PatternLibraryScreen.module.css';

interface PatternLibraryScreenProps {
  send: (action: SessionAction) => void;
  devices: DeviceSlot[];
}

const CAPABILITY_GROUPS = getAllCapabilityGroups();
const PRESET_GROUPS = getAllPresetGroups();

// ── Connected toy helpers ──────────────────────────────────────────────────

interface ConnectedToy {
  slot: DeviceSlot;
  tc: ToyConfig | null;
}

function findConnectedToy(group: CapabilityGroup, devices: DeviceSlot[]): ConnectedToy | null {
  for (const slot of devices) {
    const toyConfigs = slot.toyConfigs ?? [];
    for (const tc of toyConfigs) {
      const toyType = (tc.toy?.type ?? '').toLowerCase();
      if (toyType && group.toyTypes.includes(toyType)) {
        return { slot, tc };
      }
    }
    // Mock slots without toyConfigs — treat as connected for any single-vibrate group
    if (slot.mode === 'mock' && toyConfigs.length === 0 && group.functions.length === 1 && group.functions[0] === 'vibrate') {
      return { slot, tc: null };
    }
  }
  return null;
}

// ── Preview button ─────────────────────────────────────────────────────────

function PreviewButton({ preset, slot, tc }: { preset: PatternPreset; slot: DeviceSlot; tc: ToyConfig | null }) {
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const deviceRef = useRef<DeviceController | null>(null);
  const toyId = tc?.toy?.id ?? '';
  const caps = tc ? getCapabilities(tc.toy?.type) : ['vibrate' as ToyFunction];

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      deviceRef.current?.stop(toyId).catch(() => {});
    };
  }, [toyId]);

  const runPreview = useCallback(async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);

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

      const STEP = 50;
      const LOOP_DURATION = 8000; // 8s per cycle for smooth looping
      const INTENSITY = 14; // steady mid-high intensity so pattern shape is clear
      let totalElapsed = 0;

      while (!cancelRef.current) {
        const steps = LOOP_DURATION / STEP;
        for (let i = 0; i < steps; i++) {
          if (cancelRef.current) break;
          const t = totalElapsed + i * STEP;

          if (caps.length > 1) {
            const axisLevels: Partial<Record<ToyFunction, number>> = {};
            for (const fn of caps) {
              const axisCfg = preset.axes[fn];
              if (!axisCfg) continue;
              const patterned = applyPattern(
                axisCfg.pattern,
                INTENSITY,
                t + axisCfg.phaseOffsetMs,
                3,
                20,
              );
              axisLevels[fn] = Math.round(patterned * axisCfg.intensityScale);
            }
            const actions = buildActionsMap(axisLevels);
            if (Object.keys(actions).length > 0) {
              await device.sendActions(actions, toyId);
            }
          } else {
            const fn = caps[0] as ToyFunction;
            const axisCfg = preset.axes[fn];
            const pattern = axisCfg?.pattern ?? 'direct';
            const patterned = applyPattern(pattern, INTENSITY, t, 3, 20);
            const level = Math.round(patterned * (axisCfg?.intensityScale ?? 1.0));
            await device.vibrate(level, toyId);
          }

          await new Promise<void>(resolve => setTimeout(resolve, STEP));
        }
        totalElapsed += LOOP_DURATION;
      }
    } catch (err) {
      console.error('[PatternLibrary] preview error:', err);
    } finally {
      await device!.stop(toyId).catch(() => {});
      device!.disconnect();
      deviceRef.current = null;
      setRunning(false);
    }
  }, [running, slot, toyId, caps, preset]);

  const stopPreview = useCallback(() => {
    cancelRef.current = true;
    deviceRef.current?.stop(toyId).catch(() => {});
  }, [toyId]);

  return (
    <button
      className={running ? styles.stopBtn : styles.previewBtn}
      onClick={running ? stopPreview : runPreview}
    >
      {running ? '■ Stop' : '▶ Preview'}
    </button>
  );
}

// ── Preset card ────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  connectedToy,
}: {
  preset: PatternPreset;
  connectedToy: ConnectedToy | null;
}) {
  const axes = Object.entries(preset.axes) as [ToyFunction, AxisConfig][];

  return (
    <div className={styles.presetCard}>
      <div className={styles.presetName}>{preset.name}</div>
      <div className={styles.presetDesc}>{preset.description}</div>
      <div className={styles.waveforms}>
        {axes.map(([fn, cfg]) => (
          <div key={fn} className={styles.waveformRow}>
            {axes.length > 1 && (
              <span className={styles.axisLabel}>{fn}</span>
            )}
            <WaveformCanvas
              pattern={cfg.pattern}
              intensityScale={cfg.intensityScale}
              phaseOffsetMs={cfg.phaseOffsetMs}
              width={200}
              height={48}
            />
          </div>
        ))}
      </div>
      {connectedToy !== null && (
        <div className={styles.previewRow}>
          <PreviewButton
            preset={preset}
            slot={connectedToy.slot}
            tc={connectedToy.tc}
          />
        </div>
      )}
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export function PatternLibraryScreen({ send, devices }: PatternLibraryScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => send({ type: 'GO_IDLE' })}>
          ← Back
        </button>
        <h1 className={styles.title}>Pattern Library</h1>
        <p className={styles.subtitle}>Vibration presets grouped by toy capability</p>
      </div>

      <div className={styles.content}>
        {CAPABILITY_GROUPS.map(group => {
          const presets = PRESET_GROUPS.get(capabilityKey(group.functions)) ?? [];
          const connectedToy = findConnectedToy(group, devices);
          const isConnected = connectedToy !== null;

          return (
            <div
              key={group.key}
              className={`${styles.groupCard} ${isConnected ? '' : styles.dimmed}`}
            >
              <div className={styles.groupHeader}>
                <div className={styles.groupLabel}>{group.label}</div>
                {isConnected && (
                  <span className={styles.connectedBadge}>connected</span>
                )}
                <div className={styles.toyPills}>
                  {group.toyTypes.map(t => (
                    <span key={t} className={styles.pill}>{t}</span>
                  ))}
                </div>
              </div>
              <div className={styles.presetGrid}>
                {presets.map(preset => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    connectedToy={connectedToy}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
