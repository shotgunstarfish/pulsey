import type { SessionAction } from '../../engine/sessionMachine.ts';
import styles from './IdleScreen.module.css';

interface IdleScreenProps {
  send: (action: SessionAction) => void;
}

export function IdleScreen({ send }: IdleScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Pulse Session</h1>
        <p className={styles.subtitle}>Control. Denial. Release.</p>
        <div className={styles.actions}>
          <button
            className={styles.startBtn}
            onClick={() => send({ type: 'START_SESSION' })}
          >
            START
          </button>
          <div className={styles.secondary}>
            <button
              className={styles.linkBtn}
              onClick={() => send({ type: 'GO_SETUP' })}
            >
              Setup Device
            </button>
            <button
              className={styles.linkBtn}
              onClick={() => send({ type: 'GO_HISTORY' })}
            >
              History
            </button>
            <button
              className={styles.linkBtn}
              onClick={() => send({ type: 'GO_PLAYLIST' })}
            >
              Playlist
            </button>
            <button
              className={styles.linkBtn}
              onClick={() => send({ type: 'GO_PATTERN_LIBRARY' })}
            >
              Pattern Library
            </button>
          </div>
        </div>
        <p className={styles.hint}>Press 1-9 during session to report feeling. 0 = stop. Space = pause.</p>
      </div>
    </div>
  );
}
