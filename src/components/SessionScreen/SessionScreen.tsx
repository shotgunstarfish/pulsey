import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SessionState, SessionAction, ToyConfig } from '../../engine/sessionMachine.ts';
import { PATTERN_LABELS } from '../../engine/toyPatterns.ts';
import { getPresetsForToy, getPresetById } from '../../engine/patternPresets.ts';
import type { ToyFunction } from '../../engine/toyCapabilities.ts';
import type { PlaylistStore } from '../../hooks/useVideoPlaylist.ts';
import { hasAnyVideos } from '../../hooks/useVideoPlaylist.ts';
import { getEventRemainingMs } from '../../engine/randomEvents.ts';
import { getReleaseChance } from '../../engine/diceRoll.ts';
import { VideoPanel } from '../VideoPanel/VideoPanel.tsx';
import { EncouragementDisplay } from '../EncouragementDisplay/EncouragementDisplay.tsx';
import { EnergyEqualizer } from '../EnergyEqualizer/EnergyEqualizer.tsx';
import { SessionBackground } from '../SessionBackground/SessionBackground.tsx';
import { RadialGauge } from './RadialGauge.tsx';
import styles from './SessionScreen.module.css';
import { rateCurve } from '../../engine/curveRatings.ts';

interface SessionScreenProps {
  state: SessionState;
  send: (action: SessionAction) => void;
  playlist: PlaylistStore;
  isBeat: boolean;
  bassEnergyRef: RefObject<number>;
  analyserRef: RefObject<AnalyserNode | null>;
  bpm: number;
  deviceErrors: Record<string, string>;
  deviceIntensities: Record<string, number>;
  deviceAxisIntensities: Record<string, Partial<Record<ToyFunction, number>>>;
  musicRef?: RefObject<HTMLAudioElement | null>;
}

const PHASE_COLORS: Record<string, string> = {
  WARMUP: 'var(--blue)',
  BUILD: 'var(--orange)',
  PLATEAU: 'var(--red)',
  EDGE_CHECK: 'var(--gold)',
  DECISION: 'var(--gold)',
  COOLDOWN: 'var(--blue)',
  RELEASE: 'var(--gold)',
  PAUSED: 'var(--text-muted)',
};

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function ModeToggle({ inputMode, onAuto, onBeat }: { inputMode: 'auto' | 'beat'; onAuto: () => void; onBeat: () => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      <button onClick={onAuto} style={{
        padding: '0.2rem 0.5rem',
        background: inputMode === 'auto' ? 'var(--blue)' : 'var(--surface)',
        color: inputMode === 'auto' ? '#000' : 'var(--text-muted)',
        border: '1px solid var(--border)', borderRadius: '5px',
        cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem',
      }}>AUTO</button>
      <button onClick={onBeat} style={{
        padding: '0.2rem 0.5rem',
        background: inputMode === 'beat' ? 'var(--purple)' : 'var(--surface)',
        color: inputMode === 'beat' ? '#fff' : 'var(--text-muted)',
        border: '1px solid var(--border)', borderRadius: '5px',
        cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem',
      }}>BEAT</button>
    </div>
  );
}

function PresetPicker({ toyType, currentPresetId, onChange }: {
  toyType?: string | null;
  currentPresetId?: string;
  onChange: (presetId: string) => void;
}) {
  const presets = getPresetsForToy(toyType);
  return (
    <select
      value={currentPresetId ?? ''}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '0.15rem 0.35rem',
        background: 'var(--surface)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '0.65rem',
        maxWidth: '10rem',
      }}
    >
      {presets.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

function getPhaseLabel(state: SessionState): string {
  if (state.phase === 'PAUSED') return 'PAUSED';
  if (state.phase === 'EDGE_CHECK') return 'EDGE CHECK';
  if (state.phase === 'DECISION') {
    return state.releaseRolled ? 'RELEASE!' : 'DENIED';
  }
  return state.phase;
}

/** Phase duration estimates for progress bar (ms) */
const PHASE_DURATION_ESTIMATE: Record<string, number> = {
  WARMUP: 30_000,
  PLATEAU: 30_000,
  EDGE_CHECK: 15_000,
  DECISION: 10_000,
  COOLDOWN: 45_000,
  RELEASE: 30_000,
  PAUSED: 60_000,
};

const AXIS_ABBR: Record<string, string> = {
  vibrate: 'vibe', vibrate2: 'vib2', rotate: 'rot', pump: 'pump',
  depth: 'dpth', thump: 'thmp', oscillate: 'osc', contract: 'cont',
};

export function SessionScreen({ state, send, playlist, isBeat, bassEnergyRef, analyserRef, bpm, deviceErrors, deviceIntensities, deviceAxisIntensities, musicRef }: SessionScreenProps) {
  const phaseColor = PHASE_COLORS[state.phase] ?? 'var(--text)';
  const eventRemaining = state.activeEvent
    ? getEventRemainingMs(state.activeEvent, state.elapsedMs)
    : 0;
  const showVideo = state.viewMode === 'video' && hasAnyVideos(playlist);
  const isVideoMode = state.viewMode === 'video';
  const videoAvailable = hasAnyVideos(playlist);

  const [ratingFlash, setRatingFlash] = useState<'up' | 'down' | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleRateCurve(direction: 1 | -1) {
    rateCurve(state.currentCurve, direction);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setRatingFlash(direction === 1 ? 'up' : 'down');
    flashTimerRef.current = setTimeout(() => setRatingFlash(null), 600);
  }

  // Beat key: increments on each rising edge of isBeat to force remount of ring element
  const beatKeyRef = useRef(0);
  const prevBeatRef = useRef(false);
  if (isBeat && !prevBeatRef.current) beatKeyRef.current++;
  prevBeatRef.current = isBeat;

  // Phase progress: use buildDuration for BUILD, fixed estimates for others
  const phaseDuration = state.phase === 'BUILD'
    ? state.buildDuration
    : (PHASE_DURATION_ESTIMATE[state.phase] ?? 60_000);
  const progressPct = Math.min(100, (state.phaseElapsedMs / phaseDuration) * 100);

  return (
    <div className={styles.container}>
      <SessionBackground
        phaseColor={phaseColor}
        isBeat={isBeat}
        intensity={state.intensity}
        bassEnergyRef={bassEnergyRef}
      />
      <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>
        {/* Beat flash overlay */}
        <div
          className={`${styles.beatFlash} ${isBeat ? styles.beatFlashActive : ''}`}
          style={{ '--beat-color': phaseColor } as React.CSSProperties}
        />

        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.phaseBlock}>
            <span className={`${styles.phaseLabel}${showVideo ? ` ${styles.phaseLabelVideo}` : ''}${isBeat ? ` ${styles.phaseLabelBeat}` : ''}`} style={{ color: phaseColor }}>
              {getPhaseLabel(state)}
            </span>
            {state.phase === 'BUILD' && (
              <div className={styles.curveRating}>
                <span className={styles.curveTag}>{state.currentCurve}</span>
                <button
                  className={`${styles.rateBtn} ${ratingFlash === 'up' ? styles.rateBtnActive : ''}`}
                  onClick={() => handleRateCurve(1)}
                  aria-label="Like this curve"
                  title="Like — curve appears more often"
                >▲</button>
                <button
                  className={`${styles.rateBtn} ${ratingFlash === 'down' ? styles.rateBtnActive : ''}`}
                  onClick={() => handleRateCurve(-1)}
                  aria-label="Dislike this curve"
                  title="Dislike — curve appears less often"
                >▼</button>
              </div>
            )}
          </div>
          <div className={`${styles.stats}${showVideo ? ` ${styles.statsVideo}` : ''}`}>
            {/* View mode toggle */}
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${!isVideoMode ? styles.viewToggleActive : ''}`}
                onClick={() => send({ type: 'SET_VIEW_MODE', mode: 'text' })}
              >
                TEXT
              </button>
              <button
                className={`${styles.viewToggleBtn} ${isVideoMode ? styles.viewToggleActive : ''}`}
                onClick={() => videoAvailable && send({ type: 'SET_VIEW_MODE', mode: 'video' })}
                disabled={!videoAvailable}
                title={!videoAvailable ? 'Add videos in Playlist to enable' : undefined}
              >
                VIDEO
              </button>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{state.edgeCount}</span>
              <span className={styles.statLabel}>edges</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatTime(state.elapsedMs)}</span>
              <span className={styles.statLabel}>time</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{Math.round(getReleaseChance(state.edgeCount) * 100)}%</span>
              <span className={styles.statLabel}>release</span>
            </div>
            {bpm > 0 && (
              <div className={styles.stat}>
                <span className={styles.statValue}>{bpm}</span>
                <span className={styles.statLabel}>bpm</span>
              </div>
            )}
          </div>
        </div>

        {/* Phase progress bar */}
        <div className={styles.progressBar}>
          <div
            className={`${styles.progressFill} ${isBeat ? styles.progressFillBeat : ''}`}
            style={{
              width: `${progressPct}%`,
              background: phaseColor,
              '--progress-color': phaseColor,
            } as React.CSSProperties}
          />
        </div>

        {/* Center: intensity gauge (+ waveform inline in video mode) */}
        <div className={`${showVideo ? styles.gaugeAreaVideo : styles.gaugeArea}${isBeat ? ` ${styles.gaugeAreaBeat}` : ''}`}>
          {/* Equalizer canvas — absolutely fills the gauge area, bars at bottom, particles fly upward */}
          {!showVideo && (
            <EnergyEqualizer
              analyserRef={analyserRef}
              bassEnergyRef={bassEnergyRef}
              phaseColor={phaseColor}
              isBeat={isBeat}
              intensity={state.intensity}
              mode="full"
            />
          )}
          {/* Event banner — absolutely overlaid so it doesn't add vertical height */}
          {state.activeEvent && (
            <div className={styles.eventBanner}>
              <span className={styles.eventType}>
                {state.activeEvent.type === 'INTENSITY_SPIKE' && 'INTENSITY SPIKE'}
                {state.activeEvent.type === 'FORCED_PAUSE' && 'FORCED PAUSE'}
                {state.activeEvent.type === 'HOLD_CHALLENGE' && 'HOLD CHALLENGE'}
              </span>
              <span className={styles.eventTimer}>
                {Math.ceil(eventRemaining / 1000)}s
              </span>
            </div>
          )}
          <div className={`${styles.intensityWrapper}${showVideo ? ` ${styles.intensityWrapperVideo}` : ''}`} style={{ position: 'relative', zIndex: 1 }}>
            <RadialGauge
              value={state.intensity}
              max={20}
              color={phaseColor}
              isBeat={isBeat}
            />
            <div
              className={`${styles.intensityNumber}${showVideo ? ` ${styles.intensityNumberVideo}` : ''}${isBeat ? ` ${styles.intensityNumberBeat}` : ''}`}
              style={{ color: phaseColor }}
            >
              {state.intensity}
            </div>
          </div>
          {/* Waveform moves into the gauge row in video mode */}
          {showVideo && (
            <div className={styles.waveformInRow}>
              <EnergyEqualizer
                analyserRef={analyserRef}
                bassEnergyRef={bassEnergyRef}
                phaseColor={phaseColor}
                isBeat={isBeat}
                intensity={state.intensity}
                mode="compact"
              />
            </div>
          )}
        </div>

        {/* Taunt text — only shown while still in DECISION */}
        {state.begDenialTaunt && state.phase === 'DECISION' && (
          <p className={styles.begTaunt} style={{ margin: 0 }}>{state.begDenialTaunt}</p>
        )}

        {/* Video panel below gauge area — always mounted so playback continues */}
        {videoAvailable && (
          <div className={styles.videoInline} style={showVideo ? undefined : { display: 'none' }}>
            <VideoPanel
              playlist={playlist}
              phase={state.phase}
              intensity={state.intensity}
              isBeat={isBeat}
            />
          </div>
        )}

        {/* Encouragement text */}
        <EncouragementDisplay
          phase={state.phase}
          intensity={state.intensity}
          feelingLevel={state.feelingLevel}
          lastSplashId={state.splash?.id ?? null}
          isBeat={isBeat}
          paused={state.paused}
          musicRef={musicRef}
        />

        {/* Feeling buttons + beg button inline */}
        <div className={styles.feelingLabel}>How close are you?</div>
        <div className={styles.feelingBar}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              className={`${styles.feelingBtn} ${state.feelingLevel === n ? styles.feelingActive : ''} ${state.feelingLevel === n && isBeat ? styles.feelingBeat : ''}`}
              onClick={() => send({ type: 'REPORT_FEELING', level: n })}
              style={{
                borderColor: n <= 3 ? 'var(--green)' : n <= 6 ? 'var(--orange)' : n <= 8 ? 'var(--red)' : 'var(--gold)',
                ...(state.feelingLevel === n ? {
                  background: n <= 3 ? 'var(--green)' : n <= 6 ? 'var(--orange)' : n <= 8 ? 'var(--red)' : 'var(--gold)',
                  color: '#000',
                } : {}),
              }}
            >
              {n}
            </button>
          ))}
          {state.phase === 'DECISION' && !state.releaseRolled && (
            <button
              className={styles.begBtn}
              disabled={state.hasBeggedThisDecision}
              onClick={() => send({ type: 'BEG' })}
            >
              {state.hasBeggedThisDecision ? 'DENIED' : 'BEG!'}
            </button>
          )}
        </div>

        {/* Per-device/toy panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0 0.25rem', maxHeight: '7rem', overflowY: 'auto', flexShrink: 0 }}>
          {state.devices.flatMap(slot => {
            const rowStyle = {
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              fontSize: '0.8rem',
            };
            if (slot.mode === 'mock') {
              if (!slot.enabled) return [];
              // Hub-level row for mock
              return [
                <div key={slot.id} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: '5rem', fontWeight: 600 }}>
                      {slot.label}
                    </span>
                    <span style={{ fontWeight: 700, color: phaseColor, minWidth: '2rem', textAlign: 'right' }}>
                      {deviceIntensities[slot.id] ?? 0}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 'auto' }}>
                      {getPresetById(slot.presetId ?? '')?.name ?? PATTERN_LABELS[slot.pattern]}
                    </span>
                    <ModeToggle
                      inputMode={slot.inputMode}
                      onAuto={() => send({ type: 'SET_INPUT_MODE', deviceId: slot.id, inputMode: 'auto' })}
                      onBeat={() => send({ type: 'SET_INPUT_MODE', deviceId: slot.id, inputMode: 'beat' })}
                    />
                  </div>
                  <PresetPicker toyType={null} currentPresetId={slot.presetId} onChange={presetId => send({ type: 'SET_PRESET', deviceId: slot.id, presetId })} />
                </div>,
              ];
            }

            // Lovense: one row per enabled toy, or nothing if all disabled/absent
            const enabledToys = slot.toyConfigs.filter(tc => tc.enabled);
            if (slot.toyConfigs.length === 0 || enabledToys.length === 0) {
              return [
                <div key={slot.id} style={rowStyle}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '5rem', fontWeight: 600 }}>
                    {slot.label}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>No toys</span>
                </div>,
              ];
            }

            return enabledToys.map((tc: ToyConfig) => {
              const key = `${slot.id}:${tc.toy.id}`;
              return (
                <div key={key} style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {/* Status dot */}
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                      background: tc.toy.status === 1 ? 'var(--green)' : 'var(--text-muted)',
                    }} />
                    <span style={{ color: 'var(--text-muted)', flex: 1, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tc.toy.nickName || tc.toy.name || tc.toy.type}
                    </span>
                    {deviceAxisIntensities[key]
                      ? <span style={{ fontWeight: 700, color: phaseColor, fontSize: '0.72rem' }}>
                          {Object.entries(deviceAxisIntensities[key]).map(([fn, lvl]) =>
                            `${AXIS_ABBR[fn] ?? fn}:${lvl ?? 0}`
                          ).join(' / ')}
                        </span>
                      : <span style={{ fontWeight: 700, color: phaseColor, minWidth: '2rem', textAlign: 'right' }}>
                          {deviceIntensities[key] ?? 0}
                        </span>
                    }
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      🔋{tc.toy.battery}%
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      {getPresetById(tc.presetId ?? '')?.name ?? PATTERN_LABELS[tc.pattern]}
                    </span>
                    <ModeToggle
                      inputMode={tc.inputMode}
                      onAuto={() => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { inputMode: 'auto' } })}
                      onBeat={() => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { inputMode: 'beat' } })}
                    />
                  </div>
                  <PresetPicker toyType={tc.toy.type} currentPresetId={tc.presetId} onChange={presetId => send({ type: 'SET_PRESET', deviceId: slot.id, toyId: tc.toy.id, presetId })} />
                </div>
              );
            });
          })}
        </div>

        {/* Device error banner */}
        {Object.entries(deviceErrors).map(([id, msg]) => {
          const slot = state.devices.find(d => d.id === id);
          return (
            <div key={id} style={{
              padding: '0.4rem 1rem',
              background: 'rgba(255,60,60,0.15)',
              border: '1px solid var(--red)',
              borderRadius: '8px',
              fontSize: '0.75rem',
              color: 'var(--red)',
              textAlign: 'center',
            }}>
              ⚠ {slot?.label ?? id}: {msg}
            </div>
          );
        })}

        {/* Bottom controls */}
        <div className={styles.bottomBar}>
          <button
            className={styles.stopBtn}
            onClick={() => send({ type: 'EMERGENCY_STOP' })}
          >
            STOP (0)
          </button>
          <button
            className={styles.pauseBtn}
            onClick={() => state.paused ? send({ type: 'RESUME' }) : send({ type: 'PAUSE' })}
          >
            {state.paused ? 'RESUME' : 'PAUSE'} (Space)
          </button>
          <button
            className={styles.playlistBtn}
            onClick={() => send({ type: 'GO_PLAYLIST' })}
          >
            Playlist
          </button>
        </div>
      </div>
    </div>
  );
}
