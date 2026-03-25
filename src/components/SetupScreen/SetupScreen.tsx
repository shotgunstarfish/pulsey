import { useState } from 'react';
import type { SessionAction, SessionState, DeviceSlot, LovenseToy } from '../../engine/sessionMachine.ts';
import { PATTERN_LABELS } from '../../engine/toyPatterns.ts';
import { getPresetsForToy, getPresetById } from '../../engine/patternPresets.ts';
import { getCapabilities, isKnownToyType } from '../../engine/toyCapabilities.ts';
import type { ToyFunction } from '../../engine/toyCapabilities.ts';
import { PatternPreview } from '../PatternPreview/PatternPreview.tsx';

interface SetupScreenProps {
  state: SessionState;
  send: (action: SessionAction) => void;
}

interface DeviceCardProps {
  slot: DeviceSlot;
  canRemove: boolean;
  send: (action: SessionAction) => void;
}

function DeviceCard({ slot, canRemove, send }: DeviceCardProps) {
  const [connectStatus, setConnectStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const isMock = slot.mode === 'mock';
  const toyConfigs = slot.toyConfigs;

  function patch(p: Partial<Omit<DeviceSlot, 'id'>>) {
    send({ type: 'UPDATE_DEVICE', id: slot.id, patch: p });
  }

  async function handleConnect() {
    const cfg = slot.lovenseConfig;
    if (!cfg) return;
    setConnectStatus('connecting');
    setConnectError(null);

    const base = `${cfg.ssl ? 'https' : 'http'}://${cfg.domain}:${cfg.port}`;

    try {
      const res = await fetch(`${base}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'GetToys', apiVer: 1 }),
      });

      if (!res.ok) {
        setConnectStatus('error');
        setConnectError(`HTTP ${res.status}`);
        return;
      }

      const json = await res.json() as { code?: number; data?: unknown };
      if (json.code && json.code !== 200) {
        setConnectStatus('error');
        setConnectError(`API code ${json.code}`);
        return;
      }

      // data (and data.toys) may be JSON strings — some Lovense versions double-encode
      let data = json.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data) as unknown; } catch { /* leave as-is */ }
      }

      let toysRaw = (data as Record<string, unknown>)?.toys;
      if (typeof toysRaw === 'string') {
        try { toysRaw = JSON.parse(toysRaw) as unknown; } catch { /* leave as-is */ }
      }

      const toyList =
        toysRaw && typeof toysRaw === 'object' && !Array.isArray(toysRaw)
          ? Object.values(toysRaw as Record<string, LovenseToy>)
          : [];

      setConnectStatus('connected');
      send({ type: 'SET_TOYS', deviceId: slot.id, toys: toyList });
    } catch (err) {
      setConnectStatus('error');
      setConnectError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      {/* Header: label + enable + remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <input
          type="text"
          value={slot.label}
          onChange={e => patch({ label: e.target.value })}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text)',
            fontSize: '1rem',
            fontWeight: 700,
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={e => patch({ enabled: e.target.checked })}
            style={{ accentColor: 'var(--green)' }}
          />
          On
        </label>
        <button
          onClick={() => send({ type: 'REMOVE_DEVICE', id: slot.id })}
          disabled={!canRemove}
          style={{
            padding: '0.3rem 0.6rem',
            background: canRemove ? 'var(--red)' : 'var(--surface)',
            color: canRemove ? '#000' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: canRemove ? 'pointer' : 'not-allowed',
            fontWeight: 700,
            fontSize: '0.75rem',
            opacity: canRemove ? 1 : 0.4,
          }}
        >
          Remove
        </button>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => patch({ mode: 'mock' })}
          style={{
            flex: 1,
            padding: '0.55rem',
            background: isMock ? 'var(--blue)' : 'var(--surface)',
            color: isMock ? '#000' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.85rem',
          }}
        >
          MOCK
        </button>
        <button
          onClick={() => patch({
            mode: 'lovense',
            lovenseConfig: slot.lovenseConfig ?? { domain: '127.0.0.1', port: 20010, ssl: false },
          })}
          style={{
            flex: 1,
            padding: '0.55rem',
            background: !isMock ? 'var(--purple)' : 'var(--surface)',
            color: !isMock ? '#fff' : 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.85rem',
          }}
        >
          LOVENSE
        </button>
      </div>

      {/* Lovense config */}
      {!isMock && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Domain / IP</span>
            <input
              type="text"
              value={slot.lovenseConfig?.domain ?? '127.0.0.1'}
              onChange={e => patch({
                lovenseConfig: {
                  ...slot.lovenseConfig,
                  domain: e.target.value,
                  port: slot.lovenseConfig?.port ?? 20010,
                  ssl: slot.lovenseConfig?.ssl ?? false,
                },
              })}
              style={{
                padding: '0.5rem 0.7rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text)',
                fontSize: '0.9rem',
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Port</span>
            <input
              type="text"
              value={String(slot.lovenseConfig?.port ?? 20010)}
              onChange={e => {
                const portNum = parseInt(e.target.value, 10);
                if (!isNaN(portNum)) {
                  patch({
                    lovenseConfig: {
                      domain: slot.lovenseConfig?.domain ?? '127.0.0.1',
                      port: portNum,
                      ssl: slot.lovenseConfig?.ssl ?? false,
                    },
                  });
                }
              }}
              style={{
                padding: '0.5rem 0.7rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text)',
                fontSize: '0.9rem',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={slot.lovenseConfig?.ssl ?? false}
              onChange={e => {
                const ssl = e.target.checked;
                const currentPort = slot.lovenseConfig?.port;
                // Swap default port when toggling SSL unless user has customised it
                const defaultPort = ssl ? 30010 : 20010;
                const otherDefault = ssl ? 20010 : 30010;
                const port = currentPort === otherDefault || currentPort == null ? defaultPort : currentPort;
                patch({ lovenseConfig: { domain: slot.lovenseConfig?.domain ?? '127.0.0.1', port, ssl } });
              }}
              style={{ accentColor: 'var(--purple)' }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Use HTTPS (SSL)
            </span>
          </label>
          <button
            onClick={handleConnect}
            style={{
              padding: '0.55rem',
              background: 'var(--purple)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            {connectStatus === 'connecting' ? 'Connecting...' : 'Test Connection'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              flexShrink: 0,
              background: connectStatus === 'connected' ? 'var(--green)'
                : connectStatus === 'error' ? 'var(--red)'
                : 'var(--text-muted)',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: '0.75rem', color: connectStatus === 'error' ? 'var(--red)' : 'var(--text-muted)' }}>
              {connectStatus === 'connected' ? `Connected — ${toyConfigs.length} toy${toyConfigs.length !== 1 ? 's' : ''} found`
                : connectStatus === 'error' ? `Failed${connectError ? `: ${connectError}` : ''}`
                : connectStatus === 'connecting' ? 'Connecting...'
                : toyConfigs.length > 0 ? `${toyConfigs.length} toy${toyConfigs.length !== 1 ? 's' : ''} configured`
                : 'Not tested'}
            </span>
          </div>

          {/* Test Patterns toggle */}
          {toyConfigs.length > 0 && (
            <button
              onClick={() => setShowPreview(prev => !prev)}
              style={{
                padding: '0.4rem 0.75rem',
                background: showPreview ? 'var(--purple)' : 'var(--surface)',
                color: showPreview ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.8rem',
              }}
            >
              {showPreview ? 'Hide Pattern Preview' : 'Test Patterns'}
            </button>
          )}

          {/* Pattern preview (collapsible) */}
          {showPreview && toyConfigs.length > 0 && (
            <PatternPreview slot={slot} send={send} />
          )}

          {/* Per-toy controls */}
          {toyConfigs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {toyConfigs.map(tc => (
                <div key={tc.toy.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                }}>
                  {/* Toy header: enable + name + status + battery */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={tc.enabled}
                      onChange={e => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { enabled: e.target.checked } })}
                      style={{ accentColor: 'var(--green)', flexShrink: 0 }}
                    />
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                      background: tc.toy.status === 1 ? 'var(--green)' : 'var(--text-muted)',
                    }} />
                    <span style={{ flex: 1, color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      {tc.toy.nickName || tc.toy.name || tc.toy.type}
                      {isKnownToyType(tc.toy.type) && (
                        <span style={{ color: 'var(--green)', fontSize: '0.75rem', fontWeight: 700 }} title="Pattern generator available">✓</span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      🔋 {tc.toy.battery}%
                    </span>
                  </div>
                  {/* Per-toy intensity scale */}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Intensity Scale: {Math.round(tc.intensityScale * 100)}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(tc.intensityScale * 100)}
                      onChange={e => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { intensityScale: parseInt(e.target.value, 10) / 100 } })}
                      style={{ accentColor: 'var(--purple)', width: '100%' }}
                    />
                  </label>
                  {/* Per-toy input mode */}
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { inputMode: 'auto' } })}
                      style={{
                        flex: 1, padding: '0.35rem',
                        background: tc.inputMode === 'auto' ? 'var(--blue)' : 'var(--surface2)',
                        color: tc.inputMode === 'auto' ? '#000' : 'var(--text)',
                        border: '1px solid var(--border)', borderRadius: '6px',
                        cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                      }}
                    >AUTO</button>
                    <button
                      onClick={() => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { inputMode: 'beat' } })}
                      style={{
                        flex: 1, padding: '0.35rem',
                        background: tc.inputMode === 'beat' ? 'var(--purple)' : 'var(--surface2)',
                        color: tc.inputMode === 'beat' ? '#fff' : 'var(--text)',
                        border: '1px solid var(--border)', borderRadius: '6px',
                        cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                      }}
                    >BEAT</button>
                  </div>
                  {/* Per-toy preset selector */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Pattern Preset
                      {getCapabilities(tc.toy.type).length > 1 && (
                        <span style={{ marginLeft: '0.4rem', color: 'var(--purple)', fontWeight: 600 }}>
                          ({getCapabilities(tc.toy.type).map((fn: ToyFunction) => fn.charAt(0).toUpperCase() + fn.slice(1)).join(' + ')})
                        </span>
                      )}
                    </span>
                    <select
                      value={tc.presetId ?? ''}
                      onChange={e => send({ type: 'SET_PRESET', deviceId: slot.id, toyId: tc.toy.id, presetId: e.target.value })}
                      style={{
                        padding: '0.35rem 0.5rem',
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--text)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      {getPresetsForToy(tc.toy.type).map(p => (
                        <option key={p.id} value={p.id}>{p.name} — {p.description}</option>
                      ))}
                    </select>
                    {tc.presetId && getPresetById(tc.presetId) && getCapabilities(tc.toy.type).length > 1 && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', paddingLeft: '0.2rem' }}>
                        {getCapabilities(tc.toy.type).map((fn: ToyFunction) => {
                          const axisCfg = getPresetById(tc.presetId!)?.axes[fn];
                          if (!axisCfg) return null;
                          return (
                            <span key={fn} style={{ marginRight: '0.75rem' }}>
                              {fn}: {PATTERN_LABELS[axisCfg.pattern]}
                              {axisCfg.phaseOffsetMs > 0 ? ` +${axisCfg.phaseOffsetMs}ms` : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isMock && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          Mock mode logs vibration commands to the console.
        </p>
      )}

      {/* Hub-level controls: mock mode always, or lovense with no toys yet (used as defaults) */}
      {(isMock || toyConfigs.length === 0) && (
        <>
          {/* Intensity scale slider */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isMock ? 'Intensity Scale' : 'Default Intensity Scale (for new toys)'}: {Math.round(slot.intensityScale * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(slot.intensityScale * 100)}
              onChange={e => patch({ intensityScale: parseInt(e.target.value, 10) / 100 })}
              style={{ accentColor: 'var(--purple)', width: '100%' }}
            />
          </label>

          {/* Input mode toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isMock ? 'Input Mode' : 'Default Input Mode (for new toys)'}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => patch({ inputMode: 'auto' })}
                style={{
                  flex: 1,
                  padding: '0.45rem',
                  background: slot.inputMode === 'auto' ? 'var(--blue)' : 'var(--surface)',
                  color: slot.inputMode === 'auto' ? '#000' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}
              >
                AUTO
              </button>
              <button
                onClick={() => patch({ inputMode: 'beat' })}
                style={{
                  flex: 1,
                  padding: '0.45rem',
                  background: slot.inputMode === 'beat' ? 'var(--purple)' : 'var(--surface)',
                  color: slot.inputMode === 'beat' ? '#fff' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}
              >
                BEAT
              </button>
            </div>
          </div>

          {/* Pattern preset selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isMock ? 'Pattern Preset' : 'Default Pattern Preset (for new toys)'}
            </span>
            <select
              value={slot.presetId ?? 'vibe-direct'}
              onChange={e => send({ type: 'SET_PRESET', deviceId: slot.id, presetId: e.target.value })}
              style={{
                padding: '0.4rem 0.5rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              {getPresetsForToy(null).map(p => (
                <option key={p.id} value={p.id}>{p.name} — {p.description}</option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Setup Guide panel ────────────────────────────────────────────────────────

const STEPS = [
  {
    n: '1',
    title: 'Download Lovense Remote',
    body: 'Install the free Lovense Remote app from the App Store (iPhone) or Google Play (Android).',
  },
  {
    n: '2',
    title: 'Connect your toy',
    body: 'Open the app, tap the + icon, and pair your Lovense toy via Bluetooth. Confirm it shows as online.',
  },
  {
    n: '3',
    title: 'Open Game Mode',
    ios:  'Tap the Discover tab at the bottom → tap Game Mode → toggle Enable LAN on.',
    android: 'Tap the Discover tab at the bottom → tap Game Mode → toggle Enable LAN on.',
  },
  {
    n: '4',
    title: 'Note the IP & port',
    body: 'The app shows your phone\'s local IP (e.g. 192.168.1.42) and port. Default HTTP port is 20010.',
  },
  {
    n: '5',
    title: 'Same Wi-Fi required',
    body: 'Your phone and this computer must be on the same Wi-Fi network. Hotspot or LAN both work.',
  },
  {
    n: '6',
    title: 'Test Connection',
    body: 'Enter the IP + port 20010 on the left and click Test Connection. Your toys will appear automatically.',
  },
];

const TIPS = [
  'Game Mode (Enable LAN) does not persist — you must re-toggle it every time you reopen the app or reconnect a toy.',
  'Android: go to Settings → Battery → Battery Optimization, find Lovense Remote, and set it to Unrestricted.',
  'iPhone: keep Lovense Remote in the foreground during use — iOS suspends the local server when the app is backgrounded.',
  'Connection refused? Check Windows Firewall — add an inbound rule allowing TCP on port 34567.',
];

function SetupGuide() {
  const [tab, setTab] = useState<'ios' | 'android'>('ios');
  const [tipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));

  const tabBtn = (t: 'ios' | 'android', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        flex: 1,
        padding: '0.45rem',
        background: tab === t ? 'var(--purple)' : 'var(--surface2)',
        color: tab === t ? '#fff' : 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: '7px',
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: '0.8rem',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '16px',
      padding: '2rem',
      width: '340px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '1.25rem',
      alignSelf: 'flex-start',
    }}>
      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>
        Lovense Setup Guide
      </h3>

      {/* Platform tabs */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {tabBtn('ios', '🍎 iPhone / iOS')}
        {tabBtn('android', '🤖 Android')}
      </div>

      {/* Steps */}
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {STEPS.map((s, i) => (
          <li key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <span style={{
              flexShrink: 0,
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: 'var(--purple)',
              color: '#fff',
              fontSize: '0.7rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '1px',
            }}>
              {s.n}
            </span>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.18rem' }}>
                {s.title}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {'ios' in s && 'android' in s
                  ? (tab === 'ios' ? s.ios : s.android)
                  : s.body}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)' }} />

      {/* Tip */}
      <div style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.65rem 0.8rem',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>💡</span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {TIPS[tipIdx]}
        </span>
      </div>

      {/* Lovense app store links note */}
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Search <strong style={{ color: 'var(--text)' }}>Lovense Remote</strong> in the{' '}
        {tab === 'ios' ? 'App Store' : 'Google Play Store'} — it\'s free.
      </p>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function SetupScreen({ state, send }: SetupScreenProps) {
  const canRemove = state.devices.length > 1;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      height: '100%',
      overflowY: 'auto',
      padding: '2rem',
    }}>
      {/* Two-column layout: device cards left, guide right */}
      <div style={{
        display: 'flex',
        gap: '1.5rem',
        alignItems: 'flex-start',
        width: '100%',
        maxWidth: '900px',
      }}>
        {/* Left — device cards */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '2.5rem 3rem',
          flex: 1,
          minWidth: 0,
        }}>
          <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
            Device Setup
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {state.devices.map(slot => (
              <DeviceCard key={slot.id} slot={slot} canRemove={canRemove} send={send} />
            ))}
          </div>

          <button
            onClick={() => send({ type: 'ADD_DEVICE' })}
            style={{
              display: 'block',
              width: '100%',
              margin: '1rem 0 0',
              padding: '0.75rem',
              background: 'var(--surface2)',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            + Add Device
          </button>

          <button
            onClick={() => send({ type: 'GO_IDLE' })}
            style={{
              display: 'block',
              margin: '2rem auto 0',
              padding: '0.6rem 2rem',
              background: 'var(--surface2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Back
          </button>
        </div>

        {/* Right — setup guide */}
        <SetupGuide />
      </div>
    </div>
  );
}
