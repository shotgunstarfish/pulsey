import { useRef, useEffect } from 'react';
import { applyPatternRaw } from '../../engine/toyPatterns.ts';
import type { ToyPattern } from '../../engine/toyPatterns.ts';
import styles from './WaveformCanvas.module.css';

interface WaveformCanvasProps {
  pattern: ToyPattern;
  intensityScale?: number;
  phaseOffsetMs?: number;
  color?: string;
  width?: number;
  height?: number;
}

const SAMPLES = 200;
// Fixed mid-range intensity so the pattern shape is always visible
const DISPLAY_INTENSITY = 14;

/**
 * How many ms to simulate to show exactly 2 cycles of each pattern's
 * dominant oscillation period. The canvas x-axis is always this full range.
 *
 * wave / complement: sin(t / 4000) → period = 2π×4000 ≈ 25133ms → 2 cycles ≈ 50265ms
 * pulse at intensity 14: period = 2000 - (14/20)×1200 = 1160ms → 2 cycles = 2320ms
 * rumble: primary sin(t / 3000) → period = 2π×3000 ≈ 18850ms → 2 cycles ≈ 37699ms
 * direct: flat, any window works
 */
function twoCycleDuration(pattern: ToyPattern): number {
  switch (pattern) {
    case 'wave':
    case 'complement': return 2 * Math.PI * 4000 * 2;   // ≈ 50 265 ms
    case 'pulse':      return 1160 * 2;                  // ≈  2 320 ms
    case 'rumble':     return 2 * Math.PI * 3000 * 2;   // ≈ 37 699 ms
    default:           return 3000;                       // direct — flat
  }
}

export function WaveformCanvas({
  pattern,
  intensityScale = 1.0,
  phaseOffsetMs = 0,
  color = 'var(--purple)',
  width = 200,
  height = 56,
}: WaveformCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const duration = twoCycleDuration(pattern);

    const points: [number, number][] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * duration;
      const value = applyPatternRaw(pattern, DISPLAY_INTENSITY, t + phaseOffsetMs, 0, 20) * intensityScale;
      const x = (i / SAMPLES) * width;
      // Invert Y: 0 intensity at bottom, 20 at top; 4px padding
      const y = height - 4 - (value / 20) * (height - 8);
      points.push([x, y]);
    }

    // Filled area under the curve
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(153,51,255,0.35)');
    gradient.addColorStop(1, 'rgba(153,51,255,0.02)');

    ctx.beginPath();
    ctx.moveTo(points[0][0], height);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(points[points.length - 1][0], height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Curve line
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.strokeStyle = 'rgba(153,51,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [pattern, intensityScale, phaseOffsetMs, color, width, height]);

  return <canvas ref={ref} className={styles.canvas} />;
}
