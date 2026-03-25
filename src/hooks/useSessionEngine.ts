/** Wires reducer + device + intensity loop + PatternV2 block scheduler */

import { useReducer, useRef, useEffect, useCallback, useState } from 'react';
import { sessionReducer, initialState } from '../engine/sessionMachine.ts';
import type { SessionState, SessionAction, Phase, DeviceSlot, LovenseToy, ToyConfig, ToyPattern } from '../engine/sessionMachine.ts';
import { applyPattern } from '../engine/toyPatterns.ts';
import type { ToyFunction } from '../engine/toyCapabilities.ts';
import { getCapabilities, buildActionsMap, isMultiAxis } from '../engine/toyCapabilities.ts';
import { getPresetById } from '../engine/patternPresets.ts';
import { patternToPresetId } from '../engine/patternPresets.ts';
import { saveSession } from '../engine/sessionHistory.ts';
import type { DeviceController } from '../devices/DeviceController.ts';
import { MockDevice } from '../devices/MockDevice.ts';
import { LovenseDevice } from '../devices/LovenseDevice.ts';
import {
  generateBlock,
  interpolateBlockAt,
  posToIntensity,
  PATTERN_BLOCK_DURATION,
} from '../engine/patternBlock.ts';
import type { PatternBlock, BlockGenParams } from '../engine/patternBlock.ts';

const DEVICE_CONFIG_KEY = 'pulse:devices';

/** Composite key: `${slotId}:${toyId}` for lovense toys, `slotId` for mock */
function toyKey(slotId: string, toyId?: string): string {
  return toyId ? `${slotId}:${toyId}` : slotId;
}

/** Parse a composite key back to slotId + optional toyId */
function parseKey(key: string): { slotId: string; toyId?: string } {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return { slotId: key };
  return { slotId: key.slice(0, colonIdx), toyId: key.slice(colonIdx + 1) };
}

type StoredSlot = Omit<DeviceSlot, 'toyConfigs' | 'pattern'> & {
  toys?: LovenseToy[];
  toyConfigs?: (Omit<ToyConfig, 'pattern'> & { pattern?: ToyPattern; presetId?: string })[];
  pattern?: ToyPattern;
  presetId?: string;
};

function loadSavedDevices(): DeviceSlot[] | null {
  try {
    const raw = localStorage.getItem(DEVICE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const slot of parsed) {
      if (typeof slot.id !== 'string' || typeof slot.mode !== 'string') return null;
    }
    return (parsed as StoredSlot[]).map(slot => {
      const inputMode = slot.inputMode ?? 'auto';
      const toyConfigs: ToyConfig[] = (slot.toyConfigs?.map(tc => {
        const resolvedPattern = tc.pattern ?? 'direct';
        const resolvedPresetId = tc.presetId ?? patternToPresetId(resolvedPattern, tc.toy?.type);
        return {
          ...tc,
          pattern: resolvedPattern,
          presetId: resolvedPresetId,
        };
      }) ?? (
        slot.toys?.map(toy => ({
          toy,
          intensityScale: slot.intensityScale,
          inputMode,
          enabled: slot.enabled,
          pattern: 'direct' as ToyPattern,
          presetId: patternToPresetId('direct', toy.type),
        })) ?? []
      ));
      const slotPattern = slot.pattern ?? 'direct';
      return {
        id: slot.id,
        label: slot.label,
        mode: slot.mode,
        lovenseConfig: slot.lovenseConfig,
        intensityScale: slot.intensityScale,
        enabled: slot.enabled,
        toyConfigs,
        inputMode,
        pattern: slotPattern,
        presetId: slot.presetId ?? patternToPresetId(slotPattern),
      } satisfies DeviceSlot;
    });
  } catch {
    return null;
  }
}

function saveDevices(devices: DeviceSlot[]): void {
  try {
    localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(devices));
  } catch {
    // localStorage may be unavailable (private browsing quota, etc.)
  }
}

function isSessionPhase(phase: Phase): boolean {
  return ['WARMUP', 'BUILD', 'PLATEAU', 'EDGE_CHECK', 'DECISION', 'COOLDOWN', 'RELEASE'].includes(phase);
}

/** Phases long enough to benefit from PatternV2 pre-computed blocks (≥10s) */
function shouldUsePatternV2Phase(phase: Phase): boolean {
  return phase === 'WARMUP' || phase === 'BUILD' || phase === 'PLATEAU'
    || phase === 'COOLDOWN' || phase === 'RELEASE';
}

/** Serialize a slot's connection-relevant fields for dep comparison */
function slotKey(slot: DeviceSlot): string {
  return `${slot.id}|${slot.mode}|${slot.lovenseConfig?.domain ?? ''}|${slot.lovenseConfig?.port ?? ''}|${slot.lovenseConfig?.ssl ?? false}`;
}

interface BlockSchedule {
  current: PatternBlock | null;
  next: PatternBlock | null;
  /** performance.now() when Play was sent (optimistic — device lags by ~40ms) */
  startedAt: number;
  /** true while sendPatternBlock is in-flight — prevents double-send */
  sending: boolean;
}

export function useSessionEngine(isBeat: boolean = false, bpm: number = 0) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, getInitialState);
  const devicesRef = useRef<Map<string, DeviceController>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const beatIntensityRef = useRef<Map<string, number>>(new Map());
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  /**
   * Desired vibration level per device/toy key (0-20).
   * Written by: PatternV2 block scheduler (interpolated) OR RAF auto-mode section.
   * Read by: 50ms ticker (mock + PatternV2 fallback), deviceIntensities display.
   */
  const desiredLevelRef = useRef<Map<string, number>>(new Map());
  /** Per-toy desired actions: key -> {ActionName: level} for multi-axis dispatch */
  const desiredActionsRef = useRef<Map<string, Record<string, number>>>(new Map());
  /** Last value actually sent per key + timestamp — avoids re-sending the same level */
  const lastSentRef = useRef<Map<string, { level: number; time: number }>>(new Map());
  const KEEPALIVE_MS = 5_000;
  const MIN_SEND_MS  = 100;

  /**
   * PatternV2 block schedule per toy key.
   * Only populated for Lovense devices with supportsPatternV2 === true.
   */
  const blockScheduleRef = useRef<Map<string, BlockSchedule>>(new Map());

  const stateRef = useRef(state);
  stateRef.current = state;

  // deviceErrors: slotId → last error message (empty string = ok)
  const [deviceErrors, setDeviceErrors] = useState<Record<string, string>>({});

  function setDeviceError(id: string, msg: string) {
    setDeviceErrors(prev => prev[id] === msg ? prev : { ...prev, [id]: msg });
  }
  function clearDeviceError(id: string) {
    setDeviceErrors(prev => { if (!prev[id]) return prev; const n = { ...prev }; delete n[id]; return n; });
  }

  // On each beat, set beat-mode devices/toys to max intensity
  const prevIsBeatRef = useRef(false);
  useEffect(() => {
    if (isBeat && !prevIsBeatRef.current) {
      for (const slot of state.devices) {
        if (slot.mode === 'mock') {
          if (slot.inputMode === 'beat' && slot.enabled) {
            beatIntensityRef.current.set(slot.id, 20);
          }
        } else {
          for (const tc of slot.toyConfigs) {
            if (tc.inputMode === 'beat' && tc.enabled) {
              beatIntensityRef.current.set(toyKey(slot.id, tc.toy.id), 20);
            }
          }
        }
      }
    }
    prevIsBeatRef.current = isBeat;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBeat]);

  // Auto-set mock mode from URL param; restore last device config from localStorage
  function getInitialState(): SessionState {
    const savedDevices = loadSavedDevices();
    const base = savedDevices ? { ...initialState, devices: savedDevices } : initialState;

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mock') === '1') {
        return {
          ...base,
          devices: base.devices.map(d => ({ ...d, mode: 'mock' as const })),
        };
      }
    }
    return base;
  }

  // Reconcile device controllers when slots change
  useEffect(() => {
    const map = devicesRef.current;
    const currentSlotIds = new Set(state.devices.map(s => s.id));

    // Remove controllers for deleted slots
    for (const [id, controller] of map.entries()) {
      if (!currentSlotIds.has(id)) {
        controller.disconnect();
        map.delete(id);
      }
    }

    // Create or re-create controllers for each slot
    for (const slot of state.devices) {
      const existing = map.get(slot.id);
      const needsRebuild = !existing || (
        (existing as DeviceController & { __slotKey?: string }).__slotKey !== slotKey(slot)
      );

      if (needsRebuild) {
        if (existing) {
          existing.disconnect();
          // Clear block schedules for toys in this slot
          for (const [key] of blockScheduleRef.current.entries()) {
            if (parseKey(key).slotId === slot.id) blockScheduleRef.current.delete(key);
          }
        }

        let controller: DeviceController;
        if (slot.mode === 'lovense' && slot.lovenseConfig) {
          controller = new LovenseDevice(slot.lovenseConfig.domain, slot.lovenseConfig.port, slot.lovenseConfig.ssl);
        } else {
          controller = new MockDevice();
        }
        (controller as DeviceController & { __slotKey?: string }).__slotKey = slotKey(slot);

        controller.connect()
          .then(() => clearDeviceError(slot.id))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Device ${slot.label} connect failed:`, msg);
            setDeviceError(slot.id, `Connect failed: ${msg}`);
          });

        map.set(slot.id, controller);
      }
    }

    return () => {
      for (const controller of map.values()) {
        controller.disconnect();
      }
      map.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.devices.map(slotKey).join(',')]);

  // Persist device config to localStorage whenever any device setting changes.
  useEffect(() => {
    saveDevices(state.devices);
  }, [state.devices]);

  // Phase change cleanup — stop PatternV2 patterns on short phases, PAUSED, and IDLE
  useEffect(() => {
    const phase = state.phase;

    // Short phases (EDGE_CHECK, DECISION): stop PatternV2, let ticker handle
    if (isSessionPhase(phase) && !shouldUsePatternV2Phase(phase)) {
      for (const [key, schedule] of blockScheduleRef.current.entries()) {
        if (schedule.current) {
          const { slotId, toyId } = parseKey(key);
          const controller = devicesRef.current.get(slotId);
          controller?.stopPattern?.(toyId).catch(() => {});
        }
      }
      blockScheduleRef.current.clear();
    }

    // Pause: stop all PatternV2 patterns
    if (phase === 'PAUSED') {
      for (const [key, schedule] of blockScheduleRef.current.entries()) {
        if (schedule.current) {
          const { slotId, toyId } = parseKey(key);
          const controller = devicesRef.current.get(slotId);
          controller?.stopPattern?.(toyId).catch(() => {});
        }
      }
      blockScheduleRef.current.clear();
    }

    // IDLE: stop everything
    if (phase === 'IDLE') {
      desiredLevelRef.current.clear();
      desiredActionsRef.current.clear();
      blockScheduleRef.current.clear();
      for (const controller of devicesRef.current.values()) {
        controller.stopPattern?.().catch(() => {});
        controller.stop().catch(() => {});
      }
    }
  }, [state.phase]);

  // ── 50ms send ticker ─────────────────────────────────────────────────────────
  // Sends to mock devices (and PatternV2 fallbacks) at a fixed 50ms cadence.
  // PatternV2 Lovense devices with active block schedules are SKIPPED here —
  // their output is driven by the firmware executing the pre-sent pattern.
  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!isSessionPhase(s.phase)) return;

      const desired = desiredLevelRef.current;
      const lastSent = lastSentRef.current;
      const now = Date.now();

      function maybeSend(key: string, level: number, send: () => void) {
        const prev = lastSent.get(key);
        if (prev) {
          const elapsed = now - prev.time;
          if (prev.level === level) {
            // Same level: keepalive re-sync for non-zero (device might have reset)
            if (level === 0 || elapsed < KEEPALIVE_MS) return;
          } else {
            // Level changed: hard rate gate — prevents oscillation spam at integer boundaries
            if (elapsed < MIN_SEND_MS) return;
          }
        }
        lastSent.set(key, { level, time: now });
        send();
      }

      for (const slot of s.devices) {
        const controller = devicesRef.current.get(slot.id);
        if (!controller) continue;

        if (slot.mode === 'mock') {
          if (!slot.enabled) continue;
          const level = desired.get(slot.id) ?? 0;
          maybeSend(slot.id, level, () =>
            controller.vibrate(level)
              .then(() => clearDeviceError(slot.id))
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                setDeviceError(slot.id, `Vibrate failed: ${msg}`);
              }));
        } else {
          for (const tc of slot.toyConfigs) {
            if (!tc.enabled) continue;
            const key = toyKey(slot.id, tc.toy.id);

            // Skip toys with an active PatternV2 block schedule — firmware drives them
            if (controller.supportsPatternV2 && blockScheduleRef.current.has(key)
                && shouldUsePatternV2Phase(s.phase)) continue;

            const level = desired.get(key) ?? 0;
            const actions = desiredActionsRef.current.get(key);
            if (actions && Object.keys(actions).length > 1) {
              maybeSend(key, level, () =>
                controller.sendActions(actions, tc.toy.id)
                  .then(() => clearDeviceError(slot.id))
                  .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    setDeviceError(slot.id, `sendActions failed: ${msg}`);
                  }));
            } else {
              maybeSend(key, level, () =>
                controller.vibrate(level, tc.toy.id)
                  .then(() => clearDeviceError(slot.id))
                  .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    setDeviceError(slot.id, `Vibrate failed: ${msg}`);
                  }));
            }
          }
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, []); // stable — runs for entire component lifetime

  // ── rAF tick loop ─────────────────────────────────────────────────────────────
  // 1. Dispatches TICK for state machine timing (phase transitions, display).
  // 2. For Lovense devices: manages PatternV2 block lifecycle, writes display values.
  // 3. For mock devices: writes desired levels to desiredLevelRef for the 50ms ticker.
  useEffect(() => {
    if (!isSessionPhase(state.phase) && state.phase !== 'PAUSED') {
      return;
    }

    lastTickRef.current = performance.now();

    function tick(now: number) {
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      dispatch({ type: 'TICK', deltaMs: delta });

      const desired = desiredLevelRef.current;
      const beatMap = beatIntensityRef.current;
      const s = stateRef.current;
      const currentDevices = s.devices;

      // ── Beat intensity decay (beat-mode devices) ──────────────────────────
      for (const [key, val] of beatMap.entries()) {
        const next = Math.max(0, val - delta * 0.04);
        const { slotId, toyId } = parseKey(key);
        const slot = currentDevices.find(d => d.id === slotId);

        if (next <= 0) {
          beatMap.delete(key);
          desired.set(key, 0);
        } else {
          beatMap.set(key, next);
          if (slot) {
            if (slot.mode === 'mock') {
              if (slot.inputMode === 'beat' && slot.enabled) {
                const patterned = applyPattern(slot.pattern, next, s.elapsedMs, s.buildFloor, 20);
                desired.set(key, Math.round(patterned * slot.intensityScale));
              }
            } else {
              const tc = toyId ? slot.toyConfigs.find(t => t.toy.id === toyId) : undefined;
              if (tc && tc.inputMode === 'beat' && tc.enabled) {
                const patterned = applyPattern(tc.pattern, next, s.elapsedMs, s.buildFloor, 20);
                desired.set(key, Math.round(patterned * tc.intensityScale));
              }
            }
          }
        }
      }

      // ── Auto-mode desired levels (for mock + PatternV2 fallback path) ─────
      // For Lovense PatternV2 devices in PatternV2 phases, the block scheduler
      // below will override these values. For all other devices, these are final.
      if (isSessionPhase(s.phase)) {
        const deviceIntensity = s.curveIntensity + s.beatBoost * 0.35;
        for (const slot of s.devices) {
          if (slot.mode === 'mock') {
            if (!slot.enabled || slot.inputMode === 'beat') continue;
            const patterned = applyPattern(slot.pattern, deviceIntensity, s.elapsedMs, s.buildFloor, 20);
            const raw = Math.round(patterned * slot.intensityScale);
            desired.set(slot.id, deviceIntensity > 0 ? Math.max(1, raw) : raw);
          } else {
            for (const tc of slot.toyConfigs) {
              if (!tc.enabled || tc.inputMode === 'beat') continue;
              const key = toyKey(slot.id, tc.toy.id);
              const preset = tc.presetId ? getPresetById(tc.presetId) : undefined;
              const caps = getCapabilities(tc.toy.type);

              if (preset && caps.length > 1) {
                // Multi-axis: compute per-axis levels
                const axisLevels: Partial<Record<ToyFunction, number>> = {};
                for (const fn of caps) {
                  const axisCfg = preset.axes[fn];
                  if (!axisCfg) continue;
                  const patterned = applyPattern(
                    axisCfg.pattern,
                    deviceIntensity,
                    s.elapsedMs + axisCfg.phaseOffsetMs,
                    s.buildFloor,
                    20,
                  );
                  axisLevels[fn] = Math.round(patterned * axisCfg.intensityScale * tc.intensityScale);
                }
                desiredActionsRef.current.set(key, buildActionsMap(axisLevels));
                // Primary axis level for display + rate-limiting
                const primaryLevel = axisLevels[caps[0]] ?? 0;
                desired.set(key, deviceIntensity > 0 ? Math.max(1, primaryLevel) : primaryLevel);
              } else {
                // Single-axis: existing logic with preset fallback
                const axisCfg = preset?.axes[caps[0] as ToyFunction];
                const pattern = axisCfg?.pattern ?? tc.pattern ?? 'direct';
                const axisScale = axisCfg?.intensityScale ?? 1.0;
                const patterned = applyPattern(pattern, deviceIntensity, s.elapsedMs, s.buildFloor, 20);
                const raw = Math.round(patterned * axisScale * tc.intensityScale);
                desired.set(key, deviceIntensity > 0 ? Math.max(1, raw) : raw);
                desiredActionsRef.current.delete(key);
              }
            }
          }
        }
      }

      // ── PatternV2 block scheduler (Lovense devices in long phases) ────────
      if (isSessionPhase(s.phase) && shouldUsePatternV2Phase(s.phase)) {
        for (const slot of s.devices) {
          if (slot.mode !== 'lovense') continue;
          const controller = devicesRef.current.get(slot.id);
          if (!controller?.supportsPatternV2) continue;

          for (const tc of slot.toyConfigs) {
            if (!tc.enabled || tc.inputMode === 'beat') continue;

            // Skip PatternV2 for multi-axis toys (firmware can only do single-axis via PatternV2)
            if (isMultiAxis(tc.toy.type)) continue;

            const key = toyKey(slot.id, tc.toy.id);
            const schedule = blockScheduleRef.current.get(key);

            // Build generation params from latest session state
            const activeEvent = s.activeEvent
              ? {
                  type: s.activeEvent.type,
                  remainingMs: Math.max(0, s.activeEvent.durationMs - (s.elapsedMs - s.activeEvent.startedAt)),
                }
              : null;

            const genParams: BlockGenParams = {
              phase:            s.phase,
              phaseElapsedMs:   s.phaseElapsedMs,
              sessionElapsedMs: s.elapsedMs,
              buildFloor:       s.buildFloor,
              buildDuration:    s.buildDuration,
              cooldownDuration: s.cooldownDuration,
              currentCurve:     s.currentCurve,
              currentIntensity: s.curveIntensity,
              activeEvent,
              toyPattern:       tc.pattern,
              intensityScale:   tc.intensityScale,
              bpm:              bpmRef.current,
            };

            // Detect stale blocks: regenerate when phase, buildFloor, or event type changes
            const needsRegen = !schedule?.current
              || schedule.current.phaseAtStart !== s.phase
              || schedule.current.buildFloorAtGeneration !== s.buildFloor
              || schedule.current.eventTypeAtGeneration !== (s.activeEvent?.type ?? null);

            if (needsRegen && !schedule?.sending) {
              const block = generateBlock(genParams);
              blockScheduleRef.current.set(key, { current: block, next: null, startedAt: 0, sending: true });

              // Stop the active block first (PatternV2 Stop halts firmware playback),
              // then send the new block. stopPattern is a no-op if nothing is playing.
              const wasPlaying = !!schedule?.current;
              const doSend = () =>
                (controller.sendPatternBlock as NonNullable<typeof controller.sendPatternBlock>)(
                  block.keyframes, block.durationMs, tc.toy.id,
                );

              (wasPlaying
                ? controller.stopPattern!(tc.toy.id).catch(() => {}).then(doSend)
                : doSend()
              )
                .then(() => {
                  const sched = blockScheduleRef.current.get(key);
                  if (sched) {
                    sched.startedAt = performance.now();
                    sched.sending = false;
                  }
                  clearDeviceError(slot.id);
                })
                .catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  setDeviceError(slot.id, `PatternV2 failed: ${msg} — falling back`);
                  blockScheduleRef.current.delete(key);
                });
              continue; // display will update next frame when send completes
            }

            if (!schedule?.current || schedule.sending) continue;

            const offset = performance.now() - schedule.startedAt;

            // Pre-generate the next block when 2s remain
            if (!schedule.next && offset > schedule.current.durationMs - 2_000) {
              schedule.next = generateBlock({
                ...genParams,
                phaseElapsedMs:   schedule.current.phaseElapsedAtStart + PATTERN_BLOCK_DURATION,
                sessionElapsedMs: schedule.current.sessionElapsedAtStart + PATTERN_BLOCK_DURATION,
              });
            }

            // Transition to next block when current expires
            if (offset >= schedule.current.durationMs) {
              const nextBlock = schedule.next ?? generateBlock(genParams);
              schedule.current = nextBlock;
              schedule.next = null;
              schedule.startedAt = 0; // will be updated to performance.now() in .then()
              schedule.sending = true;

              (controller.sendPatternBlock as NonNullable<typeof controller.sendPatternBlock>)(
                nextBlock.keyframes, nextBlock.durationMs, tc.toy.id,
              )
                .then(() => {
                  const sched = blockScheduleRef.current.get(key);
                  if (sched) {
                    sched.startedAt = performance.now(); // device starts playing now
                    sched.sending = false;
                  }
                  clearDeviceError(slot.id);
                })
                .catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  setDeviceError(slot.id, `PatternV2 block transition failed: ${msg}`);
                  blockScheduleRef.current.delete(key);
                });
              continue; // display will update next frame when transition send completes
            }

            // Write interpolated position to desiredLevelRef for display sync
            // (overrides the auto-mode value written above — this is intentional)
            const safeOffset = Math.min(offset, schedule.current.durationMs - 1);
            const pos = interpolateBlockAt(schedule.current, safeOffset);
            desired.set(key, posToIntensity(pos));
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Save session to history when RELEASE phase ends (phase goes to IDLE)
  const prevPhaseRef = useRef<Phase>(state.phase);
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;

    if (prevPhase === 'RELEASE' && state.phase === 'IDLE' && state.sessionStartedAt) {
      saveSession({
        id: Math.random().toString(36).slice(2),
        startedAt: state.sessionStartedAt,
        endedAt: Date.now(),
        durationMs: state.elapsedMs,
        edgeCount: state.edgeCount,
        outcome: 'release',
      });
    }

    if (prevPhase !== 'IDLE' && prevPhase !== 'SETUP' && prevPhase !== 'HISTORY' &&
        prevPhase !== 'PLAYLIST' && prevPhase !== 'RELEASE' && state.phase === 'IDLE' && state.sessionStartedAt) {
      if (state.elapsedMs > 5000) {
        saveSession({
          id: Math.random().toString(36).slice(2),
          startedAt: state.sessionStartedAt,
          endedAt: Date.now(),
          durationMs: state.elapsedMs,
          edgeCount: state.edgeCount,
          outcome: 'stopped',
        });
      }
    }
  }, [state.phase, state.sessionStartedAt, state.elapsedMs, state.edgeCount]);

  const send = useCallback((action: SessionAction) => {
    dispatch(action);
  }, []);

  // Compute per-device/toy effective intensities for display
  const deviceIntensities: Record<string, number> = {};
  for (const slot of state.devices) {
    if (slot.mode === 'mock') {
      const key = slot.id;
      const rawIntensity = slot.inputMode === 'beat'
        ? (beatIntensityRef.current.get(key) ?? 0)
        : state.intensity;
      deviceIntensities[key] = Math.round(applyPattern(slot.pattern, rawIntensity, state.elapsedMs, state.buildFloor, 20) * slot.intensityScale);
    } else {
      for (const tc of slot.toyConfigs) {
        const key = toyKey(slot.id, tc.toy.id);
        // For PatternV2 devices with active blocks, read the interpolated value from desiredLevelRef
        const schedule = blockScheduleRef.current.get(key);
        if (schedule?.current && !schedule.sending) {
          deviceIntensities[key] = desiredLevelRef.current.get(key) ?? 0;
        } else {
          const rawIntensity = tc.inputMode === 'beat'
            ? (beatIntensityRef.current.get(key) ?? 0)
            : state.intensity;
          deviceIntensities[key] = Math.round(applyPattern(tc.pattern, rawIntensity, state.elapsedMs, state.buildFloor, 20) * tc.intensityScale);
        }
      }
    }
  }

  return { state, send, deviceErrors, deviceIntensities };
}
