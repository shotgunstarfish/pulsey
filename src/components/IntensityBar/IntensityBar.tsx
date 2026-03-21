import styles from './IntensityBar.module.css';

interface IntensityBarProps {
  intensity: number; // 0-20
  isBeat?: boolean;
}

function getIntensityColor(intensity: number): string {
  if (intensity <= 6) return 'var(--green)';
  if (intensity <= 12) return 'var(--orange)';
  return 'var(--red)';
}

function getGlowIntensity(intensity: number): string {
  const alpha = Math.min(1, intensity / 20);
  const color = getIntensityColor(intensity);
  return `0 0 ${20 + intensity * 3}px ${color.replace(')', `, ${alpha})`).replace('var(', '')}`;
}

export function IntensityBar({ intensity, isBeat = false }: IntensityBarProps) {
  const percent = (intensity / 20) * 100;
  const color = getIntensityColor(intensity);

  return (
    <div className={styles.container}>
      <div className={styles.label}>{intensity}</div>
      <div className={`${styles.track}${isBeat ? ` ${styles.trackBeat}` : ''}`}>
        <div
          className={styles.fill}
          style={{
            height: `${percent}%`,
            backgroundColor: color,
            boxShadow: intensity > 0 ? getGlowIntensity(intensity) : 'none',
          }}
        />
        {/* Tick marks */}
        {Array.from({ length: 21 }, (_, i) => (
          <div
            key={i}
            className={styles.tick}
            style={{ bottom: `${(i / 20) * 100}%` }}
          >
            {i % 5 === 0 && (
              <span className={styles.tickLabel}>{i}</span>
            )}
          </div>
        ))}
      </div>
      <div className={styles.label}>0</div>
    </div>
  );
}
