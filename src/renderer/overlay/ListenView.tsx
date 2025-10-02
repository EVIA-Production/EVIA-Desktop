import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { getWebSocketInstance } from '../services/websocketService';

declare global {
  interface Window {
    api: {
      listenView: {
        adjustWindowHeight: (view: string, height: number) => void;
      };
      // Add other methods as needed
    };
  }
}

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
  const [transcripts, setTranscripts] = useState<{text: string, speaker: number | null, isFinal: boolean}[]>([]);
  const [localFollowLive, setLocalFollowLive] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('transcript');
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);

  const adjustWindowHeight = () => {
    if (!window.api || !viewportRef.current) return;

    const topBar = document.querySelector('.top-bar') as HTMLElement;
    const activeContent = viewportRef.current as HTMLElement;
    if (!topBar || !activeContent) return;

    const topBarHeight = topBar.offsetHeight;
    const contentHeight = activeContent.scrollHeight;
    const idealHeight = topBarHeight + contentHeight;
    const targetHeight = Math.min(700, idealHeight);

    window.api.listenView.adjustWindowHeight('listen', targetHeight);
  };

  const startTimer = () => {
    const startTime = Date.now();
    timerInterval.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');
      setElapsedTime(`${minutes}:${seconds}`);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  useEffect(() => {
    adjustWindowHeight();
    if (isSessionActive) {
      startTimer();
    }
    return () => {
      stopTimer();
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    const cid = localStorage.getItem('current_chat_id');
    if (!cid || cid === 'undefined') {
      console.error('No valid chat_id; create one first');
      return () => {};
    }
    // WebSocket setup for receiving transcripts
    const ws = getWebSocketInstance(cid, 'mic');
    ws.connect();
    const unsub = ws.onMessage((msg: any) => {
      if (msg.type === 'transcript_segment' && msg.data) {
        const { text = '', speaker = null, is_final = false } = msg.data;
        setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
        if (localFollowLive && viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
      }
    });
    return () => { unsub(); ws.disconnect(); };
  }, [localFollowLive]);

  const toggleView = () => {
    setViewMode(prev => prev === 'transcript' ? 'insights' : 'transcript');
  };

  const handleCopyHover = (hovering: boolean) => {
    setIsHovering(hovering);
  };

  const handleCopy = async () => {
    if (copyState === 'copied') return;

    let textToCopy = viewMode === 'transcript' 
      ? lines.map(line => line.text).join('\n')
      : 'Insights content placeholder';

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState('copied');
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
      copyTimeout.current = setTimeout(() => {
        setCopyState('idle');
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const displayText = isHovering
    ? viewMode === 'transcript'
      ? 'Copy Transcript'
      : 'Copy EVIA Analysis'
    : viewMode === 'insights'
    ? 'Live insights'
    : `EVIA is Listening ${elapsedTime}`;

  return (
    <div className="assistant-container" style={{ width: '400px', transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden', transition: 'transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out', willChange: 'transform, opacity' }}>
      {/* Glass parity: NO close button in ListenView (ListenView.js:636-686) */}
      <style>
        {`
          .assistant-container {
            display: flex;
            flex-direction: column;
            color: #ffffff;
            box-sizing: border-box;
            position: relative;
            background: rgba(0, 0, 0, 0.3); /* Lightened background */
            overflow: hidden;
            border-radius: 12px;
            width: 100%;
            height: 100%;
          }

          .assistant-container::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 12px;
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.17) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.17) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 0; /* Ensure it does not overlap buttons */
          }

          .assistant-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.15);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            z-index: -1; /* Ensure it stays behind all content */
          }

          .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 16px;
            min-height: 32px;
            position: relative;
            z-index: 1; /* Ensure it stays above pseudo-elements */
            width: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }

          .bar-left-text {
            color: white;
            font-size: 13px; /* Match font size */
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; /* Match font family */
            font-weight: 500; /* Match font weight */
            position: relative;
            overflow: hidden;
            white-space: nowrap;
            flex: 1;
            min-width: 0;
            max-width: 200px;
          }

          .bar-left-text-content {
            display: inline-block;
            transition: transform 0.3s ease;
          }

          .bar-left-text-content.slide-in {
            animation: slideIn 0.3s ease forwards;
          }

          .bar-controls {
            display: flex;
            gap: 8px; /* Adjust spacing between buttons */
            align-items: center;
            flex-shrink: 0;
            flex-wrap: nowrap; /* Prevent buttons from wrapping */
            justify-content: flex-end;
            box-sizing: border-box;
            padding: 4px;
          }

          .toggle-button {
            display: flex;
            align-items: center;
            gap: 5px;
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            box-shadow: none;
            padding: 4px 8px;
            border-radius: 5px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            height: 24px;
            white-space: nowrap;
            transition: background-color 0.15s ease, color 0.15s ease;
            justify-content: center;
            z-index: 2; /* Ensure it stays above pseudo-elements */
            flex-shrink: 0; /* Prevent buttons from shrinking */
          }

          .toggle-button:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
          }

          .toggle-button svg {
            flex-shrink: 0;
            width: 12px;
            height: 12px;
          }

          .copy-button {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            box-shadow: none;
            padding: 4px;
            border-radius: 3px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 24px;
            flex-shrink: 0;
            transition: background-color 0.15s ease, color 0.15s ease;
            position: relative;
            overflow: hidden;
            z-index: 2; /* Ensure it stays above pseudo-elements */
          }

          .copy-button:hover {
            background: rgba(255, 255, 255, 0.15);
            color: #ffffff;
          }

          .copy-button svg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
          }

          .copy-button .copy-icon {
            opacity: ${copyState === 'copied' ? '0' : '1'};
            transform: ${copyState === 'copied' ? 'translate(-50%, -50%) scale(0.5)' : 'translate(-50%, -50%) scale(1)'};
          }

          .copy-button .check-icon {
            opacity: ${copyState === 'copied' ? '1' : '0'};
            transform: ${copyState === 'copied' ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.5)'};
          }

          .insights-placeholder {
            color: rgba(255, 255, 255, 0.7); /* Match text color */
            text-align: center;
            padding: 16px;
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; /* Match font family */
            font-size: 12px; /* Slightly smaller font size */
            font-weight: 400; /* Match font weight */
            font-style: italic; /* Make the text cursive */
          }

          .follow-button {
            position: absolute;
            bottom: 8px; /* Further reduced margin */
            right: 8px; /* Further reduced margin */
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            box-shadow: none;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
          }

          .follow-button:hover {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
            transform: scale(1.05);
          }

          .follow-button:active {
            transform: scale(0.95);
          }
        `}
      </style>
      <div className="assistant-container">
        <div className="top-bar">
          <div className="bar-left-text">
            <span className={`bar-left-text-content ${isHovering ? 'slide-in' : ''}`}>
              {displayText}
            </span>
          </div>
          <div className="bar-controls">
            <button className="toggle-button" onClick={toggleView}>
              {viewMode === 'insights' ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Show Transcript</span>
                </>
              ) : (
                <>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  <span>Show Insights</span>
                </>
              )}
            </button>
            <button
              className={`copy-button ${copyState === 'copied' ? 'copied' : ''}`}
              onClick={handleCopy}
              onMouseEnter={() => handleCopyHover(true)}
              onMouseLeave={() => handleCopyHover(false)}
            >
              <svg className="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="glass-scroll" ref={viewportRef}>
          {viewMode === 'transcript' ? (
            lines.length > 0 ? (
              lines.map((line, i) => (
                <div
                  key={i}
                  className={`bubble ${line.speaker === 0 ? 'me' : 'them'}`}
                  style={{
                    opacity: line.isFinal ? 1 : 0.6,
                    background:
                      line.speaker === 0
                        ? 'linear-gradient(135deg, rgba(0, 122, 255, 0.9) 0%, rgba(10, 132, 255, 0.85) 100%)'
                        : 'rgba(255, 255, 255, 0.12)',
                    alignSelf: line.speaker === 0 ? 'flex-end' : 'flex-start',
                    color: '#ffffff',
                  }}
                >
                  <span className="bubble-text">{line.text}</span>
                </div>
              ))
            ) : (
              <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
                Waiting for speech...
              </div>
            )
          ) : (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              No insights yet
            </div>
          )}
        </div>
        <button onClick={onToggleFollow} className="follow-button">
          {localFollowLive ? 'Stop Following' : 'Follow Live'}
        </button>
      </div>
    </div>
  );
};

export default ListenView;