import { useRef } from 'react';
import styles from './SessionBackground.module.css';

/** Phase color CSS var -> raw RGB triplet for use in rgba() */
const PHASE_RGB: Record<string, string> = {
  'var(--blue)':       '51, 153, 255',
  'var(--orange)':     '255, 102, 0',
  'var(--red)':        '255, 51, 51',
  'var(--gold)':       '255, 215, 0',
  'var(--purple)':     '153, 51, 255',
  'var(--green)':      '51, 255, 153',
  'var(--text-muted)': '102, 102, 102',
};

function rgb(phaseColor: string): string {
  return PHASE_RGB[phaseColor] ?? '255, 102, 0';
}

/**
 * Deterministic pseudo-random dot positions.
 * No Math.random -- stable across renders without useMemo.
 */
const DOTS = Array.from({ length: 22 }, (_, i) => ({
  x: ((i * 47 + 13) * 71 % 97) / 97 * 96 + 2,
  y: ((i * 61 + 7)  * 83 % 89) / 89 * 92 + 4,
  size: 1.5 + (i % 4) * 0.4,
  breathDelay: ((i * 0.37) % 4).toFixed(2),
  breathDuration: (3.5 + (i % 5) * 0.6).toFixed(1),
  waveDelay: ((i % 6) * 0.05).toFixed(2),
}));

interface Props {
  phaseColor: string;
  isBeat: boolean;
  intensity: number;
}

export function SessionBackground({ phaseColor, isBeat, intensity }: Props) {
  const beatKeyRef = useRef(0);
  const prevBeatRef = useRef(false);
  if (isBeat && !prevBeatRef.current) beatKeyRef.current++;
  prevBeatRef.current = isBeat;

  const r = rgb(phaseColor);
  const orbAlpha1 = (0.05 + (intensity / 20) * 0.09).toFixed(3);
  const orbAlpha2 = (0.04 + (intensity / 20) * 0.06).toFixed(3);
  const orbAlpha3 = (0.03 + (intensity / 20) * 0.05).toFixed(3);

  return (
    <div className={styles.root} aria-hidden="true">
      {/* Dot grid texture */}
      <div
        className={styles.dotGrid}
        style={{ '--grid-rgb': r } as React.CSSProperties}
      />

      {/* Breathing orbs */}
      <div
        className={styles.orb1}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha1}) 0%, transparent 65%)` }}
      />
      <div
        className={styles.orb2}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha2}) 0%, transparent 65%)` }}
      />
      <div
        className={styles.orb3}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha3}) 0%, transparent 65%)` }}
      />

      {/* Beat ring -- key remount restarts animation on each beat */}
      <div
        key={beatKeyRef.current}
        className={`${styles.beatRing} ${isBeat ? styles.beatRingFire : ''}`}
        style={{ '--ring-rgb': r } as React.CSSProperties}
      />

      {/* Floating dot field */}
      {DOTS.map((dot, i) => (
        <div
          key={i}
          className={`${styles.dot} ${isBeat ? styles.dotBeat : ''}`}
          style={{
            left: `${dot.x}%`,
            top: `${dot.y}%`,
            width: `${dot.size}px`,
            height: `${dot.size}px`,
            '--dot-rgb': r,
            '--breath-delay': `${dot.breathDelay}s`,
            '--breath-dur': `${dot.breathDuration}s`,
            '--wave-delay': `${dot.waveDelay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
