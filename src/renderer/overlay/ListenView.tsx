import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { getWebSocketInstance } from '../services/websocketService';
import { fetchInsights, Insight } from '../services/insightsService';
import { i18n } from '../i18n/i18n';

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
  isPartial?: boolean;
  timestamp?: number; // 🔧 STEP 1: Timestamp for time-based bubble merging
}

interface ListenViewProps {
  lines: TranscriptLine[];
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

const ListenView: React.FC<ListenViewProps> = ({ lines, followLive, onToggleFollow, onClose }) => {
  // 🔍 DIAGNOSTIC: Component function execution (runs on EVERY render)
  console.log('[ListenView] 🔍🔍🔍 COMPONENT FUNCTION EXECUTING - PROOF OF INSTANTIATION')
  console.log('[ListenView] 🔍 Props:', { linesCount: lines.length, followLive })
  console.log('[ListenView] 🔍 Window location:', window.location.href)
  console.log('[ListenView] 🔍 React:', typeof React, 'useState:', typeof useState, 'useEffect:', typeof useEffect)
  
  const [transcripts, setTranscripts] = useState<{text: string, speaker: number | null, isFinal: boolean, isPartial?: boolean, timestamp?: number}[]>([]);
  const [localFollowLive, setLocalFollowLive] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('transcript');
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [copiedView, setCopiedView] = useState<'transcript' | 'insights' | null>(null); // Track which view was copied
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [isSessionActive, setIsSessionActive] = useState(false);
  // Glass parity: Insights fetched from backend via fetchInsights service
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true); // Glass parity: auto-scroll when at bottom
  const autoScrollRef = useRef(true); // 🔧 FIX: Use ref to avoid re-render dependency issues
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);
  const shouldScrollAfterUpdate = useRef(false); // 🔧 GLASS PARITY: Track if near bottom before update
  
  // Sync autoScroll state with ref
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

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

  // Glass parity: Auto-scroll when at bottom
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 50;
      setAutoScroll(isAtBottom);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  // 🔧 GLASS PARITY: Scroll AFTER React renders (lines 195-204 in SttView.js)
  // This runs AFTER transcripts state update and DOM render
  useEffect(() => {
    if (shouldScrollAfterUpdate.current && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      shouldScrollAfterUpdate.current = false;
    }
  }, [transcripts]); // Run after transcripts update

  useEffect(() => {
    adjustWindowHeight();
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  // 🔧 FIX: Cleanup timer on unmount
  useEffect(() => {
    return () => {
      console.log('[ListenView] 🛑 Stopping timer on unmount');
      stopTimer();
      setIsSessionActive(false);
    };
  }, []); // Empty dependency - cleanup on unmount

  // Listen for transcript messages forwarded from Header window via IPC
  // Header window captures audio, sends to backend via WebSocket, and forwards transcripts here
  useEffect(() => {
    console.log('[ListenView] Setting up IPC listener for transcript messages');
    
    const handleTranscriptMessage = (msg: any) => {
      console.log('[ListenView] 📨 Received IPC message:', msg.type, '_source:', msg._source);
      
      // Handle recording_started to start timer
      if (msg.type === 'recording_started') {
        console.log('[ListenView] ▶️  Recording started - starting timer');
        setIsSessionActive(true);
        startTimer();
        return;
      }
      
      // Handle recording_stopped to stop timer
      if (msg.type === 'recording_stopped') {
        console.log('[ListenView] 🛑 Recording stopped - stopping timer');
        stopTimer();
        setIsSessionActive(false);
        return;
      }
      
      // Extract message data
      let text: string | undefined;
      let speaker: number | null = null;
      let isFinal = false;
      let isPartial = false;
      
      if (msg.type === 'transcript_segment' && msg.data) {
        text = msg.data.text || '';
        speaker = msg.data.speaker ?? null;
        isFinal = msg.data.is_final === true;
        isPartial = !isFinal; // If not final, it's partial
      } else if (msg.type === 'status' && msg.data?.echo_text) {
        // 🔧 FIX: Status messages with echo_text are INTERIM/PARTIAL transcripts from Deepgram
        text = msg.data.echo_text;
        // Infer speaker from _source: 'mic' = 1, 'system' = 0
        speaker = msg._source === 'mic' ? 1 : msg._source === 'system' ? 0 : null;
        isFinal = msg.data.final === true;
        isPartial = !isFinal; // If not final, it's partial
      } else if (msg.type === 'status') {
        // Filter out connection status messages (no echo_text = connection event)
        console.log('[ListenView] 📊 CONNECTION STATUS (console only):', msg.data);
        return;
      }
      
      // Only process if we have text
      if (!text) return;
      
      // 🔧 FILTER: Remove "EVIA connection OK" messages from transcript display
      if (text.trim().toLowerCase() === 'evia connection ok') {
        console.log('[ListenView] 🚫 Filtered out "EVIA connection OK" message');
        return;
      }
      
      // 🔧 STEP 1: Capture timestamp for time-based merging
      const messageTimestamp = Date.now();
      
      // Log after text is confirmed to exist
      console.log('[ListenView] 📨', msg.type === 'transcript_segment' ? 'transcript_segment:' : 'status:', 
                  text.substring(0, 50), 'speaker:', speaker, 'isFinal:', isFinal);
      
      // 🔧 GLASS PARITY: Check if scrolled near bottom BEFORE update (line 120 in SttView.js)
      const container = viewportRef.current;
      if (container) {
        shouldScrollAfterUpdate.current = 
          container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
      }
      
      // 🔧 STEP 1 ENHANCED: Time-based + punctuation-aware bubble merging
      // Based on Glass parity + coordinator's Option A (2.5s window + punctuation check)
      setTranscripts(prev => {
        // Helper: Find last partial from same speaker
        const findLastPartialIdx = (spk: number | null) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].speaker === spk && prev[i].isPartial) {
              return i;
            }
          }
          return -1;
        };
        
        // 🔧 NEW: Find last FINAL from same speaker (for merging consecutive finals)
        const findLastFinalIdx = (spk: number | null, searchArray?: TranscriptLine[]) => {
          const arr = searchArray || prev;
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].speaker === spk && arr[i].isFinal) {
              return i;
            }
          }
          return -1;
        };
        
        const newMessages = [...prev];
        const targetIdx = findLastPartialIdx(speaker);
        
        if (isPartial) {
          // Partial/interim: Update existing partial or add new
          if (targetIdx !== -1) {
            console.log('[ListenView] 🔄 UPDATING partial at index', targetIdx, 'text:', text.substring(0, 30));
            newMessages[targetIdx] = {
              text,
              speaker,
              isFinal: false,
              isPartial: true,
              timestamp: messageTimestamp,
            };
          } else {
            console.log('[ListenView] ➕ ADDING new partial, text:', text.substring(0, 30));
            newMessages.push({
              text,
              speaker,
              isFinal: false,
              isPartial: true,
              timestamp: messageTimestamp,
            });
          }
        } else if (isFinal) {
          // Final: Convert existing partial to final, OR merge with last final, OR add new
          if (targetIdx !== -1) {
            // Convert existing partial to final
            console.log('[ListenView] ✅ CONVERTING partial to FINAL at index', targetIdx, 'text:', text.substring(0, 30));
            newMessages[targetIdx] = {
              text,
              speaker,
              isFinal: true,
              isPartial: false,
              timestamp: messageTimestamp,
            };

            // 🔧 CRITICAL FIX: After converting, check if we should MERGE with PREVIOUS final
            const previousFinalIdx = findLastFinalIdx(speaker, newMessages.slice(0, targetIdx));
            
            if (previousFinalIdx !== -1) {
              const prevMessage = newMessages[previousFinalIdx];
              const prevText = prevMessage.text;
              const prevTimestamp = prevMessage.timestamp || 0;
              const timeSinceLastMs = messageTimestamp - prevTimestamp;
              
              const endsWithSentence = /[.!?][\s]*$|\.{3}[\s]*$/.test(prevText.trim());
              const startsWithCapital = /^[A-Z]/.test(text.trim());
               // 🔧 PARAGRAPH GROUPING: 10-second window (Deepgram finalizes every 4-8s)
               // Only split on: speaker change OR significant pause (>10s) OR clear paragraph boundary
               const shouldMerge = timeSinceLastMs <= 10000 && (!endsWithSentence || !startsWithCapital);
               
               console.log('[ListenView] 🔍 MERGE DECISION (post-convert):', {
                previousFinalIdx,
                currentIdx: targetIdx,
                timeSinceLastMs: `${timeSinceLastMs}ms`,
                endsWithSentence,
                startsWithCapital,
                shouldMerge,
                prevText: prevText.substring(Math.max(0, prevText.length - 30)),
                newText: text.substring(0, 30)
              });
              
              if (shouldMerge) {
                console.log('[ListenView] 🔗 MERGING current final into previous at index', previousFinalIdx);
                // Merge current into previous
                newMessages[previousFinalIdx] = {
                  ...prevMessage,
                  text: prevText + ' ' + text,
                  timestamp: messageTimestamp,
                };
                // Remove current (now merged) message
                  newMessages.splice(targetIdx, 1);
                } else {
                  const reason = timeSinceLastMs > 10000 ? 'TIME_EXCEEDED (>10s pause)' : 'SENTENCE_BOUNDARY (paragraph break)';
                  console.log('[ListenView] ➕ KEEPING as separate FINAL (reason:', reason + ')');
                }
            }
          } else {
            // 🔧 STEP 1: Enhanced merge logic with time + punctuation checks
            const lastFinalIdx = findLastFinalIdx(speaker);
            
            if (lastFinalIdx !== -1) {
              const lastMessage = newMessages[lastFinalIdx];
              const lastText = lastMessage.text;
              const lastTimestamp = lastMessage.timestamp || 0;
              const timeSinceLastMs = messageTimestamp - lastTimestamp;
              
              // Helper: Check if text ends with sentence-ending punctuation
              const endsWithSentence = /[.!?][\s]*$|\.{3}[\s]*$/.test(lastText.trim());
              
              // Helper: Check if new text starts with capital letter (potential new sentence)
              const startsWithCapital = /^[A-Z]/.test(text.trim());
                
                // MERGE CONDITIONS (paragraph-level grouping):
                // 1. Within 10-second window (matches Deepgram's 4-8s finalization + buffer)
                // 2. Last message doesn't end with sentence punctuation OR new text doesn't start with capital
                //    This creates paragraph-like grouping: only split on speaker change, long pause (>10s), or clear paragraph boundary
                const shouldMerge = timeSinceLastMs <= 10000 && (!endsWithSentence || !startsWithCapital);
              
              console.log('[ListenView] 🔍 MERGE DECISION:', {
                lastFinalIdx,
                timeSinceLastMs: `${timeSinceLastMs}ms`,
                endsWithSentence,
                startsWithCapital,
                shouldMerge,
                lastText: lastText.substring(Math.max(0, lastText.length - 30)),
                newText: text.substring(0, 30)
              });
              
              if (shouldMerge) {
                // APPEND to existing final bubble
                console.log('[ListenView] 🔗 MERGING with final at index', lastFinalIdx);
                newMessages[lastFinalIdx] = {
                  ...lastMessage,
                  text: lastText + ' ' + text,
                  timestamp: messageTimestamp, // Update to latest timestamp
                };
                } else {
                  // Create new final bubble (significant pause or paragraph boundary detected)
                  const reason = timeSinceLastMs > 10000 ? 'TIME_EXCEEDED (>10s pause)' : 'SENTENCE_BOUNDARY (paragraph break)';
                  console.log('[ListenView] ➕ ADDING new FINAL (no merge -', reason + ')');
                  newMessages.push({
                  text,
                  speaker,
                  isFinal: true,
                  isPartial: false,
                  timestamp: messageTimestamp,
                });
              }
            } else {
              // No previous final - create new bubble
              console.log('[ListenView] ➕ ADDING new FINAL (first from speaker)');
              newMessages.push({
                text,
                speaker,
                isFinal: true,
                isPartial: false,
                timestamp: messageTimestamp,
              });
            }
          }
        }
        
        return newMessages;
      });
      
      // Note: Scroll happens in useEffect AFTER React renders (see below)
    };
    
    const eviaIpc = (window as any).evia?.ipc as { on: (channel: string, listener: (...args: any[]) => void) => void } | undefined;
    if (eviaIpc?.on) {
      eviaIpc.on('transcript-message', handleTranscriptMessage);
      console.log('[ListenView] ✅ IPC listener registered');
    } else {
      console.error('[ListenView] ❌ window.evia.ipc.on not available');
    }
    
    return () => {
      console.log('[ListenView] Cleaning up IPC listener');
      // Note: Electron IPC doesn't provide removeListener, so we just log cleanup
    };
  }, [])  // 🔧 FIX: Empty deps - IPC listener should only register ONCE on mount, not on every autoScroll change

  const toggleView = async () => {
    const newMode = viewMode === 'transcript' ? 'insights' : 'transcript';
    setViewMode(newMode);
    // Glass parity: Reset copy state when switching views (only show "Copied X" for the view that was actually copied)
    if (copyState === 'copied' && copiedView !== newMode) {
      setCopyState('idle');
    }
    
    // Fetch insights when switching to insights view
    if (newMode === 'insights' && insights.length === 0) {
      setIsLoadingInsights(true);
      try {
        const chatId = Number(localStorage.getItem('current_chat_id') || '0');
        const token = localStorage.getItem('auth_token') || '';
        if (chatId && token) {
          const fetchedInsights = await fetchInsights({ chatId, token, language: 'de' });
          setInsights(fetchedInsights);
        }
      } catch (error) {
        console.error('[ListenView] Failed to fetch insights:', error);
      } finally {
        setIsLoadingInsights(false);
      }
    }
  };

  const handleCopyHover = (hovering: boolean) => {
    setIsHovering(hovering);
  };

  const handleCopy = async () => {
    if (copyState === 'copied') return;

    let textToCopy = viewMode === 'transcript' 
      ? transcripts.map(line => line.text).join('\n')
      : insights.map(i => `${i.title}: ${i.prompt}`).join('\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState('copied');
      setCopiedView(viewMode); // Track which view was copied
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
      copyTimeout.current = setTimeout(() => {
        setCopyState('idle');
        setCopiedView(null); // Reset after timeout
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleInsightClick = async (insight: Insight) => {
    console.log('[ListenView] 🎯 Insight clicked:', insight.title);
    console.log('[ListenView] Insight prompt:', insight.prompt);
    
    // Glass parity: Open Ask window and send prompt via IPC
    try {
      // 1. Open Ask window
      await (window as any).evia?.windows?.openAskWindow?.();
      console.log('[ListenView] ✅ Ask window opened');
      
      // 2. Send prompt via IPC (Glass parity: uses IPC relay)
      const eviaIpc = (window as any).evia?.ipc as { send: (channel: string, ...args: any[]) => void } | undefined;
      if (eviaIpc) {
        eviaIpc.send('ask:set-prompt', insight.prompt);
        console.log('[ListenView] ✅ Prompt sent via IPC');
      } else {
        console.warn('[ListenView] IPC not available, falling back to DOM manipulation');
        // Fallback: DOM manipulation (less reliable)
        setTimeout(() => {
          const askInput = document.querySelector('#textInput') as HTMLInputElement;
          if (askInput) {
            askInput.value = insight.prompt;
            askInput.focus();
            console.log('[ListenView] ⚠️ Prompt set via DOM (fallback)');
          }
        }, 300);
      }
    } catch (error) {
      console.error('[ListenView] ❌ Failed to handle insight click:', error);
    }
  };

  // Glass parity: Only show "Copied X" if current view matches what was copied
  const displayText = (copyState === 'copied' && copiedView === viewMode)
    ? viewMode === 'transcript'
      ? i18n.t('overlay.listen.copiedTranscript')
      : i18n.t('overlay.listen.copiedInsights')
    : isHovering
    ? viewMode === 'transcript'
      ? i18n.t('overlay.listen.copyTranscript')
      : i18n.t('overlay.listen.copyInsights')
    : viewMode === 'insights'
    ? i18n.t('overlay.listen.showInsights')
    : `${i18n.t('overlay.listen.listening')} ${elapsedTime}`;

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

          /* Glass parity: Scrollbar styling (hidden for ListenView) */
          .glass-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          /* 🔧 FIX: Visible scrollbar on right side (Glass override) */
          .glass-scroll::-webkit-scrollbar {
            width: 6px;
            background: transparent;
          }

          .glass-scroll::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
            margin: 4px 0;
          }

          .glass-scroll::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.4);
            border-radius: 3px;
            transition: background 0.2s ease;
          }

          .glass-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.6);
          }
          
          /* Firefox scrollbar */
          .glass-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.4) rgba(255, 255, 255, 0.05);
          }

          /* Glass parity: Bubble styling */
          .bubble {
            padding: 8px 12px;
            border-radius: 12px;
            max-width: 80%;
            word-wrap: break-word;
            font-size: 13px;
            line-height: 1.4;
            transition: opacity 0.2s ease;
          }

          .bubble.me {
            align-self: flex-end;
          }

          .bubble.them {
            align-self: flex-start;
          }

          .bubble-text {
            display: block;
          }


          /* Insights styling (Glass parity) */
          .insight-item {
            padding: 12px 16px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }

          .insight-item:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
          }

          .insight-title {
            font-size: 13px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.95);
            margin-bottom: 4px;
          }

          .insight-prompt {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.7);
            font-style: italic;
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
                  <span>{i18n.t('overlay.listen.showTranscript')}</span>
                </>
              ) : (
                <>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  <span>{i18n.t('overlay.listen.showInsights')}</span>
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
            transcripts.length > 0 ? (
              transcripts.map((line, i) => {
                // 🎨 GLASS PARITY: speaker 0 = system/them (grey, left), speaker 1 = mic/me (blue, right)
                // null defaults to system (grey, left) for safety
                const isMe = line.speaker === 1;
                const isThem = line.speaker === 0 || line.speaker === null; // Default to "them" if unknown
                
                return (
                  <div
                    key={i}
                    className={`bubble ${isMe ? 'me' : 'them'}`}
                    style={{
                      // 🎨 GLASS PARITY: Full opacity always (no fade for partial vs final)
                      opacity: 1.0,
                      // 🎨 GLASS PARITY: Blue for me, grey for them (exact colors from Glass SttView.js)
                      background: isMe
                        ? 'rgba(0, 122, 255, 0.8)'  // Glass .me color
                        : 'rgba(255, 255, 255, 0.1)', // Glass .them color
                      color: isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.9)',
                      // 🎨 GLASS PARITY: Alignment
                      alignSelf: isMe ? 'flex-end' : 'flex-start',
                      marginLeft: isMe ? 'auto' : '0',
                      marginRight: isThem ? 'auto' : '0',
                      // 🎨 GLASS PARITY: Border radius (asymmetric per Glass)
                      borderRadius: '12px',
                      borderBottomLeftRadius: isThem ? '4px' : '12px',
                      borderBottomRightRadius: isMe ? '4px' : '12px',
                      padding: '8px 12px',
                      marginBottom: '8px',
                      maxWidth: '80%',
                      wordWrap: 'break-word',
                      fontSize: '13px',
                      lineHeight: '1.5',
                    }}
                  >
                    {/* 🔧 GLASS PARITY: No speaker labels, only CSS-based styling via background color */}
                    <span className="bubble-text">{line.text}</span>
                  </div>
                );
              })
            ) : (
              <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
                {i18n.t('overlay.listen.waitingForSpeech')}
              </div>
            )
          ) : isLoadingInsights ? (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              Loading insights...
            </div>
          ) : insights.length > 0 ? (
            insights.map((insight) => (
              <div
                key={insight.id}
                className="insight-item"
                onClick={() => handleInsightClick(insight)}
              >
                <div className="insight-title">{insight.title}</div>
                <div className="insight-prompt">{insight.prompt}</div>
              </div>
            ))
          ) : (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              {i18n.t('overlay.listen.noInsightsYet')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListenView;