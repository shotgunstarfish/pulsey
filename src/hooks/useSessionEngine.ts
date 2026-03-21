/** Wires reducer + device + intensity loop + random events */

import { useReducer, useRef, useEffect, useCallback, useState } from 'react';
import { sessionReducer, initialState } from '../engine/sessionMachine.ts';
import type { SessionState, SessionAction, Phase, DeviceSlot, LovenseToy, ToyConfig, ToyPattern } from '../engine/sessionMachine.ts';
import { applyPattern } from '../engine/toyPatterns.ts';
import { saveSession } from '../engine/sessionHistory.ts';
import type { DeviceController } from '../devices/DeviceController.ts';
import { MockDevice } from '../devices/MockDevice.ts';
import { LovenseDevice } from '../devices/LovenseDevice.ts';

const DEVICE_CONFIG_KEY = 'ai-video-reel:devices';

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
  toyConfigs?: (Omit<ToyConfig, 'pattern'> & { pattern?: ToyPattern })[];
  pattern?: ToyPattern;
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
      const toyConfigs: ToyConfig[] = (slot.toyConfigs?.map(tc => ({
        ...tc,
        pattern: tc.pattern ?? 'direct',
      })) ?? (
        slot.toys?.map(toy => ({
          toy,
          intensityScale: slot.intensityScale,
          inputMode,
          enabled: slot.enabled,
          pattern: 'direct' as ToyPattern,
        })) ?? []
      ));
      return {
        id: slot.id,
        label: slot.label,
        mode: slot.mode,
        lovenseConfig: slot.lovenseConfig,
        intensityScale: slot.intensityScale,
        enabled: slot.enabled,
        toyConfigs,
        inputMode,
        pattern: slot.pattern ?? 'direct',
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

/** Serialize a slot's connection-relevant fields for dep comparison */
function slotKey(slot: DeviceSlot): string {
  return `${slot.id}|${slot.mode}|${slot.lovenseConfig?.domain ?? ''}|${slot.lovenseConfig?.port ?? ''}|${slot.lovenseConfig?.ssl ?? false}`;
}

export function useSessionEngine(isBeat: boolean = false) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, getInitialState);
  const devicesRef = useRef<Map<string, DeviceController>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const beatIntensityRef = useRef<Map<string, number>>(new Map());

  /**
   * Desired vibration level per device/toy key.
   * The RAF loop writes here every frame; the 50ms send ticker reads and sends.
   * This decouples intensity computation from API calls — no spam, no gaps.
   */
  const desiredLevelRef = useRef<Map<string, number>>(new Map());
  /** Last value actually sent per key + timestamp — avoids re-sending the same level every 50ms */
  const lastSentRef = useRef<Map<string, { level: number; time: number }>>(new Map());
  const KEEPALIVE_MS = 5_000;  // re-sync after device reset (timeSec:0 = indefinite, but reconnects need a nudge)
  const MIN_SEND_MS  = 100;    // hard rate gate — prevents 10/11/10/11 oscillation spam

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

  // Stop all devices on IDLE and clear desired levels
  useEffect(() => {
    if (state.phase === 'IDLE') {
      desiredLevelRef.current.clear();
      for (const controller of devicesRef.current.values()) {
        controller.stop().catch(() => {});
      }
    }
  }, [state.phase]);

  // ── 50ms send ticker ─────────────────────────────────────────────────────────
  // Reads desiredLevelRef and sends to all devices at a fixed 50ms cadence.
  // This is the ONLY place vibrate() is called during a session — decoupled from
  // the RAF intensity computation so the API never gets spammed.
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
            const level = desired.get(key) ?? 0;
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
    }, 50);

    return () => clearInterval(interval);
  }, []); // stable — runs for entire component lifetime

  // ── rAF tick loop ─────────────────────────────────────────────────────────────
  // Dispatches TICK for state machine timing and writes desired levels to
  // desiredLevelRef. Does NOT call vibrate() — that's the 50ms ticker's job.
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
      const currentDevices = stateRef.current.devices;

      // Decay beat intensities and update desired levels for beat-mode devices
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
                const patterned = applyPattern(slot.pattern, next, stateRef.current.elapsedMs, stateRef.current.buildFloor, 20);
                desired.set(key, Math.round(patterned * slot.intensityScale));
              }
            } else {
              const tc = toyId ? slot.toyConfigs.find(t => t.toy.id === toyId) : undefined;
              if (tc && tc.inputMode === 'beat' && tc.enabled) {
                const patterned = applyPattern(tc.pattern, next, stateRef.current.elapsedMs, stateRef.current.buildFloor, 20);
                desired.set(key, Math.round(patterned * tc.intensityScale));
              }
            }
          }
        }
      }

      // Update desired levels for auto-mode devices
      const s = stateRef.current;
      if (isSessionPhase(s.phase)) {
        for (const slot of s.devices) {
          if (slot.mode === 'mock') {
            if (!slot.enabled || slot.inputMode === 'beat') continue;
            const patterned = applyPattern(slot.pattern, s.curveIntensity, s.elapsedMs, s.buildFloor, 20);
            const raw = Math.round(patterned * slot.intensityScale);
            desired.set(slot.id, s.curveIntensity > 0 ? Math.max(1, raw) : raw);
          } else {
            for (const tc of slot.toyConfigs) {
              if (!tc.enabled || tc.inputMode === 'beat') continue;
              const key = toyKey(slot.id, tc.toy.id);
              const patterned = applyPattern(tc.pattern, s.curveIntensity, s.elapsedMs, s.buildFloor, 20);
              const raw = Math.round(patterned * tc.intensityScale);
              desired.set(key, s.curveIntensity > 0 ? Math.max(1, raw) : raw);
            }
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
        const rawIntensity = tc.inputMode === 'beat'
          ? (beatIntensityRef.current.get(key) ?? 0)
          : state.intensity;
        deviceIntensities[key] = Math.round(applyPattern(tc.pattern, rawIntensity, state.elapsedMs, state.buildFloor, 20) * tc.intensityScale);
      }
    }
  }

  return { state, send, deviceErrors, deviceIntensities };
}
