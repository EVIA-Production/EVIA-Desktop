import { useState, useRef, useEffect } from 'react';

const ListenView = ({ segments }) => { // Assume segments prop from parent
  const [followLive, setFollowLive] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (followLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, followLive]);

  const jumpToLatest = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  return (
    <div>
      <label>
        <input type="checkbox" checked={followLive} onChange={(e) => setFollowLive(e.target.checked)} />
        Follow live
      </label>
      {!followLive && <button onClick={jumpToLatest}>Jump to latest</button>}
      <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: '300px' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ textAlign: seg.speaker === 0 ? 'right' : 'left', opacity: seg.isInterim ? 0.7 : 1 }}>
            <div style={{ display: 'inline-block', background: 'lightgray', borderRadius: '10px', padding: '5px' }}>
              {seg.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
