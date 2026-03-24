/**
 * Radial arc gauge — 270° dial around the intensity number.
 * Sized via the parent's font-size using em units, so it scales
 * automatically between text mode (big) and video mode (compact).
 */

const R   = 44;
const CX  = 50;
const CY  = 50;
const CIRC = 2 * Math.PI * R;           // ≈ 276.5
const SWEEP = 270;
const TRACK = (SWEEP / 360) * CIRC;     // ≈ 207.4
// Rotate so gap is centred at the bottom (7-o'clock start)
const ROT = 135;

interface RadialGaugeProps {
  value:   number;   // 0–20
  max:     number;
  color:   string;   // CSS color / CSS variable e.g. 'var(--blue)'
  isBeat:  boolean;
  /** Diameter as an em multiple of the wrapper font-size (default 1.8) */
  emSize?: number;
}

export function RadialGauge({ value, max, color, isBeat, emSize = 1.8 }: RadialGaugeProps) {
  const pct  = Math.max(0, Math.min(1, value / max));
  const fill = pct * TRACK;

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      style={{
        position:  'absolute',
        width:     `${emSize}em`,
        height:    `${emSize}em`,
        top:       '50%',
        left:      '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        overflow:  'visible',
      }}
    >
      {/* Track arc */}
      <circle
        cx={CX} cy={CY} r={R}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${TRACK} ${CIRC * 2}`}
        transform={`rotate(${ROT} ${CX} ${CY})`}
      />
      {/* Fill arc */}
      <circle
        cx={CX} cy={CY} r={R}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${fill} ${CIRC * 2}`}
        transform={`rotate(${ROT} ${CX} ${CY})`}
        style={{
          transition: 'stroke-dasharray 0.12s ease-out, stroke 0.3s',
          filter: isBeat
            ? `drop-shadow(0 0 5px ${color}) brightness(1.35)`
            : `drop-shadow(0 0 0px ${color})`,
        }}
      />
    </svg>
  );
}
