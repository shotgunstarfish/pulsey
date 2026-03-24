import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';

interface EnergyEqualizerProps {
  analyserRef: RefObject<AnalyserNode | null>;
  bassEnergyRef: RefObject<number>;
  phaseColor: string;
  isBeat: boolean;
  intensity: number;
  mode: 'full' | 'compact';
}

const NUM_BANDS = 32;
const SPARKLE_COLORS = ['#ffffff', '#ffe4b5', '#b0e0e6', '#dda0dd', '#e6e6fa', '#98fb98'];

// Phase-influenced gradients: dark base → vivid mid → bright tip
const PHASE_GRADIENTS: Record<string, Array<[number,number,number]>> = {
  'var(--orange)': [[200,35,0],[255,102,0],[255,165,0],[255,215,50],[255,245,140]],
  'var(--blue)':   [[0,45,210],[0,100,255],[0,175,255],[55,215,255],[155,240,255]],
  'var(--red)':    [[190,0,15],[245,25,45],[255,75,75],[255,135,115],[255,195,175]],
  'var(--gold)':   [[170,75,0],[225,125,0],[255,175,0],[255,210,45],[255,238,135]],
  'var(--purple)': [[75,0,175],[125,0,225],[175,55,255],[205,125,255],[232,185,255]],
  'var(--green)':  [[0,135,55],[0,195,95],[0,235,135],[55,252,175],[155,252,205]],
  'var(--text-muted)': [[45,45,55],[95,95,105],[145,145,155],[185,185,195],[215,215,222]],
};
const DEFAULT_GRADIENT: Array<[number,number,number]> = [[200,35,0],[255,102,0],[255,165,0],[255,215,50],[255,245,140]];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  size: number;
  trail: Array<{ x: number; y: number }>;
  active: boolean;
}

export function EnergyEqualizer({ analyserRef, bassEnergyRef, phaseColor, isBeat, intensity, mode }: EnergyEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Persistent rAF state — all in refs to avoid re-render
  const smoothedBands = useRef<number[]>(new Array(NUM_BANDS).fill(0));
  const peakBands = useRef<number[]>(new Array(NUM_BANDS).fill(0));
  const peakTimers = useRef<number[]>(new Array(NUM_BANDS).fill(0));
  const particles = useRef<Particle[]>(
    Array.from({ length: 60 }, () => ({ x:0,y:0,vx:0,vy:0,color:'#fff',alpha:0,life:0,maxLife:1,size:2,trail:[],active:false }))
  );
  const absorbGlow = useRef(0);
  const isBeatRef = useRef(false);
  const prevBeatRaf = useRef(false);
  const phaseColorRef = useRef(phaseColor);
  const intensityRef = useRef(intensity);
  const rafRef = useRef(0);

  isBeatRef.current = isBeat;
  phaseColorRef.current = phaseColor;
  intensityRef.current = intensity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale canvas buffer to physical pixels for crisp rendering on high-DPI screens
    const dpr  = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth  || (mode === 'compact' ? 400 : 600);
    const cssH = canvas.clientHeight || (mode === 'compact' ? 40  : 300);
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.scale(dpr, dpr);

    // Build logarithmically-spaced bin ranges for NUM_BANDS bands
    // fftSize=2048 -> frequencyBinCount=1024 bins; typical sampleRate=44100
    // Useful frequency range: ~20Hz to ~8000Hz
    const MIN_BIN = 1;
    const MAX_BIN = 200; // ~8600 Hz at 44100 Hz sample rate with 1024 bins
    const logMin = Math.log(MIN_BIN);
    const logMax = Math.log(MAX_BIN);
    const bandRanges: Array<[number, number]> = Array.from({ length: NUM_BANDS }, (_, i) => {
      const lo = Math.round(Math.exp(logMin + (logMax - logMin) * (i / NUM_BANDS)));
      const hi = Math.round(Math.exp(logMin + (logMax - logMin) * ((i + 1) / NUM_BANDS)));
      return [lo, Math.max(hi, lo + 1)];
    });

    // Phase-influenced gradient — band index interpolates across the current phase colors
    function getBandColorRgb(bandIndex: number): [number,number,number] {
      const gradient = PHASE_GRADIENTS[phaseColorRef.current] ?? DEFAULT_GRADIENT;
      const t = bandIndex / (NUM_BANDS - 1);
      const seg = t * (gradient.length - 1);
      const si = Math.min(Math.floor(seg), gradient.length - 2);
      const sf = seg - si;
      const [r1,g1,b1] = gradient[si];
      const [r2,g2,b2] = gradient[si+1];
      return [Math.round(r1+(r2-r1)*sf), Math.round(g1+(g2-g1)*sf), Math.round(b1+(b2-b1)*sf)];
    }

    function getBandColor(bandIndex: number): string {
      const [r, g, b] = getBandColorRgb(bandIndex);
      return `rgb(${r},${g},${b})`;
    }

    function spawnParticles(barX: number, barY: number, color: string) {
      const pool = particles.current;
      let spawned = 0;
      // Scale particle count with session intensity: 1 at low, 3 at high
      const maxSpawn = 1 + Math.floor(intensityRef.current / 10);
      for (let i = 0; i < pool.length && spawned < maxSpawn; i++) {
        if (!pool[i].active) {
          const p = pool[i];
          p.active = true;
          p.x = barX + (Math.random() - 0.5) * 10;
          p.y = barY;
          p.vx = (Math.random() - 0.5) * 0.8;
          p.vy = -Math.random() * 0.8 - 0.2;
          p.color = color;
          p.alpha = 0.9;
          p.maxLife = 90 + Math.random() * 60;
          p.life = p.maxLife;
          p.size = 2 + Math.random() * 2;
          p.trail = [];
          spawned++;
        }
      }
    }

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const w = canvas!.width / dpr;
      const h = canvas!.height / dpr;
      ctx!.clearRect(0, 0, w, h);

      const analyser = analyserRef.current;
      const beat = isBeatRef.current;
      const intens = intensityRef.current;

      // --- Read frequency data ---
      let freqData: Uint8Array | null = null;
      if (analyser) {
        freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
      }

      // --- Update smoothed bands ---
      const sb = smoothedBands.current;
      const pb = peakBands.current;
      const pt = peakTimers.current;
      for (let i = 0; i < NUM_BANDS; i++) {
        let raw = 0;
        if (freqData) {
          const [lo, hi] = bandRanges[i];
          let sum = 0;
          for (let b = lo; b < hi && b < freqData.length; b++) sum += freqData[b];
          raw = sum / (hi - lo) / 255; // normalize 0-1
        }
        // Smooth: rise fast, fall slow
        sb[i] = raw > sb[i] ? sb[i] * 0.6 + raw * 0.4 : sb[i] * 0.88 + raw * 0.12;
        // Peak hold
        if (sb[i] >= pb[i]) {
          pb[i] = sb[i];
          pt[i] = 30; // hold for 30 frames (~500ms)
        } else {
          pt[i]--;
          if (pt[i] <= 0) pb[i] = Math.max(pb[i] - 0.008, sb[i]);
        }
      }

      // --- Layout ---
      // In 'full' mode: bars at bottom 35% of canvas, gauge center at 50%,50%
      // In 'compact' mode: bars fill the canvas height, gauge center at left ~15%
      const isCompact = mode === 'compact';
      const barAreaY = isCompact ? 0 : h * 0.65;
      const barAreaH = isCompact ? h : h * 0.35;
      const gaugeX   = isCompact ? w * 0.05 : w * 0.5;
      const gaugeY   = isCompact ? h * 0.5  : h * 0.5;

      const totalGap = w * 0.005 * NUM_BANDS;
      const barW = Math.max(2, (w - totalGap) / NUM_BANDS);
      const gap   = (w - barW * NUM_BANDS) / (NUM_BANDS + 1);

      // --- Pass 1: Upward spotlight beams — full mode only, drawn behind bars ---
      if (!isCompact) {
        for (let i = 0; i < NUM_BANDS; i++) {
          if (sb[i] < 0.05) continue;
          const x = gap + i * (barW + gap);
          const [cr, cg, cb] = getBandColorRgb(i);
          const beamX = x + barW / 2;
          const beamAlpha = sb[i] * 0.28 * (0.5 + (intens / 20) * 0.5);

          // Full-height column: bright where bars are, fading toward top
          const beamGrad = ctx!.createLinearGradient(beamX, h, beamX, 0);
          beamGrad.addColorStop(0.00, `rgba(${cr},${cg},${cb},0)`);
          beamGrad.addColorStop(0.30, `rgba(${cr},${cg},${cb},${beamAlpha * 0.45})`);
          beamGrad.addColorStop(0.62, `rgba(${cr},${cg},${cb},${beamAlpha})`);
          beamGrad.addColorStop(0.82, `rgba(${cr},${cg},${cb},${beamAlpha * 0.55})`);
          beamGrad.addColorStop(1.00, `rgba(${cr},${cg},${cb},0)`);

          ctx!.globalAlpha = 1;
          ctx!.lineWidth = barW * 0.60;
          ctx!.strokeStyle = beamGrad;
          ctx!.shadowBlur = 14 + sb[i] * 10;
          ctx!.shadowColor = `rgb(${cr},${cg},${cb})`;
          ctx!.beginPath();
          ctx!.moveTo(beamX, 0);
          ctx!.lineTo(beamX, h);
          ctx!.stroke();
        }
        ctx!.shadowBlur = 0;
        ctx!.globalAlpha = 1;
      }

      // --- Pass 2: Smooth gradient bars ---
      for (let i = 0; i < NUM_BANDS; i++) {
        const barH = sb[i] * barAreaH * 0.92 * (0.5 + (intens / 20) * 0.5);
        const x = gap + i * (barW + gap);
        const y = barAreaY + barAreaH - barH;
        const color = getBandColor(i);
        const [cr, cg, cb] = getBandColorRgb(i);

        if (barH < 0.5) continue;

        // Glow — stronger in full mode
        if (!isCompact) {
          ctx!.shadowBlur = 6 + sb[i] * 18;
          ctx!.shadowColor = color;
        }

        // Gradient fill: vivid at top → transparent at bottom (light-beam feel)
        const barGrad = ctx!.createLinearGradient(x, y, x, y + barH);
        barGrad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.9 + sb[i] * 0.1})`);
        barGrad.addColorStop(0.6, `rgba(${cr},${cg},${cb},0.5)`);
        barGrad.addColorStop(1, `rgba(${cr},${cg},${cb},0.05)`);

        ctx!.fillStyle = barGrad;
        ctx!.globalAlpha = 1;
        ctx!.beginPath();
        const radius = Math.min(barW / 2, 3);
        ctx!.roundRect(x, y, barW, barH, [radius, radius, 0, 0]);
        ctx!.fill();

        // Mirror reflection — full mode only
        if (!isCompact && barH > 2) {
          ctx!.shadowBlur = 0;
          const reflGrad = ctx!.createLinearGradient(x, barAreaY + barAreaH, x, barAreaY + barAreaH + barH * 0.3);
          reflGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0.18)`);
          reflGrad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx!.fillStyle = reflGrad;
          ctx!.fillRect(x, barAreaY + barAreaH, barW, barH * 0.3);
        }

        // Peak indicator line
        if (pb[i] > 0.08) {
          const peakY = barAreaY + barAreaH - pb[i] * barAreaH * 0.92 * (0.5 + (intens / 20) * 0.5);
          ctx!.shadowBlur = isCompact ? 0 : 8;
          ctx!.shadowColor = color;
          ctx!.globalAlpha = 0.9;
          ctx!.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx!.fillRect(x, peakY - 1, barW, isCompact ? 1 : 2);
        }

        // Spawn particles on beat — full mode only
        if (!isCompact && beat && !prevBeatRaf.current && sb[i] > 0.35) {
          spawnParticles(x + barW / 2, y, color);
        }
      }

      ctx!.shadowBlur = 0;
      ctx!.globalAlpha = 1;

      // --- Beat rising edge tracking ---
      prevBeatRaf.current = beat;

      // --- Update and draw particles ---
      const pool = particles.current;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;

        // Store trail
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 5) p.trail.shift();

        // Attraction toward gauge center — gentle pull, lazy arcing drift
        const dx = (gaugeX - p.x) * 0.008 + (Math.random() - 0.5) * 0.2;
        const dy = (gaugeY - p.y) * 0.008 + (Math.random() - 0.5) * 0.2;
        p.vx = p.vx * 0.98 + dx;
        p.vy = p.vy * 0.98 + dy;
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        const distToGauge = Math.hypot(p.x - gaugeX, p.y - gaugeY);

        // Absorption: near gauge center
        if (distToGauge < 28) {
          absorbGlow.current = Math.min(1, absorbGlow.current + 0.35);
          p.active = false;
          continue;
        }

        if (p.life <= 0) { p.active = false; continue; }

        const lifeRatio = p.life / p.maxLife;
        p.alpha = lifeRatio * 0.9;

        // Draw trail
        for (let t = 0; t < p.trail.length; t++) {
          const ta = (t / p.trail.length) * p.alpha * 0.4;
          ctx!.globalAlpha = ta;
          ctx!.fillStyle = p.color;
          ctx!.beginPath();
          ctx!.arc(p.trail[t].x, p.trail[t].y, p.size * 0.5, 0, Math.PI * 2);
          ctx!.fill();
        }

        // Draw particle
        ctx!.globalAlpha = p.alpha;
        ctx!.fillStyle = p.color;
        ctx!.shadowBlur = 6;
        ctx!.shadowColor = p.color;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size * lifeRatio + 0.5, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.shadowBlur = 0;
      }

      ctx!.globalAlpha = 1;

      // --- Absorption glow at gauge center ---
      if (absorbGlow.current > 0.01) {
        const grad = ctx!.createRadialGradient(gaugeX, gaugeY, 0, gaugeX, gaugeY, 45);
        grad.addColorStop(0, `rgba(255,255,255,${absorbGlow.current * 0.6})`);
        grad.addColorStop(0.5, `rgba(255,255,255,${absorbGlow.current * 0.15})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(gaugeX, gaugeY, 45, 0, Math.PI * 2);
        ctx!.fill();
        absorbGlow.current *= 0.88;
      }
    }

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.shadowBlur = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyserRef, mode]);

  if (mode === 'compact') {
    return (
      <canvas
        ref={canvasRef}
        width={400}
        height={40}
        style={{ width: '100%', height: '40px', display: 'block', borderRadius: '4px' }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={300}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
