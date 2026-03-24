import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';

/** Hex colors matching phase CSS vars -- canvas can't read CSS custom properties */
const PHASE_COLOR_HEX: Record<string, string> = {
  'var(--blue)': '#3399ff',
  'var(--orange)': '#ff6600',
  'var(--red)': '#ff3333',
  'var(--gold)': '#ffd700',
  'var(--purple)': '#9933ff',
  'var(--green)': '#33ff99',
  'var(--text-muted)': '#888888',
  'var(--text)': '#e0e0e0',
};

function resolveColor(cssVar: string): string {
  return PHASE_COLOR_HEX[cssVar] ?? '#3399ff';
}

/** Parse hex color to [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

interface BassWaveformProps {
  bassEnergyRef: RefObject<number>;
  phaseColor: string;
  isBeat: boolean;
}

const HISTORY_SIZE   = 80;
const SAMPLE_INTERVAL = 3;       // sample every N frames (~50ms at 60fps)
const CYCLES          = 1;       // visible sine cycles across full history
const PHASE_STEP      = (2 * Math.PI * CYCLES) / HISTORY_SIZE; // radians per sample

/** Initialise phase history so the rightmost entry is at peak (π/2) */
function makeInitialPhases(): number[] {
  return Array.from({ length: HISTORY_SIZE }, (_, i) =>
    Math.PI / 2 - (HISTORY_SIZE - 1 - i) * PHASE_STEP,
  );
}

export function BassWaveform({ bassEnergyRef, phaseColor, isBeat }: BassWaveformProps) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const energyHist      = useRef<number[]>(new Array(HISTORY_SIZE).fill(0));
  const phaseHist       = useRef<number[]>(makeInitialPhases());
  const currentPhase    = useRef(Math.PI / 2);
  const frameCount      = useRef(0);
  const rafRef          = useRef(0);
  const isBeatRef       = useRef(false);
  const prevBeatRef     = useRef(false);
  isBeatRef.current = isBeat;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hex = resolveColor(phaseColor);
    const [r, g, b] = hexToRgb(hex);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      frameCount.current++;

      const beat = isBeatRef.current;

      // Rising edge: snap current phase to the nearest peak (π/2)
      if (beat && !prevBeatRef.current) {
        const p   = currentPhase.current;
        const mod = ((p % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const fwd = ((Math.PI / 2 - mod + 2 * Math.PI) % (2 * Math.PI));
        const bwd = 2 * Math.PI - fwd;
        currentPhase.current = fwd <= bwd ? p + fwd : p - bwd;
      }
      prevBeatRef.current = beat;

      // Push a new sample at reduced rate
      if (frameCount.current % SAMPLE_INTERVAL === 0) {
        currentPhase.current += PHASE_STEP;
        const energy = Math.min(1, bassEnergyRef.current ?? 0);
        energyHist.current.push(energy);
        phaseHist.current.push(currentPhase.current);
        if (energyHist.current.length > HISTORY_SIZE) {
          energyHist.current.shift();
          phaseHist.current.shift();
        }
      }

      const w   = canvas!.width;
      const h   = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      const es  = energyHist.current;
      const ps  = phaseHist.current;
      const len = es.length;
      if (len < 2) return;

      // y-value for each sample: sine-modulated amplitude rises from bottom
      // sinVal ∈ [0,1]: 1 on beat-peak, 0 on trough
      const ys = es.map((e, i) => {
        const sinVal = (1 + Math.sin(ps[i])) / 2;
        return h - e * sinVal * h * 0.92;
      });

      // ── Filled smooth curve ───────────────────────────────
      ctx!.beginPath();
      ctx!.moveTo(0, h);
      ctx!.lineTo(0, ys[0]);
      for (let i = 1; i < len; i++) {
        const x0 = ((i - 1) / (HISTORY_SIZE - 1)) * w;
        const x1 = (i       / (HISTORY_SIZE - 1)) * w;
        const mx = (x0 + x1) / 2;
        ctx!.quadraticCurveTo(x0, ys[i - 1], mx, (ys[i - 1] + ys[i]) / 2);
      }
      ctx!.lineTo(w, ys[len - 1]);
      ctx!.lineTo(w, h);
      ctx!.closePath();

      const grad = ctx!.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${beat ? 0.85 : 0.55})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.04)`);
      ctx!.fillStyle = grad;
      ctx!.fill();

      // ── Top edge stroke ───────────────────────────────────
      ctx!.beginPath();
      ctx!.moveTo(0, ys[0]);
      for (let i = 1; i < len; i++) {
        const x0 = ((i - 1) / (HISTORY_SIZE - 1)) * w;
        const x1 = (i       / (HISTORY_SIZE - 1)) * w;
        const mx = (x0 + x1) / 2;
        ctx!.quadraticCurveTo(x0, ys[i - 1], mx, (ys[i - 1] + ys[i]) / 2);
      }
      ctx!.lineTo(w, ys[len - 1]);
      ctx!.strokeStyle = `rgba(${r}, ${g}, ${b}, ${beat ? 1 : 0.75})`;
      ctx!.lineWidth   = beat ? 2 : 1.5;
      ctx!.stroke();
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [bassEnergyRef, phaseColor]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={40}
      style={{
        width: '100%',
        height: '40px',
        display: 'block',
        borderRadius: '4px',
        opacity: 0.85,
      }}
    />
  );
}
