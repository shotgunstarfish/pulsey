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

const HISTORY_SIZE = 80;
const SAMPLE_INTERVAL = 3; // sample every N frames

export function BassWaveform({ bassEnergyRef, phaseColor, isBeat }: BassWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>(new Array(HISTORY_SIZE).fill(0));
  const frameCountRef = useRef(0);
  const rafRef = useRef(0);
  const isBeatRef = useRef(false);
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
      frameCountRef.current++;

      // Sample energy at reduced rate to keep strip readable
      if (frameCountRef.current % SAMPLE_INTERVAL === 0) {
        const energy = bassEnergyRef.current ?? 0;
        historyRef.current.push(energy);
        if (historyRef.current.length > HISTORY_SIZE) {
          historyRef.current.shift();
        }
      }

      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      const history = historyRef.current;
      const barW = w / HISTORY_SIZE;
      const beat = isBeatRef.current;

      for (let i = 0; i < history.length; i++) {
        const val = history[i];
        const barH = val * h * 0.9;
        const alpha = 0.2 + val * 0.7;

        // Brighten the last few columns on beat
        const isRecent = i >= history.length - 4;
        if (beat && isRecent) {
          ctx!.fillStyle = `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)}, ${Math.min(1, alpha + 0.3)})`;
        } else {
          ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        ctx!.fillRect(i * barW, h - barH, Math.max(1, barW - 0.5), barH);
      }
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
