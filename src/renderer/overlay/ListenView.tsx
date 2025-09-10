import React, { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (followLive && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines, followLive]);

  return (
    <div className="glass-panel evia-glass" style={{ pointerEvents: 'auto' }}>
      <div className="glass-topbar drag-zone">
        <div className="glass-topbar-title">Listening</div>
        <div className="glass-controls no-drag" style={{ gap: 8 }}>
          <button className="glass-button" onClick={() => { if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight; }}>Jump to latest</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={followLive} onChange={onToggleFollow} />
            <span style={{ fontSize: 12, color: '#fff' }}>Follow live</span>
          </label>
          {onClose && (
            <button className="glass-button" onClick={onClose}>✕</button>
          )}
        </div>
      </div>
      <div className="glass-scroll" ref={viewportRef}>
        {lines.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>Waiting for transcript…</div>
        ) : (
          lines.map((ln, idx) => (
            <div key={idx} style={{ display: 'flex', justifyContent: ln.speaker === 1 ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
              <div className={`bubble ${ln.speaker === 1 ? 'me' : 'them'}`}>
                {ln.text}{ln.isFinal ? '' : ' ▌'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ListenView;
