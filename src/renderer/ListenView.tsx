import { useState, useRef, useEffect } from 'react';

interface Segment {
  speaker: number;
  text: string;
  isInterim?: boolean;
}

const ListenView = ({ segments }: { segments: Segment[] }) => {
  const [followLive, setFollowLive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (followLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, followLive]);

  const jumpToLatest = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  return (
    <div className="transcription-container" style={{ backdropFilter: 'blur(10px)', padding: '16px' }}>
      <label className="toggle-label">
        <input type="checkbox" checked={followLive} onChange={(e) => setFollowLive(e.target.checked)} />
        Follow live
      </label>
      {!followLive && <button className="jump-button" onClick={jumpToLatest}>Jump to latest</button>}
      <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: '300px' }}>
        {segments.map((seg: Segment, i: number) => (
          <div key={i} className={`stt-message ${seg.speaker === 0 ? 'right-align' : 'left-align'}`} style={{ marginBottom: '8px', opacity: seg.isInterim ? 0.7 : 1 }}>
            <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.1)', borderRadius: '10px', padding: '8px 12px' }}>
              {seg.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
