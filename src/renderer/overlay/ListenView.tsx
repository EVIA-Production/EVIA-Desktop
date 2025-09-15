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
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);

  const adjustWindowHeight = () => {
    if (!window.api || !viewportRef.current) return;

    const topBar = document.querySelector('.top-bar');
    const activeContent = viewportRef.current;
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
    if (followLive && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
    adjustWindowHeight();
  }, [lines, followLive, viewMode]);

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
      : 'Copy Glass Analysis'
    : viewMode === 'insights'
    ? 'Live insights'
    : `Glass is Listening ${elapsedTime}`;

  return (
    <div className="assistant-container" style={{ width: '400px', transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden', transition: 'transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out', willChange: 'transform, opacity' }}>
      <style>
        {`
          .assistant-container {
            display: flex;
            flex-direction: column;
            color: #ffffff;
            box-sizing: border-box;
            position: relative;
            background: rgba(0, 0, 0, 0.6);
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
            z-index: -1;
          }

          .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 16px;
            min-height: 32px;
            position: relative;
            z-index: 1;
            width: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          }

          .bar-left-text {
            color: white;
            font-size: 13px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 500;
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
            gap: 4px;
            align-items: center;
            flex-shrink: 0;
            width: 120px;
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
            transition: background-color 0.15s ease;
            justify-content: center;
          }

          .toggle-button:hover {
            background: rgba(255, 255, 255, 0.1);
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
            transition: background-color 0.15s ease;
            position: relative;
            overflow: hidden;
          }

          .copy-button:hover {
            background: rgba(255, 255, 255, 0.15);
          }

          .copy-button svg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
          }

          .copy-button.copied .copy-icon {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
          }

          .copy-button.copied .check-icon {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }

          .glass-scroll {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
          }

          .bubble {
            margin: 8px;
            padding: 8px 12px;
            border-radius: 12px;
            max-width: 80%;
            display: inline-block;
          }

          .bubble.me {
            background: rgba(255, 255, 255, 0.2);
            margin-left: auto;
          }

          .bubble.them {
            background: rgba(0, 0, 0, 0.3);
          }

          .bubble-text {
            font-size: 14px;
          }

          .insights-placeholder {
            color: rgba(255, 255, 255, 0.7);
            text-align: center;
            padding: 16px;
          }

          .follow-button {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            padding: 8px;
            border-radius: 5px;
            font-size: 11px;
            cursor: pointer;
            margin: 8px;
            transition: background-color 0.15s ease;
          }

          .follow-button:hover {
            background: rgba(255, 255, 255, 0.1);
          }

          @keyframes slideIn {
            from {
              transform: translateY(100%);
            }
            to {
              transform: translateY(0);
            }
          }

          /* Glass bypass styles */
          body.has-glass .assistant-container,
          body.has-glass .top-bar,
          body.has-glass .toggle-button,
          body.has-glass .copy-button,
          body.has-glass .follow-button {
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            filter: none !important;
            backdrop-filter: none !important;
          }

          body.has-glass .assistant-container::before,
          body.has-glass .assistant-container::after {
            display: none !important;
          }

          body.has-glass .toggle-button:hover,
          body.has-glass .copy-button:hover,
          body.has-glass .follow-button:hover {
            background: transparent !important;
            transform: none !important;
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
            {onClose && (
              <button className="copy-button" onClick={onClose}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="glass-scroll" ref={viewportRef}>
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
        <button onClick={onToggleFollow} className="follow-button">
          {followLive ? 'Stop Following' : 'Follow Live'}
        </button>
      </div>
    </div>
  );
};

export default ListenView;