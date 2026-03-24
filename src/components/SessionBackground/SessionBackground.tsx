import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';
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

const DOTS = Array.from({ length: 22 }, (_, i) => ({
  x:             ((i * 47 + 13) * 71 % 97) / 97 * 96 + 2,
  y:             ((i * 61 + 7)  * 83 % 89) / 89 * 92 + 4,
  size:          1.5 + (i % 4) * 0.4,
  breathDelay:   ((i * 0.37) % 4).toFixed(2),
  breathDuration:(3.5 + (i % 5) * 0.6).toFixed(1),
  waveDelay:     ((i % 6) * 0.05).toFixed(2),
}));

/**
 * Each orb travels an independent Lissajous figure.
 * rangeX/Y = ± percentage drift from its CSS base position.
 * freqX/Y control the relative frequency of x vs y oscillation,
 * producing figure-8s and ovals rather than plain circles.
 * initPhase staggers the orbs so they don't start in sync.
 */
const ORB_PARAMS = [
  { rangeX: 13, rangeY: 11, freqX: 1.00, freqY: 0.73, speed: 0.0040, initPhase: 0.0  },
  { rangeX: 11, rangeY: 14, freqX: 0.84, freqY: 1.10, speed: 0.0034, initPhase: 2.1  },
  { rangeX: 15, rangeY:  9, freqX: 1.20, freqY: 0.91, speed: 0.0046, initPhase: 4.4  },
];

interface Props {
  phaseColor:   string;
  isBeat:       boolean;
  intensity:    number;
  bassEnergyRef: RefObject<number>;
}

export function SessionBackground({ phaseColor, isBeat, intensity, bassEnergyRef }: Props) {
  const beatKeyRef  = useRef(0);
  const prevBeatRef = useRef(false);
  if (isBeat && !prevBeatRef.current) beatKeyRef.current++;
  prevBeatRef.current = isBeat;

  // Refs to the three orb DOM elements
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);

  // Persistent animation state
  const phasesRef      = useRef(ORB_PARAMS.map(p => ({ x: p.initPhase, y: p.initPhase * 0.7 })));
  const beatBoostRef   = useRef(1.0);   // per-beat spike, decays in ~400 ms
  const lastBeatMsRef  = useRef(0);     // performance.now() of last beat onset
  const isBeatRef      = useRef(false);
  const prevBeatRaf    = useRef(false);
  const rafRef         = useRef(0);
  isBeatRef.current    = isBeat;

  useEffect(() => {
    const orbEls = [orb1Ref.current, orb2Ref.current, orb3Ref.current];

    const PULSE_WINDOW_MS = 10_000; // sustained elevation window

    function tick() {
      rafRef.current = requestAnimationFrame(tick);

      const now  = performance.now();
      const beat = isBeatRef.current;

      // Rising edge: spike speed AND refresh the 10-second pulse window
      if (beat && !prevBeatRaf.current) {
        beatBoostRef.current = 4.5;
        lastBeatMsRef.current = now;
      }
      prevBeatRaf.current = beat;

      // Per-beat spike decays in ~400 ms
      beatBoostRef.current = Math.max(1.0, beatBoostRef.current * 0.92);

      // Sustained elevation: linearly fades from 1.5 → 0 over the 10 s window
      const msSinceBeat  = now - lastBeatMsRef.current;
      const pulseActivity = Math.max(0, 1 - msSinceBeat / PULSE_WINDOW_MS);

      const energy   = Math.min(1, bassEnergyRef.current ?? 0);
      // Base speed elevated by music energy + sustained pulse activity
      const speedMult = (0.5 + energy * 1.5 + pulseActivity * 1.5) * beatBoostRef.current;

      ORB_PARAMS.forEach((p, i) => {
        const ph = phasesRef.current[i];
        ph.x += p.speed * p.freqX * speedMult;
        ph.y += p.speed * p.freqY * speedMult;

        const tx = Math.sin(ph.x) * p.rangeX;
        const ty = Math.cos(ph.y) * p.rangeY;

        const el = orbEls[i];
        if (el) {
          // CSS individual `translate` property — doesn't interfere with
          // the scale/opacity CSS breathe animations on the same element.
          (el.style as CSSStyleDeclaration & { translate: string }).translate =
            `${tx.toFixed(2)}% ${ty.toFixed(2)}%`;
        }
      });
    }

    tick();
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bassEnergyRef]);

  const r          = rgb(phaseColor);
  const orbAlpha1  = (0.05 + (intensity / 20) * 0.09).toFixed(3);
  const orbAlpha2  = (0.04 + (intensity / 20) * 0.06).toFixed(3);
  const orbAlpha3  = (0.03 + (intensity / 20) * 0.05).toFixed(3);

  return (
    <div className={styles.root} aria-hidden="true">
      {/* Dot grid texture */}
      <div
        className={styles.dotGrid}
        style={{ '--grid-rgb': r } as React.CSSProperties}
      />

      {/* Floating orbs — translate driven by rAF; scale/opacity by CSS breathe */}
      <div
        ref={orb1Ref}
        className={styles.orb1}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha1}) 0%, transparent 65%)` }}
      />
      <div
        ref={orb2Ref}
        className={styles.orb2}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha2}) 0%, transparent 65%)` }}
      />
      <div
        ref={orb3Ref}
        className={styles.orb3}
        style={{ background: `radial-gradient(circle, rgba(${r},${orbAlpha3}) 0%, transparent 65%)` }}
      />

      {/* Beat ring — key remount restarts animation on each beat */}
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
            left:   `${dot.x}%`,
            top:    `${dot.y}%`,
            width:  `${dot.size}px`,
            height: `${dot.size}px`,
            '--dot-rgb':    r,
            '--breath-delay':  `${dot.breathDelay}s`,
            '--breath-dur':    `${dot.breathDuration}s`,
            '--wave-delay':    `${dot.waveDelay}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
