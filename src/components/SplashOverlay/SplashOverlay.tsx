import { useEffect } from 'react';
import type { SplashEntry, SessionAction } from '../../engine/sessionMachine.ts';
import styles from './SplashOverlay.module.css';

interface SplashOverlayProps {
  splash: SplashEntry | null;
  send: (action: SessionAction) => void;
}

export function SplashOverlay({ splash, send }: SplashOverlayProps) {
  useEffect(() => {
    if (!splash) return;
    const timer = setTimeout(() => {
      send({ type: 'CLEAR_SPLASH' });
    }, 1500);
    return () => clearTimeout(timer);
  }, [splash, send]);

  if (!splash) return null;

  return (
    <div className={styles.overlay}>
      <span
        key={splash.id}
        className={`${styles.text} ${styles[splash.color]}`}
      >
        {splash.text}
      </span>
    </div>
  );
}
