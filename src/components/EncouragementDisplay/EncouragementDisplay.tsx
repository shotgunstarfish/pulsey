import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import { getPhaseGroup, pickEncouragement } from '../../engine/encouragementText.ts';
import type { PhaseGroup } from '../../engine/encouragementText.ts';
import { loadVoiceProfile } from '../../engine/voiceProfile.ts';
import styles from './EncouragementDisplay.module.css';

interface EncouragementDisplayProps {
  phase: string;
  intensity: number;
  feelingLevel: number | null;
  lastSplashId: string | null;
  isBeat?: boolean;
  paused?: boolean;
  musicRef?: RefObject<HTMLAudioElement | null>;
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

const TAUNT_GAIN = 1.2;

function playTaunt(audioSrc: string, musicRef?: RefObject<HTMLAudioElement | null>) {
  // Prepend BASE_URL so paths work in both dev (/) and production Electron (./)
  const src = import.meta.env.BASE_URL.replace(/\/$/, '') + audioSrc;
  const audio = new Audio(src);

  // Route through Web Audio GainNode so we can exceed the 1.0 volume cap
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.value = TAUNT_GAIN;
  source.connect(gain);
  gain.connect(ctx.destination);

  // Duck music under the taunt
  const music = musicRef?.current;
  const originalVol = music ? music.volume : 0;
  if (music && originalVol > 0) {
    const DUCK_TO = 0.25;
    const STEPS = 10;
    const MS = 20; // 200ms fade down
    let step = 0;
    const down = setInterval(() => {
      if (!music) { clearInterval(down); return; }
      step++;
      music.volume = Math.max(originalVol - (originalVol - DUCK_TO) * (step / STEPS), DUCK_TO);
      if (step >= STEPS) clearInterval(down);
    }, MS);
  }

  audio.addEventListener('ended', () => {
    ctx.close();
    if (!music || originalVol <= 0) return;
    // Restore music over 500ms
    const STEPS = 20;
    const MS = 25;
    let step = 0;
    const start = music.volume;
    const up = setInterval(() => {
      step++;
      music.volume = Math.min(start + (originalVol - start) * (step / STEPS), originalVol);
      if (step >= STEPS) clearInterval(up);
    }, MS);
  });

  ctx.resume().then(() => audio.play()).catch(() => {
    ctx.close();
    if (music) music.volume = originalVol; // restore on failure
  });
}

export function EncouragementDisplay({ phase, intensity, feelingLevel, isBeat = false, paused = false, musicRef }: EncouragementDisplayProps) {
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
      const picked = pickEncouragement(group, loadVoiceProfile());
      setMessage(picked.text);
      if (picked.audioSrc) playTaunt(picked.audioSrc, musicRef);
      setVisible(true);
    }, FADE_DURATION);
  }, []);

  const startInterval = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(swapMessage, ROTATION_INTERVAL);
  }, [swapMessage]);

  useEffect(() => {
    const group = getPhaseGroup(phase, intensity, feelingLevel);
    setMessage(pickEncouragement(group, loadVoiceProfile()).text);
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
    const picked = pickEncouragement(group, loadVoiceProfile());
    setMessage(picked.text);
    if (picked.audioSrc) playTaunt(picked.audioSrc, musicRef);
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
