import type { SessionAction } from '../../engine/sessionMachine.ts';
import { loadHistory, clearHistory } from '../../engine/sessionHistory.ts';
import type { SessionRecord } from '../../engine/sessionHistory.ts';

interface HistoryScreenProps {
  send: (action: SessionAction) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

export function HistoryScreen({ send }: HistoryScreenProps) {
  const history: SessionRecord[] = loadHistory();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minHeight: '100vh',
      padding: '2rem',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '2rem',
        maxWidth: '640px',
        width: '100%',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Session History</h2>
          {history.length > 0 && (
            <button
              onClick={() => { clearHistory(); send({ type: 'GO_HISTORY' }); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--red)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Clear All
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
            No sessions recorded yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Edges</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {history.map(rec => (
                <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{formatDate(rec.startedAt)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{rec.edgeCount}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{formatDuration(rec.durationMs)}</td>
                  <td style={{
                    ...tdStyle,
                    textAlign: 'center',
                    color: rec.outcome === 'release' ? 'var(--gold)' : 'var(--text-muted)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    fontSize: '0.8rem',
                    letterSpacing: '0.05em',
                  }}>
                    {rec.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.5rem',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '0.6rem 0.5rem',
  fontSize: '0.85rem',
  color: 'var(--text)',
};
