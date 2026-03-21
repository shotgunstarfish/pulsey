import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { Track } from '../../hooks/useBeatDetection.ts';
import styles from './MusicControl.module.css';

interface MusicControlProps {
  tracks: Track[];
  currentTrackIndex: number;
  isPlaying: boolean;
  onAddTracks: (files: FileList | File[]) => void;
  onRemoveTrack: (index: number) => void;
  onClearAll: () => void;
  onPlayTrack: (index: number) => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onPrev: () => void;
}

function truncate(name: string, max = 32): string {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

export function MusicControl({
  tracks,
  currentTrackIndex,
  isPlaying,
  onAddTracks,
  onRemoveTrack,
  onClearAll,
  onPlayTrack,
  onTogglePlayback,
  onNext,
  onPrev,
}: MusicControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) onAddTracks(e.target.files);
    e.target.value = '';
  }

  if (tracks.length === 0) {
    return (
      <div className={styles.container}>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
        <button className={styles.addButton} onClick={() => fileInputRef.current?.click()}>
          + Add Music
        </button>
      </div>
    );
  }

  const currentTrack = tracks[currentTrackIndex];

  return (
    <div className={styles.container}>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />

      {/* Track list */}
      <div className={styles.trackList}>
        {tracks.map((track, i) => (
          <div
            key={track.url}
            className={`${styles.trackRow} ${i === currentTrackIndex ? styles.trackRowActive : ''}`}
            onClick={() => onPlayTrack(i)}
          >
            <span className={styles.trackIndex}>{i + 1}</span>
            <span className={styles.trackName} title={track.name}>
              {truncate(track.name)}
            </span>
            {i === currentTrackIndex && isPlaying && (
              <span className={styles.playingIndicator}>♪</span>
            )}
            <button
              className={styles.removeBtn}
              onClick={e => { e.stopPropagation(); onRemoveTrack(i); }}
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <button className={styles.controlBtn} onClick={() => fileInputRef.current?.click()} title="Add tracks">
          + Add
        </button>
        <div className={styles.playControls}>
          <button className={styles.controlBtn} onClick={onPrev} title="Previous">◀◀</button>
          <button className={`${styles.controlBtn} ${styles.playBtn}`} onClick={onTogglePlayback}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className={styles.controlBtn} onClick={onNext} title="Next">▶▶</button>
        </div>
        <span className={styles.nowPlaying} title={currentTrack?.name}>
          {currentTrack ? truncate(currentTrack.name, 22) : ''}
        </span>
        <button className={styles.clearBtn} onClick={onClearAll} title="Clear playlist">
          Clear
        </button>
      </div>
    </div>
  );
}
