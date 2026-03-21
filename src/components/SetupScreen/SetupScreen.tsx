import { useState } from 'react';
import type { SessionAction, SessionState, DeviceSlot, LovenseToy } from '../../engine/sessionMachine.ts';
import { ALL_PATTERNS, PATTERN_LABELS, PATTERN_DESCRIPTIONS } from '../../engine/toyPatterns.ts';

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
                    <span style={{ flex: 1, color: 'var(--text)', fontWeight: 600 }}>
                      {tc.toy.nickName || tc.toy.name || tc.toy.type}
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
                  {/* Per-toy pattern selector */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pattern</span>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {ALL_PATTERNS.map(p => (
                        <button
                          key={p}
                          title={PATTERN_DESCRIPTIONS[p]}
                          onClick={() => send({ type: 'UPDATE_TOY_CONFIG', deviceId: slot.id, toyId: tc.toy.id, patch: { pattern: p } })}
                          style={{
                            padding: '0.25rem 0.45rem',
                            background: tc.pattern === p ? 'var(--orange)' : 'var(--surface2)',
                            color: tc.pattern === p ? '#000' : 'var(--text)',
                            border: '1px solid var(--border)', borderRadius: '6px',
                            cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem',
                          }}
                        >{PATTERN_LABELS[p]}</button>
                      ))}
                    </div>
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

          {/* Pattern selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isMock ? 'Pattern' : 'Default Pattern (for new toys)'}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {ALL_PATTERNS.map(p => (
                <button
                  key={p}
                  title={PATTERN_DESCRIPTIONS[p]}
                  onClick={() => patch({ pattern: p })}
                  style={{
                    flex: 1,
                    padding: '0.4rem 0.3rem',
                    background: slot.pattern === p ? 'var(--orange)' : 'var(--surface)',
                    color: slot.pattern === p ? '#000' : 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    minWidth: 0,
                  }}
                >{PATTERN_LABELS[p]}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function SetupScreen({ state, send }: SetupScreenProps) {
  const canRemove = state.devices.length > 1;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '2.5rem 3rem',
        maxWidth: '520px',
        width: '100%',
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
    </div>
  );
}
