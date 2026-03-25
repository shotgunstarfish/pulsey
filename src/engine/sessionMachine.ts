/** useReducer state machine — pure, no DOM/device refs */

import type { CurveType } from './intensityCurves.ts';
import { computeIntensity, cooldownPulseRaw } from './intensityCurves.ts';
import type { ToyPattern } from './toyPatterns.ts';
export type { ToyPattern };
import { defaultPatternForToyType } from './toyPatterns.ts';
import { getDefaultPreset } from './patternPresets.ts';
import type { RandomEvent } from './randomEvents.ts';
import { shouldTriggerEvent, pickRandomEvent, isEventExpired } from './randomEvents.ts';

// ── Phases ──────────────────────────────────────────────

export type Phase =
  | 'IDLE'
  | 'SETUP'
  | 'WARMUP'
  | 'BUILD'
  | 'PLATEAU'
  | 'EDGE_CHECK'
  | 'DECISION'
  | 'COOLDOWN'
  | 'RELEASE'
  | 'PAUSED'
  | 'HISTORY'
  | 'PLAYLIST';

// ── Splash ──────────────────────────────────────────────

export type SplashColor = 'red' | 'blue' | 'gold' | 'purple';

export interface SplashEntry {
  id: string;
  text: string;
  color: SplashColor;
}

// ── Device slots ────────────────────────────────────────

export interface LovenseToy {
  id: string;
  name: string;
  nickName: string;
  status: number;  // 1 = connected
  battery: number;
  type: string;
}

export interface ToyConfig {
  toy: LovenseToy;
  intensityScale: number;   // 0.0-1.0
  inputMode: 'auto' | 'beat';
  enabled: boolean;
  pattern: ToyPattern;
  presetId?: string;
}

export interface DeviceSlot {
  id: string;                              // uuid, generated on creation
  label: string;                           // user-editable name, e.g. "Toy 1"
  mode: 'mock' | 'lovense';
  lovenseConfig: { domain: string; port: number; ssl: boolean } | null;
  intensityScale: number;                  // hub-level scale (mock mode + default for new toys)
  enabled: boolean;                        // hub-level enabled (mock mode + default for new toys)
  toyConfigs: ToyConfig[];                 // per-toy settings (lovense mode); empty for mock
  inputMode: 'auto' | 'beat';             // hub-level input mode (mock mode + default for new toys)
  pattern: ToyPattern;                     // hub-level pattern (mock mode + default for new toys)
  presetId?: string;                       // hub-level preset (mock mode + default for new toys)
}

// ── State ───────────────────────────────────────────────

export interface SessionState {
  phase: Phase;
  previousPhase: Phase | null; // for PAUSED resume
  intensity: number;           // 0-20
  edgeCount: number;
  feelingLevel: number | null;
  teasingMultiplier: number;
  buildFloor: number;
  buildDuration: number;       // ms
  cooldownDuration: number;    // ms
  currentCurve: CurveType;
  activeEvent: RandomEvent | null;
  lastEventAt: number | null;
  splash: SplashEntry | null;
  elapsedMs: number;
  phaseElapsedMs: number;
  sessionStartedAt: number | null;
  paused: boolean;
  devices: DeviceSlot[];
  viewMode: 'video' | 'text';
  releaseRolled: boolean | null;     // result of last dice roll
  holdChallengeFeelingsOk: boolean;  // tracking hold challenge
  beatBoost: number;                 // transient beat-synced intensity boost, decays to 0
  curveIntensity: number;            // intensity from curve only, no beat boost — use this for smooth device control
  hasBeggedThisDecision: boolean;    // true after user begs in current DECISION phase
  begDenialTaunt: string | null;     // taunt text shown after a BEG denial
  rampFactor: number;              // 1.0 = normal build speed, <1 = slowed, >1 = accelerated
  decisionEntryIntensity: number;  // intensity when DECISION phase began, for smooth decay
  cooldownEntryIntensity: number;  // intensity when COOLDOWN phase began, for smooth entry
}

// ── Actions ─────────────────────────────────────────────

export type SessionAction =
  | { type: 'START_SESSION' }
  | { type: 'END_SESSION' }
  | { type: 'REPORT_FEELING'; level: number }
  | { type: 'TICK'; deltaMs: number }
  | { type: 'EDGE_CONFIRMED' }
  | { type: 'DECISION_RELEASE' }
  | { type: 'DECISION_CONTINUE' }
  | { type: 'COOLDOWN_COMPLETE' }
  | { type: 'EMERGENCY_STOP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'TRIGGER_RANDOM_EVENT'; event: RandomEvent }
  | { type: 'RANDOM_EVENT_COMPLETE' }
  | { type: 'CLEAR_SPLASH' }
  | { type: 'ADD_DEVICE' }
  | { type: 'REMOVE_DEVICE'; id: string }
  | { type: 'UPDATE_DEVICE'; id: string; patch: Partial<Omit<DeviceSlot, 'id'>> }
  | { type: 'SET_VIEW_MODE'; mode: 'video' | 'text' }
  | { type: 'BEAT_NUDGE' }
  | { type: 'GO_SETUP' }
  | { type: 'GO_HISTORY' }
  | { type: 'GO_IDLE' }
  | { type: 'GO_PLAYLIST' }
  | { type: 'SET_TOYS'; deviceId: string; toys: LovenseToy[] }
  | { type: 'SET_INPUT_MODE'; deviceId: string; inputMode: 'auto' | 'beat' }
  | { type: 'UPDATE_TOY_CONFIG'; deviceId: string; toyId: string; patch: Partial<Pick<ToyConfig, 'intensityScale' | 'inputMode' | 'enabled' | 'pattern' | 'presetId'>> }
  | { type: 'SET_PRESET'; deviceId: string; toyId?: string; presetId: string }
  | { type: 'BEG' };

// ── Splash message pools ────────────────────────────────

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

const SPLASH_FEELING_LOW = ['CRANKING IT UP', 'MORE POWER', 'PUSHING HARDER', 'FEEL THAT?'];
const SPLASH_FEELING_MID = ['HOLDING STEADY', 'KEEP GOING', 'GOOD'];
const SPLASH_FEELING_HIGH = ['EDGING YOU', 'NOT YET', 'SO CLOSE...', 'STAY THERE'];
const SPLASH_FEELING_EDGE = ['EDGE CONFIRMED', 'GOTCHA', "THAT'S IT"];
const SPLASH_DICE_CONTINUE = ['NOT THIS TIME', 'DENIED', 'KEEP SUFFERING', 'NOT DONE YET'];
const SPLASH_BEG_DENY = ['DENIED', 'NO.', 'PATHETIC', 'TRY HARDER', 'NOT A CHANCE'];
const SPLASH_BEG_GRANT = ['...FINE', 'YOU EARNED IT THIS TIME', 'JUST THIS ONCE'];

const BEG_DENIAL_TAUNTS = [
  "Begging already? We just got started.",
  "That's adorable. The answer is no.",
  "You think that pitiful display deserves a reward?",
  "Come back when you've actually earned it.",
  "Not even close to convincing. Keep suffering.",
  "Did you really think that would work?",
  "Your desperation is showing. Good.",
  "No. Now be quiet and take it.",
  "I've heard more convincing begging from a golden retriever.",
  "The suffering is the point. We're not done yet.",
  "Try again next time. With more conviction.",
  "Denied. You're welcome.",
  "That level of begging gets you nothing. Noted.",
  "Oh, that was supposed to be persuasive?",
  "You'll have to do a lot better than that.",
];
const SPLASH_SPIKE = ['SURPRISE!', 'SPIKE!', 'FEEL THAT!'];
const SPLASH_PAUSE = ['HOLD STILL', "DON'T MOVE", 'FREEZE'];
const SPLASH_HOLD_START = ['HOLD THE EDGE', 'STAY THERE', "DON'T YOU DARE"];
const SPLASH_HOLD_SUCCESS = ['GOOD', 'WELL DONE', 'IMPRESSIVE'];
const SPLASH_HOLD_FAIL = ['YOU MOVED', 'BACK TO THE START', 'PATHETIC'];
const SPLASH_EMERGENCY = ['PAUSED', 'STOPPING'];

function splash(text: string, color: SplashColor): SplashEntry {
  return { id: uid(), text, color };
}

// ── Constants ───────────────────────────────────────────

const INITIAL_BUILD_DURATION = 60_000;    // 60s
const INITIAL_COOLDOWN_DURATION = 20_000; // 20s
const WARMUP_DURATION = 10_000;           // 10s
const RELEASE_DURATION = 10_000;          // 10s
const BUILD_CEILING = 18;
const PLATEAU_DURATION = 30_000;          // 30s max at plateau before auto-advancing
const PLATEAU_OSCILLATION_PERIOD = 9_000; // 9s sine cycle at plateau

// ── Curve selection ──────────────────────────────────────
// Weighted: sine 50%, pulse 40%, linear 10% (linear is surprise-only)
function nextCurve(_current: CurveType): CurveType {
  const r = Math.random();
  if (r < 0.5) return 'sine';
  if (r < 0.9) return 'pulse';
  return 'linear';
}

// ── Initial state ───────────────────────────────────────

export const DEFAULT_DEVICE: DeviceSlot = {
  id: 'default',
  label: 'Device 1',
  mode: 'mock',
  lovenseConfig: null,
  intensityScale: 1.0,
  enabled: true,
  toyConfigs: [],
  inputMode: 'auto',
  pattern: 'direct',
  presetId: 'vibe-direct',
};

export const initialState: SessionState = {
  phase: 'IDLE',
  previousPhase: null,
  intensity: 0,
  edgeCount: 0,
  feelingLevel: null,
  teasingMultiplier: 1,
  buildFloor: 2,
  buildDuration: INITIAL_BUILD_DURATION,
  cooldownDuration: INITIAL_COOLDOWN_DURATION,
  currentCurve: 'sine',
  activeEvent: null,
  lastEventAt: null,
  splash: null,
  elapsedMs: 0,
  phaseElapsedMs: 0,
  sessionStartedAt: null,
  paused: false,
  devices: [{ ...DEFAULT_DEVICE }],
  viewMode: 'text',
  releaseRolled: null,
  holdChallengeFeelingsOk: true,
  beatBoost: 0,
  curveIntensity: 0,
  hasBeggedThisDecision: false,
  begDenialTaunt: null,
  rampFactor: 1.0,
  decisionEntryIntensity: 0,
  cooldownEntryIntensity: 0,
};

// ── Reducer ─────────────────────────────────────────────

const SESSION_PHASES = new Set(['WARMUP', 'BUILD', 'PLATEAU', 'EDGE_CHECK', 'DECISION', 'COOLDOWN', 'RELEASE']);

// Beat boost decay: boost of 4 decays to 0 in ~200ms (deltaMs=16 → 0.32/tick)
const BEAT_BOOST_DECAY_RATE = 1 / 50;

function _sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'GO_SETUP':
      return { ...state, phase: 'SETUP' };

    case 'GO_HISTORY':
      return { ...state, phase: 'HISTORY' };

    case 'GO_IDLE':
      return { ...state, phase: 'IDLE' };

    case 'GO_PLAYLIST':
      return { ...state, phase: 'PLAYLIST' };

    case 'ADD_DEVICE':
      return {
        ...state,
        devices: [
          ...state.devices,
          {
            id: uid(),
            label: `Device ${state.devices.length + 1}`,
            mode: 'mock',
            lovenseConfig: null,
            intensityScale: 1.0,
            enabled: true,
            toyConfigs: [],
            inputMode: 'auto' as const,
            pattern: 'direct' as const,
            presetId: 'vibe-direct',
          },
        ],
      };

    case 'SET_TOYS': {
      const device = state.devices.find(d => d.id === action.deviceId);
      if (!device) return state;
      const existingByToyId = new Map(device.toyConfigs.map(tc => [tc.toy.id, tc]));
      const newToyConfigs: ToyConfig[] = action.toys.map(toy => {
        const isConnected = toy.status === 1;
        const existing = existingByToyId.get(toy.id);
        if (existing) {
          // Preserve user settings, update toy metadata (battery, status, etc.)
          // Auto-disable if disconnected; never auto-enable (respect user's choice)
          return { ...existing, toy, enabled: isConnected ? existing.enabled : false };
        }
        // New toy — inherit hub defaults, auto-disable if not connected
        return {
          toy,
          intensityScale: device.intensityScale,
          inputMode: device.inputMode,
          enabled: isConnected ? device.enabled : false,
          pattern: defaultPatternForToyType(toy.type),
          presetId: getDefaultPreset(toy.type).id,
        };
      });
      return {
        ...state,
        devices: state.devices.map(d =>
          d.id === action.deviceId ? { ...d, toyConfigs: newToyConfigs } : d,
        ),
      };
    }

    case 'SET_INPUT_MODE':
      return {
        ...state,
        devices: state.devices.map(d =>
          d.id === action.deviceId ? { ...d, inputMode: action.inputMode } : d,
        ),
      };

    case 'UPDATE_TOY_CONFIG':
      return {
        ...state,
        devices: state.devices.map(d =>
          d.id === action.deviceId
            ? {
                ...d,
                toyConfigs: d.toyConfigs.map(tc =>
                  tc.toy.id === action.toyId ? { ...tc, ...action.patch } : tc,
                ),
              }
            : d,
        ),
      };

    case 'SET_PRESET': {
      return {
        ...state,
        devices: state.devices.map(d => {
          if (d.id !== action.deviceId) return d;
          if (action.toyId) {
            // Per-toy preset
            return {
              ...d,
              toyConfigs: d.toyConfigs.map(tc =>
                tc.toy.id === action.toyId ? { ...tc, presetId: action.presetId } : tc,
              ),
            };
          }
          // Hub-level preset (mock mode)
          return { ...d, presetId: action.presetId };
        }),
      };
    }

    case 'REMOVE_DEVICE':
      if (state.devices.length <= 1) return state;
      return { ...state, devices: state.devices.filter(d => d.id !== action.id) };

    case 'UPDATE_DEVICE':
      return {
        ...state,
        devices: state.devices.map(d =>
          d.id === action.id ? { ...d, ...action.patch } : d,
        ),
      };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };

    case 'START_SESSION':
      return {
        ...initialState,
        devices: state.devices,
        viewMode: state.viewMode,
        phase: 'WARMUP',
        sessionStartedAt: Date.now(),
        phaseElapsedMs: 0,
        rampFactor: 1.0,
        decisionEntryIntensity: 0,
        cooldownEntryIntensity: 0,
        feelingLevel: 2,
      };

    case 'END_SESSION':
      return {
        ...state,
        phase: 'IDLE',
        intensity: 0,
        activeEvent: null,
        paused: false,
      };

    case 'EMERGENCY_STOP':
      return {
        ...state,
        intensity: 0,
        activeEvent: null,
        splash: splash(pick(SPLASH_EMERGENCY), 'blue'),
        phase: 'IDLE',
        paused: false,
      };

    case 'PAUSE': {
      if (state.phase === 'IDLE' || state.phase === 'SETUP' || state.phase === 'HISTORY' || state.phase === 'PLAYLIST' || state.phase === 'PAUSED') {
        return state;
      }
      return {
        ...state,
        previousPhase: state.phase,
        phase: 'PAUSED',
        paused: true,
        intensity: 0,
      };
    }

    case 'RESUME': {
      if (!state.paused || state.previousPhase === null) return state;
      return {
        ...state,
        phase: state.previousPhase,
        previousPhase: null,
        paused: false,
      };
    }

    case 'CLEAR_SPLASH':
      return { ...state, splash: null };

    case 'REPORT_FEELING': {
      const level = action.level;
      const activePhases: Phase[] = ['BUILD', 'PLATEAU', 'WARMUP', 'EDGE_CHECK'];
      if (!activePhases.includes(state.phase)) {
        return state;
      }

      // Back out of EDGE_CHECK if feeling drops below 9
      if (state.phase === 'EDGE_CHECK' && level < 9) {
        const intensity = level >= 7
          ? Math.max(0, state.intensity - (2 + Math.floor(state.teasingMultiplier)))
          : state.intensity;
        const backoutRamp = level <= 3 ? (level === 1 ? 1.5 : level === 2 ? 1.4 : 1.2)
          : level <= 6 ? (level === 4 ? 1.0 : level === 5 ? 0.85 : 0.65)
          : (level === 7 ? 0.4 : 0.1);
        return {
          ...state,
          feelingLevel: level,
          phase: 'PLATEAU',
          phaseElapsedMs: 0,
          intensity,
          teasingMultiplier: level >= 7 ? state.teasingMultiplier + 0.2 : state.teasingMultiplier,
          rampFactor: backoutRamp,
          splash: splash(
            level >= 7 ? pick(SPLASH_FEELING_HIGH) : pick(SPLASH_FEELING_MID),
            level >= 7 ? 'purple' : 'blue',
          ),
        };
      }

      // Hold challenge tracking
      if (state.activeEvent?.type === 'HOLD_CHALLENGE') {
        if (level < 7) {
          return {
            ...state,
            feelingLevel: level,
            holdChallengeFeelingsOk: false,
            splash: splash(pick(SPLASH_HOLD_FAIL), 'red'),
            activeEvent: null,
            phase: 'BUILD',
            phaseElapsedMs: 0,
            intensity: state.buildFloor,
          };
        }
        return { ...state, feelingLevel: level };
      }

      if (level >= 1 && level <= 3) {
        const lowRamp = level === 1 ? 1.5 : level === 2 ? 1.4 : 1.2;
        return {
          ...state,
          feelingLevel: level,
          buildFloor: Math.min(state.buildFloor + 1, 12),
          rampFactor: lowRamp,
          splash: splash(pick(SPLASH_FEELING_LOW), 'red'),
        };
      }
      if (level >= 4 && level <= 6) {
        const midRamp = level === 4 ? 1.0 : level === 5 ? 0.85 : 0.65;
        return {
          ...state,
          feelingLevel: level,
          rampFactor: midRamp,
          splash: splash(pick(SPLASH_FEELING_MID), 'blue'),
        };
      }
      if (level >= 7 && level <= 8) {
        const highRamp = level === 7 ? 0.4 : 0.1;
        return {
          ...state,
          feelingLevel: level,
          intensity: Math.max(0, state.intensity - (2 + Math.floor(state.teasingMultiplier))),
          teasingMultiplier: state.teasingMultiplier + 0.2,
          rampFactor: highRamp,
          splash: splash(pick(SPLASH_FEELING_HIGH), 'purple'),
        };
      }
      if (level === 9) {
        // Already in EDGE_CHECK — confirm immediately
        if (state.phase === 'EDGE_CHECK') {
          const newEdgeCount = state.edgeCount + 1;
          return {
            ...state,
            feelingLevel: level,
            edgeCount: newEdgeCount,
            phase: 'DECISION',
            phaseElapsedMs: 0,
            releaseRolled: false,
            hasBeggedThisDecision: false,
            begDenialTaunt: null,
            intensity: Math.max(5, state.intensity - 5),
            decisionEntryIntensity: Math.max(5, state.intensity - 5),
            cooldownEntryIntensity: Math.max(5, state.intensity - 5),
            splash: splash(pick(SPLASH_DICE_CONTINUE), 'purple'),
          };
        }
        return {
          ...state,
          feelingLevel: level,
          phase: 'EDGE_CHECK',
          phaseElapsedMs: 0,
          intensity: Math.max(8, state.intensity - 2),  // slight pullback on edge entry
          splash: splash(pick(SPLASH_FEELING_EDGE), 'gold'),
        };
      }
      return state;
    }

    case 'EDGE_CONFIRMED': {
      const newEdgeCount = state.edgeCount + 1;
      return {
        ...state,
        edgeCount: newEdgeCount,
        phase: 'DECISION',
        phaseElapsedMs: 0,
        releaseRolled: false,
        hasBeggedThisDecision: false,
        begDenialTaunt: null,
        intensity: state.intensity,
        decisionEntryIntensity: state.intensity,
        cooldownEntryIntensity: state.intensity,
        splash: splash(pick(SPLASH_DICE_CONTINUE), 'purple'),
      };
    }

    case 'DECISION_RELEASE': {
      // Can only release if feeling level is 8 or 9 — otherwise just continue
      if ((state.feelingLevel ?? 0) < 8) {
        return {
          ...state,
          phase: 'COOLDOWN',
          phaseElapsedMs: 0,
          intensity: state.intensity,
          cooldownEntryIntensity: state.intensity,
          buildFloor: Math.min(state.buildFloor + 1, 12),
          buildDuration: Math.max(20_000, state.buildDuration * 0.9),
          cooldownDuration: state.edgeCount > 3
            ? Math.max(8_000, state.cooldownDuration * 0.95)
            : state.cooldownDuration,
          currentCurve: nextCurve(state.currentCurve),
        };
      }
      return {
        ...state,
        phase: 'RELEASE',
        phaseElapsedMs: 0,
        intensity: 20,
      };
    }

    case 'DECISION_CONTINUE':
      return {
        ...state,
        phase: 'COOLDOWN',
        phaseElapsedMs: 0,
        intensity: state.intensity,
        cooldownEntryIntensity: state.intensity,
        buildFloor: Math.min(state.buildFloor + 1, 12),
        buildDuration: Math.max(20_000, state.buildDuration * 0.9),
        cooldownDuration: state.edgeCount > 3
          ? Math.max(8_000, state.cooldownDuration * 0.95)
          : state.cooldownDuration,
        currentCurve: nextCurve(state.currentCurve),
      };

    case 'BEG': {
      // Only valid in DECISION when not yet begged and release wasn't already granted
      if (state.phase !== 'DECISION' || state.hasBeggedThisDecision || state.releaseRolled) return state;
      // 15% grant, 85% deny
      const granted = Math.random() < 0.15;
      if (granted) {
        return {
          ...state,
          phase: 'RELEASE',
          phaseElapsedMs: 0,
          intensity: 20,
          hasBeggedThisDecision: true,
          splash: splash(pick(SPLASH_BEG_GRANT), 'gold'),
        };
      }
      return {
        ...state,
        hasBeggedThisDecision: true,
        begDenialTaunt: pick(BEG_DENIAL_TAUNTS),
        // Punishment: next build will be slightly longer
        buildFloor: Math.min(state.buildFloor + 1, 12),
        splash: splash(pick(SPLASH_BEG_DENY), 'red'),
      };
    }

    case 'COOLDOWN_COMPLETE':
      return {
        ...state,
        phase: 'BUILD',
        phaseElapsedMs: 0,
        intensity: state.buildFloor,
        rampFactor: 1.0,
      };

    case 'TRIGGER_RANDOM_EVENT': {
      const event = action.event;
      let newSplash: SplashEntry;
      let newIntensity = state.intensity;

      if (event.type === 'INTENSITY_SPIKE') {
        newSplash = splash(pick(SPLASH_SPIKE), 'red');
        newIntensity = Math.min(20, state.intensity + 5);
      } else if (event.type === 'FORCED_PAUSE') {
        newSplash = splash(pick(SPLASH_PAUSE), 'blue');
        newIntensity = 0;
      } else {
        newSplash = splash(pick(SPLASH_HOLD_START), 'purple');
      }

      return {
        ...state,
        activeEvent: event,
        lastEventAt: event.startedAt,
        splash: newSplash,
        intensity: newIntensity,
        holdChallengeFeelingsOk: true,
      };
    }

    case 'RANDOM_EVENT_COMPLETE': {
      const event = state.activeEvent;
      if (!event) return state;

      if (event.type === 'HOLD_CHALLENGE' && state.holdChallengeFeelingsOk) {
        return {
          ...state,
          activeEvent: null,
          splash: splash(pick(SPLASH_HOLD_SUCCESS), 'gold'),
        };
      }

      return {
        ...state,
        activeEvent: null,
      };
    }

    case 'TICK': {
      if (state.paused) return state;

      const dt = action.deltaMs;
      const newElapsed = state.elapsedMs + dt;
      const newPhaseElapsed = state.phaseElapsedMs + dt;

      // Phase-specific tick logic
      switch (state.phase) {
        case 'WARMUP': {
          if (newPhaseElapsed >= WARMUP_DURATION) {
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              phase: 'BUILD',
              intensity: state.buildFloor,
            };
          }
          const warmupIntensity = computeIntensity('linear', newPhaseElapsed, WARMUP_DURATION, 1, state.buildFloor);
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: warmupIntensity };
        }

        case 'BUILD': {
          // Apply rampFactor: feeling level controls build speed (0.1 = near-stopped, 1.5 = accelerated)
          const buildPhaseElapsed = state.phaseElapsedMs + dt * Math.max(0.1, Math.min(2.0, state.rampFactor));

          // Check random events
          if (shouldTriggerEvent(state.phase, state.lastEventAt, newElapsed, state.activeEvent)) {
            const event = pickRandomEvent(newElapsed);
            let eventSplash: SplashEntry;
            let eventIntensity = state.intensity;

            if (event.type === 'INTENSITY_SPIKE') {
              eventSplash = splash(pick(SPLASH_SPIKE), 'red');
              eventIntensity = Math.min(20, state.intensity + 5);
            } else if (event.type === 'FORCED_PAUSE') {
              eventSplash = splash(pick(SPLASH_PAUSE), 'blue');
              eventIntensity = 0;
            } else {
              eventSplash = splash(pick(SPLASH_HOLD_START), 'purple');
            }

            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: buildPhaseElapsed,
              activeEvent: event,
              lastEventAt: event.startedAt,
              splash: eventSplash,
              intensity: eventIntensity,
              holdChallengeFeelingsOk: true,
            };
          }

          // Check if active event expired
          if (state.activeEvent && isEventExpired(state.activeEvent, newElapsed)) {
            const wasHold = state.activeEvent.type === 'HOLD_CHALLENGE';
            const holdOk = wasHold && state.holdChallengeFeelingsOk;
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: buildPhaseElapsed,
              activeEvent: null,
              splash: wasHold
                ? (holdOk ? splash(pick(SPLASH_HOLD_SUCCESS), 'gold') : splash(pick(SPLASH_HOLD_FAIL), 'red'))
                : state.splash,
              // On hold fail, reset build
              ...(wasHold && !holdOk ? { phaseElapsedMs: 0, intensity: state.buildFloor } : {}),
            };
          }

          // Active event overrides: don't advance curve during forced pause
          if (state.activeEvent?.type === 'FORCED_PAUSE') {
            return { ...state, elapsedMs: newElapsed, phaseElapsedMs: buildPhaseElapsed, intensity: 0 };
          }

          // Active spike override
          if (state.activeEvent?.type === 'INTENSITY_SPIKE') {
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: buildPhaseElapsed,
              intensity: Math.min(20, computeIntensity(state.currentCurve, buildPhaseElapsed, state.buildDuration, state.buildFloor, BUILD_CEILING) + 5),
            };
          }

          // Normal build: check if build duration exceeded → PLATEAU
          if (buildPhaseElapsed >= state.buildDuration) {
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              phase: 'PLATEAU',
              intensity: BUILD_CEILING,
            };
          }

          const buildIntensity = computeIntensity(
            state.currentCurve,
            buildPhaseElapsed,
            state.buildDuration,
            state.buildFloor,
            BUILD_CEILING,
          );
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: buildPhaseElapsed, intensity: buildIntensity };
        }

        case 'PLATEAU': {
          // Random events in plateau too
          if (shouldTriggerEvent(state.phase, state.lastEventAt, newElapsed, state.activeEvent)) {
            const event = pickRandomEvent(newElapsed);
            let eventSplash: SplashEntry;
            let eventIntensity = state.intensity;

            if (event.type === 'INTENSITY_SPIKE') {
              eventSplash = splash(pick(SPLASH_SPIKE), 'red');
              eventIntensity = Math.min(20, state.intensity + 5);
            } else if (event.type === 'FORCED_PAUSE') {
              eventSplash = splash(pick(SPLASH_PAUSE), 'blue');
              eventIntensity = 0;
            } else {
              eventSplash = splash(pick(SPLASH_HOLD_START), 'purple');
            }

            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: newPhaseElapsed,
              activeEvent: event,
              lastEventAt: event.startedAt,
              splash: eventSplash,
              intensity: eventIntensity,
              holdChallengeFeelingsOk: true,
            };
          }

          if (state.activeEvent && isEventExpired(state.activeEvent, newElapsed)) {
            return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, activeEvent: null };
          }

          if (state.activeEvent?.type === 'FORCED_PAUSE') {
            return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: 0 };
          }

          // Auto-advance to EDGE_CHECK after PLATEAU_DURATION
          if (newPhaseElapsed >= PLATEAU_DURATION) {
            const newEdgeCount = state.edgeCount + 1;
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              edgeCount: newEdgeCount,
              phase: 'DECISION',
              releaseRolled: false,
              hasBeggedThisDecision: false,
              begDenialTaunt: null,
              intensity: Math.max(5, BUILD_CEILING - 5),
              decisionEntryIntensity: Math.max(5, BUILD_CEILING - 5),
              cooldownEntryIntensity: Math.max(5, BUILD_CEILING - 5),
              splash: splash(pick(SPLASH_DICE_CONTINUE), 'purple'),
            };
          }

          // Oscillate intensity at plateau so it doesn't just sit flat
          const plateauIntensity = Math.round(
            computeIntensity('sine', newPhaseElapsed % PLATEAU_OSCILLATION_PERIOD, PLATEAU_OSCILLATION_PERIOD, 15, BUILD_CEILING),
          );
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: plateauIntensity };
        }

        case 'EDGE_CHECK': {
          // Brief pause — auto-confirm edge after 5 seconds
          if (newPhaseElapsed >= 5000) {
            const newEdgeCount = state.edgeCount + 1;
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              edgeCount: newEdgeCount,
              phase: 'DECISION',
              releaseRolled: false,
              hasBeggedThisDecision: false,
              begDenialTaunt: null,
              intensity: state.intensity,  // DECISION tick will decay smoothly
              decisionEntryIntensity: state.intensity,
              cooldownEntryIntensity: state.intensity,
              splash: splash(pick(SPLASH_DICE_CONTINUE), 'purple'),
            };
          }
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed };
        }

        case 'DECISION': {
          if (newPhaseElapsed >= 6000) {
            const atEdge = (state.feelingLevel ?? 0) >= 8;
            if (atEdge && state.releaseRolled) {
              return { ...state, elapsedMs: newElapsed, phaseElapsedMs: 0, phase: 'RELEASE', intensity: 20 };
            }
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              phase: 'COOLDOWN',
              intensity: state.intensity,  // carry current for COOLDOWN smooth entry
              cooldownEntryIntensity: state.intensity,
              buildFloor: Math.min(state.buildFloor + 1, 12),
              buildDuration: Math.max(20_000, state.buildDuration * 0.9),
              cooldownDuration: state.edgeCount > 3 ? Math.max(8_000, state.cooldownDuration * 0.95) : state.cooldownDuration,
              currentCurve: nextCurve(state.currentCurve),
            };
          }
          // Smooth intensity decay: from decisionEntryIntensity toward 8 over first 2.5s
          const decayTarget = 8;
          const decayDuration = 2500;
          const decayProgress = Math.min(1, newPhaseElapsed / decayDuration);
          const entry = state.decisionEntryIntensity > 0 ? state.decisionEntryIntensity : state.intensity;
          const decayedInt = Math.max(decayTarget, Math.round(entry - (entry - decayTarget) * decayProgress));
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: decayedInt };
        }

        case 'COOLDOWN': {
          if (newPhaseElapsed >= state.cooldownDuration) {
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: 0,
              phase: 'BUILD',
              intensity: state.buildFloor,
              rampFactor: 1.0,  // fresh start after cooldown
            };
          }

          const cdProgress = newPhaseElapsed / state.cooldownDuration;
          const ENTRY_RAMP_MS = 3000; // smooth ramp-down from entry level over first 3s
          let cdIntensity: number;

          if (newPhaseElapsed < ENTRY_RAMP_MS && state.cooldownEntryIntensity > 4) {
            // Smooth entry: ramp from cooldownEntryIntensity down toward 4
            const entryProgress = newPhaseElapsed / ENTRY_RAMP_MS;
            cdIntensity = Math.round(state.cooldownEntryIntensity - (state.cooldownEntryIntensity - 4) * entryProgress);
          } else if (cdProgress > 0.8) {
            // Smooth exit: ramp from recovery pulse level up to buildFloor over last 20%
            const exitProgress = (cdProgress - 0.8) / 0.2;
            const pulseBase = Math.round(cooldownPulseRaw(newPhaseElapsed, state.cooldownDuration));
            cdIntensity = Math.round(pulseBase + (state.buildFloor - pulseBase) * exitProgress);
          } else {
            cdIntensity = Math.round(cooldownPulseRaw(newPhaseElapsed, state.cooldownDuration));
          }

          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: cdIntensity };
        }

        case 'RELEASE': {
          // Ramp up pattern then ramp down
          if (newPhaseElapsed >= RELEASE_DURATION) {
            return {
              ...state,
              elapsedMs: newElapsed,
              phaseElapsedMs: newPhaseElapsed,
              intensity: 0,
              phase: 'IDLE',
            };
          }
          // First 5s: hold at 20, last 5s: ramp down
          const halfway = RELEASE_DURATION / 2;
          const releaseIntensity = newPhaseElapsed < halfway
            ? 20
            : computeIntensity('linear', newPhaseElapsed - halfway, halfway, 20, 0);
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed, intensity: releaseIntensity };
        }

        default:
          return { ...state, elapsedMs: newElapsed, phaseElapsedMs: newPhaseElapsed };
      }
    }

    default:
      return state;
  }
}

/**
 * Public reducer — wraps _sessionReducer with beat boost logic.
 * BEAT_NUDGE bumps beatBoost; each TICK decays it and applies it to intensity.
 */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  // Beat nudge: only meaningful during active (non-paused) session phases
  if (action.type === 'BEAT_NUDGE') {
    if (state.paused || !SESSION_PHASES.has(state.phase)) return state;
    return { ...state, beatBoost: Math.min(state.beatBoost + 3, 5) };
  }

  const nextState = _sessionReducer(state, action);

  // On every TICK: record the pre-boost curve intensity, then apply decaying boost on top
  if (action.type === 'TICK') {
    const curveIntensity = nextState.intensity;
    if (state.beatBoost > 0) {
      const decayedBoost = Math.max(0, state.beatBoost - action.deltaMs * BEAT_BOOST_DECAY_RATE);
      return {
        ...nextState,
        curveIntensity,
        beatBoost: decayedBoost,
        intensity: Math.min(20, Math.round(curveIntensity + decayedBoost)),
      };
    }
    return { ...nextState, curveIntensity };
  }

  return nextState;
}
