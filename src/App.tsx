import { useEffect, useRef, useCallback } from 'react';
import { useSessionEngine } from './hooks/useSessionEngine.ts';
import { useKeyboardInput } from './hooks/useKeyboardInput.ts';
import { useVideoPlaylist } from './hooks/useVideoPlaylist.ts';
import { useBeatDetection } from './hooks/useBeatDetection.ts';
import { SplashOverlay } from './components/SplashOverlay/SplashOverlay.tsx';
import { IdleScreen } from './components/IdleScreen/IdleScreen.tsx';
import { SetupScreen } from './components/SetupScreen/SetupScreen.tsx';
import { SessionScreen } from './components/SessionScreen/SessionScreen.tsx';
import { HistoryScreen } from './components/HistoryScreen/HistoryScreen.tsx';
import { PlaylistScreen } from './components/PlaylistScreen/PlaylistScreen.tsx';

export default function App() {
  const music = useBeatDetection();
  const { state, send, deviceErrors, deviceIntensities } = useSessionEngine(music.isBeat, music.bpm);
  const { playlist, addFiles, removeFile, moveFile, clearCategory, clearAll } = useVideoPlaylist();

  // Wrap send so EMERGENCY_STOP fades out music before halting
  const wrappedSend = useCallback<typeof send>((action) => {
    if (action.type === 'EMERGENCY_STOP') music.fadeOutAndStop();
    send(action);
  }, [send, music]); // eslint-disable-line react-hooks/exhaustive-deps

  useKeyboardInput(wrappedSend, state.phase, state.paused);

  // Dispatch beat nudge to the session machine so intensity pulses with the music
  useEffect(() => {
    if (music.isBeat) send({ type: 'BEAT_NUDGE' });
  }, [music.isBeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start music when a session begins (WARMUP = first active phase)
  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (prev !== 'WARMUP' && state.phase === 'WARMUP' && music.tracks.length > 0 && !music.isPlaying) {
      music.togglePlayback();
    }
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderScreen() {
    switch (state.phase) {
      case 'IDLE':
        return <IdleScreen send={wrappedSend} />;
      case 'SETUP':
        return <SetupScreen state={state} send={wrappedSend} />;
      case 'HISTORY':
        return <HistoryScreen send={wrappedSend} />;
      case 'PLAYLIST':
        return (
          <PlaylistScreen
            playlist={playlist}
            addFiles={addFiles}
            removeFile={removeFile}
            moveFile={moveFile}
            clearCategory={clearCategory}
            clearAll={clearAll}
            music={music}
            send={wrappedSend}
          />
        );
      default:
        return (
          <SessionScreen
            state={state}
            send={wrappedSend}
            playlist={playlist}
            isBeat={music.isBeat}
            bassEnergyRef={music.bassEnergyRef}
            bpm={music.bpm}
            deviceErrors={deviceErrors}
            deviceIntensities={deviceIntensities}
          />
        );
    }
  }

  return (
    <>
      {/* Hidden audio element — persists across screen changes, no loop (playlist auto-advances) */}
      <audio ref={music.audioRef} style={{ display: 'none' }} />
      {/* Draggable titlebar strip for Electron window (hidden in browser) */}
      <div className="titlebar" />
      <div className="titlebar-offset">
        {renderScreen()}
      </div>
      <SplashOverlay splash={state.splash} send={wrappedSend} />
    </>
  );
}
