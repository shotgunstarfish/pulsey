import { useRef, useState } from 'react';
import type { SessionAction } from '../../engine/sessionMachine.ts';
import type { PlaylistStore, VideoCategory } from '../../hooks/useVideoPlaylist.ts';
import type { BeatDetectionControls } from '../../hooks/useBeatDetection.ts';
import { MusicControl } from '../MusicControl/MusicControl.tsx';
import styles from './PlaylistScreen.module.css';

interface PlaylistScreenProps {
  playlist: PlaylistStore;
  addFiles: (files: File[], category: VideoCategory) => void;
  removeFile: (category: VideoCategory, index: number) => void;
  moveFile: (from: VideoCategory, index: number, to: VideoCategory) => void;
  clearCategory: (category: VideoCategory) => void;
  clearAll: () => void;
  music: BeatDetectionControls;
  send: (action: SessionAction) => void;
}

const CATEGORIES: VideoCategory[] = ['low', 'medium', 'intense'];

const LABELS: Record<VideoCategory, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  intense: 'INTENSE',
};

const ADJACENT: Record<VideoCategory, { left: VideoCategory | null; right: VideoCategory | null }> = {
  low: { left: null, right: 'medium' },
  medium: { left: 'low', right: 'intense' },
  intense: { left: 'medium', right: null },
};

export function PlaylistScreen({
  playlist,
  addFiles,
  removeFile,
  moveFile,
  clearCategory,
  clearAll,
  music,
  send,
}: PlaylistScreenProps) {
  const totalVideos = CATEGORIES.reduce((n, c) => n + playlist[c].length, 0);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => send({ type: 'GO_IDLE' })}>
          ← Back
        </button>
        <h1 className={styles.title}>PLAYLIST</h1>
        {totalVideos > 0 && (
          <button className={styles.clearAllBtn} onClick={clearAll}>
            Clear All Videos
          </button>
        )}
      </div>

      <div className={styles.columns}>
        {CATEGORIES.map(cat => (
          <CategoryColumn
            key={cat}
            category={cat}
            entries={playlist[cat]}
            addFiles={addFiles}
            removeFile={removeFile}
            moveFile={moveFile}
            clearCategory={clearCategory}
          />
        ))}
      </div>

      <div className={styles.musicSection}>
        <div className={styles.musicLabel}>MUSIC</div>
        <MusicControl
          tracks={music.tracks}
          currentTrackIndex={music.currentTrackIndex}
          isPlaying={music.isPlaying}
          onAddTracks={music.addTracks}
          onRemoveTrack={music.removeTrack}
          onClearAll={music.clearAllTracks}
          onPlayTrack={music.playTrack}
          onTogglePlayback={music.togglePlayback}
          onNext={music.nextTrack}
          onPrev={music.prevTrack}
        />
      </div>
    </div>
  );
}

interface CategoryColumnProps {
  category: VideoCategory;
  entries: PlaylistStore[VideoCategory];
  addFiles: (files: File[], category: VideoCategory) => void;
  removeFile: (category: VideoCategory, index: number) => void;
  moveFile: (from: VideoCategory, index: number, to: VideoCategory) => void;
  clearCategory: (category: VideoCategory) => void;
}

function CategoryColumn({
  category,
  entries,
  addFiles,
  removeFile,
  moveFile,
  clearCategory,
}: CategoryColumnProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const files: File[] = [];
    if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type.startsWith('video/')) {
          files.push(file);
        }
      }
    }
    if (files.length > 0) {
      addFiles(files, category);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList) return;
    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      files.push(fileList[i]);
    }
    addFiles(files, category);
    e.target.value = '';
  }

  const adj = ADJACENT[category];

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <span className={styles.columnLabel} data-category={category}>
          {LABELS[category]}
        </span>
        <span className={styles.fileCount}>
          {entries.length} file{entries.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className={styles.columnBody}>
        <div
          className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {entries.length === 0 ? (
            <div className={styles.emptyState}>Drop videos here</div>
          ) : (
            <ul className={styles.fileList}>
              {entries.map((entry, idx) => (
                <li key={`${entry.name}-${idx}`} className={styles.fileItem}>
                  <span className={styles.fileName}>{entry.name}</span>
                  {adj.left && (
                    <button
                      className={styles.fileAction}
                      onClick={() => moveFile(category, idx, adj.left!)}
                      title={`Move to ${LABELS[adj.left]}`}
                    >
                      &#8592;
                    </button>
                  )}
                  {adj.right && (
                    <button
                      className={styles.fileAction}
                      onClick={() => moveFile(category, idx, adj.right!)}
                      title={`Move to ${LABELS[adj.right]}`}
                    >
                      &#8594;
                    </button>
                  )}
                  <button
                    className={`${styles.fileAction} ${styles.fileActionDanger}`}
                    onClick={() => removeFile(category, idx)}
                    title="Remove"
                  >
                    &#10005;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.columnActions}>
        <button className={styles.addBtn} onClick={() => inputRef.current?.click()}>
          + Add Videos
        </button>
        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          accept="video/*"
          multiple
          onChange={handleFileInput}
        />
        {entries.length > 0 && (
          <button className={styles.clearBtn} onClick={() => clearCategory(category)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
