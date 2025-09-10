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
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('transcript'); // Added toggle from Glass

  useEffect(() => {
    if (followLive && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines, followLive]);

  const toggleView = () => {
    setViewMode(prev => prev === 'transcript' ? 'insights' : 'transcript');
  };

  return (
    <div className="glass-panel evia-glass" style={{ pointerEvents: 'auto' }}>
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
        {viewMode === 'transcript' ? lines.map((line, i) => (
          <div key={i} className={`bubble ${line.speaker === 1 ? 'me' : 'them'}`} style={{ opacity: line.isFinal ? 1 : 0.7 }}>
            <span className="bubble-text">{line.text}</span>
          </div>
        )) : <div>Insights Placeholder - Port from Glass summary</div>}
      </div>
      <button onClick={onToggleFollow} className="follow-button no-drag">
        {followLive ? 'Stop Following' : 'Follow Live'}
      </button>
    </div>
  );
};

export default ListenView;
