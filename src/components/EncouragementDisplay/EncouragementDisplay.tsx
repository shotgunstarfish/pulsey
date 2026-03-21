import { useState, useEffect, useRef, useCallback } from 'react';
import { getPhaseGroup, pickEncouragement } from '../../engine/encouragementText.ts';
import type { PhaseGroup } from '../../engine/encouragementText.ts';
import styles from './EncouragementDisplay.module.css';

interface EncouragementDisplayProps {
  phase: string;
  intensity: number;
  feelingLevel: number | null;
  lastSplashId: string | null;
  isBeat?: boolean;
  paused?: boolean;
}

const ROTATION_INTERVAL = 12_000;
const FADE_DURATION = 300;
const CHAR_DELAY = 26;

const GROUP_COLOR: Record<PhaseGroup, string> = {
  warmup:   'var(--text-muted)',
  building: 'var(--blue)',
  teasing:  'var(--purple)',
  cooldown: 'var(--text-muted)',
  denied:   'var(--red)',
  release:  'var(--gold)',
};

const GROUP_GLOW: Record<PhaseGroup, string> = {
  warmup:   'none',
  building: '0 0 16px rgba(51,153,255,0.35)',
  teasing:  '0 0 18px rgba(153,51,255,0.45)',
  cooldown: 'none',
  denied:   '0 0 16px rgba(255,51,51,0.4)',
  release:  '0 0 22px rgba(255,215,0,0.55)',
};

export function EncouragementDisplay({ phase, intensity, feelingLevel, isBeat = false, paused = false }: EncouragementDisplayProps) {
  const [message, setMessage]     = useState('');
  const [visible, setVisible]     = useState(true);
  const [typedText, setTypedText] = useState('');
  const [isTyping, setIsTyping]   = useState(false);

  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const intensityRef   = useRef(intensity);
  const feelingRef     = useRef(feelingLevel);
  const phaseRef       = useRef(phase);
  intensityRef.current = intensity;
  feelingRef.current   = feelingLevel;
  phaseRef.current     = phase;

  const swapMessage = useCallback(() => {
    const group = getPhaseGroup(phaseRef.current, intensityRef.current, feelingRef.current);
    setVisible(false);
    fadeTimerRef.current = setTimeout(() => {
      setMessage(pickEncouragement(group));
      setVisible(true);
    }, FADE_DURATION);
  }, []);

  const startInterval = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(swapMessage, ROTATION_INTERVAL);
  }, [swapMessage]);

  useEffect(() => {
    const group = getPhaseGroup(phase, intensity, feelingLevel);
    setMessage(pickEncouragement(group));
    setVisible(true);
    startInterval();
    return () => {
      if (timerRef.current)     clearInterval(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    } else {
      startInterval();
    }
  }, [paused, startInterval]);

  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    if (phase === prevPhaseRef.current) return;
    prevPhaseRef.current = phase;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    const group = getPhaseGroup(phase, intensityRef.current, feelingRef.current);
    setMessage(pickEncouragement(group));
    setVisible(true);
    startInterval();
  }, [phase, startInterval]);

  // Typewriter: animate typedText toward message when visible
  useEffect(() => {
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    if (!visible || !message) {
      setTypedText('');
      setIsTyping(false);
      return;
    }
    setIsTyping(true);
    setTypedText('');
    let i = 0;
    const typeNext = () => {
      i++;
      setTypedText(message.slice(0, i));
      if (i < message.length) {
        typeTimerRef.current = setTimeout(typeNext, CHAR_DELAY);
      } else {
        setIsTyping(false);
      }
    };
    typeTimerRef.current = setTimeout(typeNext, 60);
    return () => { if (typeTimerRef.current) clearTimeout(typeTimerRef.current); };
  }, [message, visible]);

  // Beat: remount key forces glitch animation to replay on each rising edge
  const glitchKeyRef  = useRef(0);
  const prevBeatRef   = useRef(isBeat);
  if (isBeat && !prevBeatRef.current && !isTyping) glitchKeyRef.current++;
  prevBeatRef.current = isBeat;

  const group = getPhaseGroup(phase, intensity, feelingLevel);
  const color = GROUP_COLOR[group];
  const glow  = GROUP_GLOW[group];

  const isActivePhase = group !== 'warmup' && group !== 'cooldown';

  if (!message) return null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.deco}>
        <span className={styles.decoLine} style={{ background: color }} />
        <span className={styles.decoLabel}>{group}</span>
        <span className={styles.decoLine} style={{ background: color }} />
      </div>
      <div
        key={glitchKeyRef.current}
        className={`${styles.line} ${isBeat && !isTyping ? styles.beatGlitch : ''}`}
      >
        <span className={styles.prefix}>›</span>
        <span
          className={`${styles.text} ${isActivePhase ? styles.textActive : ''}`}
          style={{ color, textShadow: glow }}
        >
          {typedText}
        </span>
        <span
          className={`${styles.cursor} ${isTyping ? styles.cursorTyping : ''}`}
          style={{ color }}
        />
      </div>
    </div>
  );
}
