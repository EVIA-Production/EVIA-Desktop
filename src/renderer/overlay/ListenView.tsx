import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

interface TranscriptLine {
  speaker: number | null;
  text: string;
  isFinal?: boolean;
}

interface ListenViewProps {
  lines: TranscriptLine[];
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

const ListenView: React.FC<ListenViewProps> = ({ lines, followLive, onToggleFollow, onClose }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('transcript');

  const adjustWindowHeight = () => {
    if (window.api) {
      const fixedHeight = 500; // Set a fixed height for the window
      window.api.listenView.adjustWindowHeight('listen', fixedHeight);
    }
  };

  useEffect(() => {
    adjustWindowHeight(); // Set the fixed height when the component mounts
  }, []);

  useEffect(() => {
    if (followLive && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines, followLive]);

  const toggleView = () => {
    setViewMode(prev => prev === 'transcript' ? 'insights' : 'transcript');
  };

  return (
    <div className="glass-panel evia-glass" style={{ pointerEvents: 'auto', height: '500px' /* Fixed height */ }}>
      <div className="glass-topbar drag-zone">
        <div className="glass-topbar-title">Listen</div>
        <button onClick={toggleView} className="glass-button no-drag">
          {viewMode === 'transcript' ? 'Insights' : 'Transcript'}
        </button>
        {onClose && (
          <button className="glass-button" onClick={onClose}>✕</button>
        )}
      </div>
      <div className="glass-scroll no-drag" ref={viewportRef}>
        {viewMode === 'transcript' ? (
          lines.length > 0 ? (
            lines.map((line, i) => (
              <div key={i} className={`bubble ${line.speaker === 1 ? 'me' : 'them'}`} style={{ opacity: line.isFinal ? 1 : 0.7 }}>
                <span className="bubble-text">{line.text}</span>
              </div>
            ))
          ) : (
            <div className="insights-placeholder">
              <p>Waiting for speech...</p>
            </div>
          )
        ) : (
          <div className="insights-placeholder">
            <p>No insights yet</p>
          </div>
        )}
      </div>
      <button onClick={onToggleFollow} className="follow-button no-drag">
        {followLive ? 'Stop Following' : 'Follow Live'}
      </button>
    </div>
  );
};

export default ListenView;
