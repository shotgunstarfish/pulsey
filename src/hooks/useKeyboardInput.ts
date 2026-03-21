/** Keyboard listener — maps 0-9 + spacebar to session actions */

import { useEffect } from 'react';
import type { SessionAction, Phase } from '../engine/sessionMachine.ts';

export function useKeyboardInput(
  send: (action: SessionAction) => void,
  phase: Phase,
  paused: boolean,
) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === '0') {
        e.preventDefault();
        send({ type: 'EMERGENCY_STOP' });
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        send({ type: 'REPORT_FEELING', level: parseInt(e.key, 10) });
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        if (paused) {
          send({ type: 'RESUME' });
        } else if (
          phase !== 'IDLE' &&
          phase !== 'SETUP' &&
          phase !== 'HISTORY' &&
          phase !== 'PLAYLIST'
        ) {
          send({ type: 'PAUSE' });
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [send, phase, paused]);
}
