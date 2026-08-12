import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';

const ListenIcon = new URL('./assets/Listen.svg', import.meta.url).href;
const SettingsIcon = new URL('./assets/setting.svg', import.meta.url).href;
const CommandIcon = new URL('./assets/command.svg', import.meta.url).href;

interface EviaBarProps {
  currentView: 'listen' | 'ask' | 'settings' | 'shortcuts' | null;
  onViewChange: (v: 'listen' | 'ask' | 'settings' | 'shortcuts' | null) => void;
  isListening: boolean;
  onSetListening: (enabled: boolean) => Promise<boolean>;
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onToggleVisibility?: () => void;
}

type CaptureSessionState = 'idle' | 'starting' | 'recording' | 'stopping' | 'review' | 'error';
type CaptureSessionSnapshot = {
  state: CaptureSessionState;
  generation: number;
  changedAt: number;
  reason: string;
  errorCode: string | null;
};
type CaptureTransitionResult = {
  accepted: boolean;
  changed: boolean;
  reason: string;
  snapshot: CaptureSessionSnapshot;
};

const INITIAL_CAPTURE_SESSION: CaptureSessionSnapshot = {
  state: 'idle',
  generation: 0,
  changedAt: 0,
  reason: 'renderer_initializing',
  errorCode: null,
};

// Shortcut configuration type
interface ShortcutConfig {
  toggleVisibility?: string;
  nextStep?: string;
  moveUp?: string;
  moveDown?: string;
  moveLeft?: string;
  moveRight?: string;
  scrollUp?: string;
  scrollDown?: string;
  toggleClickThrough?: string;
  manualScreenshot?: string;
  previousResponse?: string;
  nextResponse?: string;
}

const EviaBar: React.FC<EviaBarProps> = ({
  currentView,
  onViewChange,
  isListening,
  onSetListening,
  language,
  onToggleLanguage,
  onToggleVisibility,
}) => {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const lastMoveTimeRef = useRef<number>(0); // Throttle mouse move events
  const settingsHideTimerRef = useRef<NodeJS.Timeout | null>(null); // Glass parity: timer for settings hover
  const completeSessionInFlightRef = useRef(false);

  // Platform info is exposed by preload; use it for correct shortcut labels before IPC loads.
  const isMacPlatform = useMemo(() => {
    return typeof window !== 'undefined' && (window as any)?.platformInfo?.isMac === true;
  }, []);
  const isWindowsPlatform = useMemo(() => {
    return typeof window !== 'undefined' && (window as any)?.platformInfo?.isWindows === true;
  }, []);

  const handleBottomDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      startX: event.screenX,
      startY: event.screenY,
      initialX: window.screenX,
      initialY: window.screenY,
    };
    lastMoveTimeRef.current = 0;
  };

  const handleBottomDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;

    const now = performance.now();
    if (now - lastMoveTimeRef.current < 16) return;
    lastMoveTimeRef.current = now;

    void (window as any).evia?.windows?.moveHeaderTo?.(
      Math.round(drag.initialX + event.screenX - drag.startX),
      Math.round(drag.initialY + event.screenY - drag.startY),
    );
  };

  const stopBottomDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
  };

  // WINDOWS FIX (2025-12-06): Load shortcuts dynamically like Glass MainHeader.js
  // Default shortcuts for initial render (before IPC loads)
  const defaultShortcuts: ShortcutConfig = {
    toggleVisibility: isMacPlatform ? 'Cmd+\\' : 'Ctrl+Space',
    nextStep: isMacPlatform ? 'Cmd+Enter' : 'Ctrl+Enter',
  };
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(defaultShortcuts);
  
  useEffect(() => {
    // Load shortcuts on mount
    const loadShortcuts = async () => {
      try {
        const eviaIpc = (window as any).evia?.ipc;
        console.log('[EviaBar] 🔍 Checking for evia.ipc:', !!eviaIpc, 'invoke:', !!eviaIpc?.invoke);
        
        if (eviaIpc?.invoke) {
          const result = await eviaIpc.invoke('shortcuts:get');
          console.log('[EviaBar] 📡 Raw IPC result:', result);
          
          if (result?.ok && result.shortcuts) {
            console.log('[EviaBar] ✅ Loaded shortcuts:', result.shortcuts);
            setShortcuts(result.shortcuts);
          } else {
            console.log('[EviaBar] ⚠️ Invalid result format, using defaults');
          }
        } else {
          console.log('[EviaBar] ⚠️ IPC not available, using default shortcuts');
        }
      } catch (err) {
        console.error('[EviaBar] ❌ Failed to load shortcuts:', err);
      }
    };
    
    // Small delay to ensure preload is ready
    setTimeout(loadShortcuts, 100);

    // Listen for shortcut updates (like Glass MainHeader.js line 490-494)
    const handleShortcutsUpdated = (newShortcuts: ShortcutConfig) => {
      console.log('[EviaBar] 🔄 Shortcuts updated via IPC:', newShortcuts);
      setShortcuts(newShortcuts);
    };

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.on) {
      eviaIpc.on('shortcuts-updated', handleShortcutsUpdated);
    }

    return () => {
      if (eviaIpc?.off) {
        eviaIpc.off('shortcuts-updated', handleShortcutsUpdated);
      }
    };
  }, [isWindowsPlatform]);

  // Render shortcut key with proper symbols (like Glass MainHeader.js line 578-599)
  const renderShortcutKey = (accelerator: string | undefined): React.ReactNode => {
    if (!accelerator) return null;
    const displayGermanMacHash = isMacPlatform && language === 'de';
    
    const keyMap: { [key: string]: React.ReactNode } = isWindowsPlatform ? {
      'Cmd': 'Ctrl',
      'Command': 'Ctrl', 
      'Ctrl': 'Ctrl',
      'Control': 'Ctrl',
      'Alt': 'Alt',
      'Option': 'Alt',
      'Shift': 'Shift',
      'Enter': '↵',
      'Space': 'Space',
      '\\': '\\',
    } : {
      'Cmd': '⌘',
      'Command': '⌘',
      'Ctrl': '⌃',
      'Control': '⌃',
      'Alt': '⌥',
      'Option': '⌥',
      'Shift': '⇧',
      'Enter': '↵',
      'Space': '␣',
      '#': '#',
      '\\': (
        displayGermanMacHash ? '#' : <svg viewBox="0 0 6 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width: '6px', height: '12px'}}>
          <path d="M1.5 1.3L5.1 10.6" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    };

    const keys = accelerator.split('+');
    return keys.map((key, idx) => (
      <div key={idx} className="evia-icon-box">
        {keyMap[key] || key}
      </div>
    ));
  };
  const [captureSession, setCaptureSession] = useState<CaptureSessionSnapshot>(INITIAL_CAPTURE_SESSION);
  const [isListenActive, setIsListenActive] = useState(currentView === 'listen');
  const [isAskActive, setIsAskActive] = useState(currentView === 'ask');
  const [isSettingsActive, setIsSettingsActive] = useState(currentView === 'settings');
  const startInProgressRef = useRef(false); // Prevent duplicate ScreenPicker opens on rapid clicks
  const captureSessionRef = useRef<CaptureSessionSnapshot>(INITIAL_CAPTURE_SESSION);
  const isListeningRef = useRef(isListening);

  const listenStatus: 'before' | 'in' | 'after' =
    captureSession.state === 'recording' || captureSession.state === 'stopping'
      ? 'in'
      : captureSession.state === 'review'
        ? 'after'
        : 'before';

  useEffect(() => {
    captureSessionRef.current = captureSession;
  }, [captureSession]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // The main-process capture controller is the only lifecycle authority. This
  // renderer mirrors its state; localStorage is only a cache for windows that
  // have not mounted yet.
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    const captureApi = (window as any).evia?.captureSession;

    const applySnapshot = (snapshot: CaptureSessionSnapshot) => {
      if (!snapshot || typeof snapshot.state !== 'string') return;
      captureSessionRef.current = snapshot;
      setCaptureSession(snapshot);
      const legacyState = snapshot.state === 'recording' || snapshot.state === 'stopping'
        ? 'during'
        : snapshot.state === 'review'
          ? 'after'
          : 'before';
      localStorage.setItem('evia_session_state', legacyState);
    };

    const initialize = async () => {
      const snapshot = await captureApi?.get?.();
      if (!snapshot) return;

      // A renderer reload destroys its MediaStream. Never display Stop for a
      // main-process state this renderer cannot physically confirm.
      if (
        !isListeningRef.current &&
        ['starting', 'recording', 'stopping'].includes(snapshot.state)
      ) {
        const reconciled = await captureApi?.reconcileNoCapture?.('capture_context_lost');
        applySnapshot(reconciled?.snapshot ?? reconciled ?? INITIAL_CAPTURE_SESSION);
        return;
      }
      applySnapshot(snapshot);
    };

    eviaIpc?.on?.('capture-session:state', applySnapshot);
    initialize().catch((error) => {
      console.error('[EviaBar] Failed to initialize capture lifecycle:', error);
      applySnapshot(INITIAL_CAPTURE_SESSION);
    });

    return () => eviaIpc?.off?.('capture-session:state', applySnapshot);
  }, []);

  useEffect(() => {
    setIsListenActive(currentView === 'listen');
    setIsAskActive(currentView === 'ask');
    setIsSettingsActive(currentView === 'settings');
  }, [currentView]);

  // Cleanup settings timer on unmount
  useEffect(() => {
    return () => {
      if (settingsHideTimerRef.current) {
        clearTimeout(settingsHideTimerRef.current);
      }
    };
  }, []);

  // FIX #7: Listen for error blink trigger from main process
  useEffect(() => {
    const handleErrorBlink = () => {
      console.log('[EviaBar] ⚠️ Triggering error blink animation');
      if (headerRef.current) {
        headerRef.current.classList.add('error-blink');
        setTimeout(() => {
          headerRef.current?.classList.remove('error-blink');
        }, 1000);
      }
    };

    const eviaIpc = (window as any).evia?.ipc;
    eviaIpc?.on?.('overlay:error-blink', handleErrorBlink);
    return () => {
      eviaIpc?.off?.('overlay:error-blink', handleErrorBlink);
    };
  }, []);

  // Backend meeting state follows local capture truth. It may be reconciled,
  // but it can never set the button label or resurrect a MediaStream.
  useEffect(() => {
    const reconcileStaleBackendSession = async () => {
      try {
        if (captureSessionRef.current.state !== 'idle' || isListeningRef.current) return;
        const eviaAuth = (window as any).evia?.auth;
        const captureApi = (window as any).evia?.captureSession;
        const token = await eviaAuth?.getToken?.();
        const chatId = localStorage.getItem('current_chat_id');
        const { BACKEND_URL: baseUrl } = await import('../config/config');

        if (!token || !chatId) {
          console.log('[EviaBar] ⏭️ Skipping session status sync: no token or chat_id');
          return;
        }

        console.log('[EviaBar] 🔄 Checking backend for an orphaned session...');
        const response = await fetch(`${baseUrl}/session/status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ chat_id: Number(chatId) }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[EviaBar] ✅ Backend session status:', data.status);
          if (data.status === 'during') {
            console.warn('[EviaBar] ⚠️ Completing orphaned backend session without changing capture UI');
            const completionResponse = await fetch(`${baseUrl}/session/complete`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                chat_id: Number(chatId),
                summary: 'Session ended after capture context was lost',
              }),
            });
            if (completionResponse.ok) {
              localStorage.removeItem('current_chat_id');
              (window as any).evia?.liveTranscript?.clear?.();
              (window as any).evia?.ipc?.send?.('clear-session');
            } else {
              console.warn('[EviaBar] Could not complete orphaned session:', completionResponse.status);
            }
          } else if (data.status === 'after') {
            // `after` is the normal paused post-call state. A new desktop
            // process has no capture state to restore, but must keep the chat
            // available so the user can review it and explicitly press Done.
            const restored = await captureApi?.restoreReview?.();
            if (!restored?.accepted) {
              console.warn('[EviaBar] Could not restore paused session review:', restored?.reason);
            }
          }
        } else {
          console.error('[EviaBar] ❌ Failed to get session status:', response.status, await response.text());
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error syncing session state:', error);
      }
    };

    // Sync on mount
    reconcileStaleBackendSession();

    const handleChatChanged = () => {
      reconcileStaleBackendSession();
    };

    const eviaIpc = (window as any).evia?.ipc;
    eviaIpc?.on?.('chat-changed', handleChatChanged);
    return () => {
      eviaIpc?.off?.('chat-changed', handleChatChanged);
    };
  }, []);

  // FIX: Reset listen button state when language is changed or session is cleared
  useEffect(() => {
    const handleLanguageChanged = () => {
      console.log('[EviaBar] 🌐 Language changed - reconciling capture lifecycle');
      (window as any).evia?.captureSession?.reconcileNoCapture?.('language_changed');
      setIsListenActive(false);
    };

    const handleSessionClosed = () => {
      console.log('[EviaBar] 🧹 Session closed - capture lifecycle will publish idle state');
      setIsListenActive(false);
    };

    // TODO #9 FIX: Handle graceful shutdown - complete active session before quit
    const handleBeforeQuit = async () => {
      console.log('[EviaBar] 🚪 App quitting - completing active session...');
      
      // Only complete if session is active (during or after state)
      if (captureSessionRef.current.state !== 'idle') {
        try {
          const eviaAuth = (window as any).evia?.auth;
          const token = await eviaAuth?.getToken?.();
          const chatId = localStorage.getItem('current_chat_id');
          const { BACKEND_URL: baseUrl } = await import('../config/config');
          
          if (token && chatId) {
            console.log('[EviaBar] 🎯 Completing session before quit:', chatId);
            const response = await fetch(`${baseUrl}/session/complete`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                chat_id: Number(chatId),
                summary: 'Session ended by app quit'
              })
            });
            
            if (response.ok) {
              console.log('[EviaBar] ✅ Session completed before quit');
            } else {
              console.error('[EviaBar] ❌ Failed to complete session:', response.status);
            }
          }
        } catch (error) {
          console.error('[EviaBar] ❌ Error completing session on quit:', error);
        }
      }
    };

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('language-changed', handleLanguageChanged);
      eviaIpc.on('clear-session', handleSessionClosed);
      eviaIpc.on('app:before-quit', handleBeforeQuit);
      console.log('[EviaBar] ✅ Registered language-changed, clear-session, and before-quit listeners');
    }

    return () => {
      if (eviaIpc) {
        eviaIpc.off('language-changed', handleLanguageChanged);
        eviaIpc.off('clear-session', handleSessionClosed);
        eviaIpc.off('app:before-quit', handleBeforeQuit);
      }
    };
  }, []);

  // The currently rendered pill is the sole geometry authority. ResizeObserver
  // catches every label, state, font, shortcut, and control-visibility change.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || !window.electron?.ipcRenderer) return;

    let frame = 0;
    let disposed = false;
    let lastSignature = '';
    const settleTimers: number[] = [];

    const measureAndResize = async () => {
      frame = 0;
      if (disposed || !headerRef.current) return;

      const rect = headerRef.current.getBoundingClientRect();
      const settingsRect = settingsButtonRef.current?.getBoundingClientRect();
      const contentWidth = Math.ceil(rect.width);
      const contentHeight = Math.ceil(rect.height) + 2;
      const anchorX = rect.width / 2;
      const settingsAnchorX = settingsRect
        ? settingsRect.right - rect.left
        : rect.width;
      const signature = [contentWidth, contentHeight, anchorX, settingsAnchorX]
        .map(value => Math.round(value * 2) / 2)
        .join(':');

      if (signature === lastSignature) return;
      lastSignature = signature;

      try {
        const result = await window.electron.ipcRenderer.invoke('win:resizeHeader', {
          width: contentWidth,
          height: contentHeight,
          anchorX,
          settingsAnchorX,
        });
        if (result?.ok === false) {
          lastSignature = '';
          console.warn('[EviaBar] Main process rejected live bar geometry:', result);
        }
      } catch (error) {
        lastSignature = '';
        console.warn('[EviaBar] Failed to apply live bar geometry:', error);
      }
    };

    const scheduleMeasure = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(measureAndResize);
    };

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(header);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(header, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    header.addEventListener('transitionrun', scheduleMeasure);
    header.addEventListener('transitionend', scheduleMeasure);
    void document.fonts.ready.then(() => {
      scheduleMeasure();
      settleTimers.push(window.setTimeout(scheduleMeasure, 32));
      settleTimers.push(window.setTimeout(scheduleMeasure, 120));
    });
    scheduleMeasure();

    return () => {
      disposed = true;
      observer.disconnect();
      mutationObserver.disconnect();
      header.removeEventListener('transitionrun', scheduleMeasure);
      header.removeEventListener('transitionend', scheduleMeasure);
      if (frame) window.cancelAnimationFrame(frame);
      settleTimers.forEach(timer => window.clearTimeout(timer));
    };
  }, []);

  // Remove global/header-level drag logic: dragging is now handled exclusively
  // by the right-side semicircular <DraggableHandle /> using app-region: drag.
  // No header-wide listeners are needed here.

  const toggleWindow = async (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => {
    const res = await (window as any).evia?.windows?.show?.(name);
    if (!res || !res.ok) return false;
    const visible = res.toggled === 'shown';
    if (onViewChange) onViewChange(visible ? name : null);
    return visible;
  };

  const handleListenClick = async () => {
    // Glass parity: listenService.js:56-97
    // Listen → Stop: Show window + start
    // Stop → Done: Window STAYS, show insights
    // Done → Listen: Hide window
    
    const captureApi = (window as any).evia?.captureSession;
    const current = captureSessionRef.current;
    console.log('[EviaBar] handleListenClick', {
      state: current.state,
      generation: current.generation,
      physicalCapture: isListeningRef.current,
    });

    if (startInProgressRef.current || current.state === 'starting' || current.state === 'stopping') {
      console.warn('[EviaBar] ⏭️ Ignoring duplicate Listen transition');
      return;
    }
    
    if (current.state === 'idle' || current.state === 'error') {
      startInProgressRef.current = true;
      console.log('[EviaBar] Listen → Stop: Showing listen window');
      let generation = current.generation;
      try {
        const transition: CaptureTransitionResult = await captureApi.beginStart();
        if (!transition.accepted || !transition.changed) return;
        generation = transition.snapshot.generation;

        // Hard reset stale per-session UI before showing Listen again.
        (window as any).evia?.ipc?.send?.('clear-session');
        console.log('[EviaBar] 🧹 Sent clear-session before opening Listen');

        await (window as any).evia?.windows?.ensureShown?.('listen');
        onViewChange?.('listen');

        const captureStarted = await onSetListening(true);
        if (!captureStarted) {
          await captureApi.failStart(generation, 'capture_start_returned_false');
          setIsListenActive(false);
          return;
        }

        await captureApi.confirmStarted(generation);
        setIsListenActive(true);

        // Lifecycle synchronization is best-effort. Capture truth owns the
        // button state, so a transient HTTP failure cannot invert Start/Stop.
        try {
          const eviaAuth = (window as any).evia?.auth;
          const token = await eviaAuth?.getToken?.();
          const chatId = localStorage.getItem('current_chat_id');
          const { BACKEND_URL: baseUrl } = await import('../config/config');
          if (token && chatId) {
            console.log('[EviaBar] 🎯 Calling /session/start for chat_id:', chatId);
            const response = await fetch(`${baseUrl}/session/start`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ chat_id: Number(chatId) })
            });
            if (response.ok) {
              console.log('[EviaBar] ✅ Session started:', await response.json());
            } else {
              console.warn('[EviaBar] Session start sync failed:', response.status, await response.text());
            }
          } else {
            console.warn('[EviaBar] Cannot sync /session/start: missing token or chat_id');
          }
        } catch (syncError) {
          console.warn('[EviaBar] Session start sync failed:', syncError);
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error starting listening session:', error);
        await onSetListening(false);
        await captureApi?.failStart?.(
          generation,
          error instanceof Error ? error.name || 'capture_start_exception' : 'capture_start_exception',
        );
        setIsListenActive(false);
      } finally {
        startInProgressRef.current = false;
      }

    } else if (current.state === 'recording') {
      startInProgressRef.current = true;
      console.log('[EviaBar] Stop → Done: Window stays visible');
      try {
        const transition: CaptureTransitionResult = await captureApi.beginStop();
        if (!transition.accepted || !transition.changed) return;
        const generation = transition.snapshot.generation;
        const captureStopped = await onSetListening(false);
        if (!captureStopped) {
          await captureApi.failStop(generation, 'capture_stop_returned_false');
          return;
        }

        await captureApi.confirmStopped(generation);
        setIsListenActive(false);

        // The shoot follows the production interaction model: Stop ends the
        // capture and returns to the existing Listen/Insights surface. Keep
        // this deterministic reveal isolated from every packaged build.
        const demoState = await (window as any).evia?.demo?.isEnabled?.();
        if (demoState?.enabled) {
          await (window as any).evia?.windows?.ensureShown?.('listen');
          onViewChange?.('listen');
        }

        try {
          const eviaAuth = (window as any).evia?.auth;
          const token = await eviaAuth?.getToken?.();
          const chatId = localStorage.getItem('current_chat_id');
          const { BACKEND_URL: baseUrl } = await import('../config/config');

          if (token && chatId) {
            console.log('[EviaBar] 🎯 Calling /session/pause for chat_id:', chatId);
            const response = await fetch(`${baseUrl}/session/pause`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ chat_id: Number(chatId) })
            });

            if (response.ok) {
              console.log('[EviaBar] ✅ Session paused:', await response.json());
            } else {
              console.warn('[EviaBar] Session pause sync failed:', response.status, await response.text());
            }
          } else {
            console.warn('[EviaBar] Cannot sync /session/pause: missing token or chat_id');
          }
        } catch (syncError) {
          console.warn('[EviaBar] Session pause sync failed:', syncError);
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error stopping listening session:', error);
        await captureApi?.failStop?.(
          captureSessionRef.current.generation,
          error instanceof Error ? error.name || 'capture_stop_exception' : 'capture_stop_exception',
        );
      } finally {
        startInProgressRef.current = false;
      }
    } else if (current.state === 'review') {
      // FIX #27: Done (Fertig) → Hide BOTH Listen AND Ask windows
      if (completeSessionInFlightRef.current) {
        console.warn('[EviaBar] ⏭️ Ignoring duplicate Done press while /session/complete is already running');
        return;
      }
      completeSessionInFlightRef.current = true;
      try {
        console.log('[EviaBar] Fertig pressed: Hiding listen and ask windows');
        
        // Archive asynchronously. The user-visible Done transition must not be
        // blocked by transcript draining, summary generation, or provider I/O.
        // Capture token/chat now because local session state is cleared below.
        const chatIdToArchive = localStorage.getItem('current_chat_id');
        const archiveSession = async (chatId: string | null) => {
          try {
            const eviaAuth = (window as any).evia?.auth;
            const token = await eviaAuth?.getToken?.();
            const { BACKEND_URL: baseUrl } = await import('../config/config');

            if (!token || !chatId) {
              console.warn('[EviaBar] Cannot archive session: missing token or chat_id');
              return;
            }

            console.log('[EviaBar] Calling /session/complete for chat_id:', chatId);
            const response = await fetch(`${baseUrl}/session/complete`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                chat_id: Number(chatId),
                summary: null
              })
            });

            if (!response.ok) {
              console.error('[EviaBar] Failed to archive session:', response.status, await response.text());
              return;
            }

            const data = await response.json();
            console.log('[EviaBar] Session archived:', data);
          } catch (error) {
            console.error('[EviaBar] Error archiving session:', error);
          }
        };
        void archiveSession(chatIdToArchive);
        
        await (window as any).evia?.windows?.hide?.('listen');
        await (window as any).evia?.windows?.hide?.('ask');
        // Broadcast session-closed event so Ask can clear its state
        (window as any).evia?.ipc?.send?.('session:closed');
        // Broadcast full session clear so Listen does not show previous insights/transcripts on next open.
        (window as any).evia?.ipc?.send?.('clear-session');

        // FIX #CRITICAL: Clear chat_id so next session creates NEW chat instead of reusing old one
        // This ensures each "Listen → Done" cycle creates a separate session
        localStorage.removeItem('current_chat_id');
        console.log('[EviaBar] 🗑️ Cleared chat_id from localStorage - next session will create new chat');
        
        await captureApi.complete(current.generation);
        setIsListenActive(false);
        console.log('[EviaBar] ✅ Session closed, windows hidden');
      } finally {
        completeSessionInFlightRef.current = false;
      }
    }
  };

  const handleAskClick = async () => {
    const shown = await toggleWindow('ask');
    setIsAskActive(shown);
  };

  // Glass parity: Settings hover behavior with 200ms delay (windowManager.js:291-323)
  const showSettingsWindow = () => {
    console.log('[EviaBar] showSettingsWindow called');
    // Cancel any pending hide
    if (settingsHideTimerRef.current) {
      console.log('[EviaBar] Clearing pending hide timer');
      clearTimeout(settingsHideTimerRef.current);
      settingsHideTimerRef.current = null;
    }
    
    // FIX #1: Calculate actual 3-dot button position for settings window
    // This fixes the issue where English header is narrower but settings position stays the same
    const settingsButton = settingsButtonRef.current;
    if (settingsButton) {
      const buttonRect = settingsButton.getBoundingClientRect();
      const headerRect = headerRef.current?.getBoundingClientRect();
      if (headerRect) {
        // Calculate button position relative to header
        const buttonX = buttonRect.right - headerRect.left;
        console.log('[EviaBar] Settings button right edge:', { buttonX, buttonRect, headerRect });
        // Send button position to main process
        (window as any).evia?.windows?.showSettingsWindow?.(buttonX);
        setIsSettingsActive(true);
        return;
      }
    }
    
    // Fallback: show without position (uses old calculation)
    (window as any).evia?.windows?.showSettingsWindow?.();
    setIsSettingsActive(true);
  };

  const hideSettingsWindow = () => {
    console.log('[EviaBar] hideSettingsWindow called - starting 50ms timer');
    // TASK: Reduce delay from 200ms to 50ms for more responsive hide/show (per user feedback)
    // Hide after 50ms delay (allows mouse to move to settings panel)
    if (settingsHideTimerRef.current) {
      clearTimeout(settingsHideTimerRef.current);
    }
    settingsHideTimerRef.current = setTimeout(() => {
      console.log('[EviaBar] 50ms timer expired - hiding settings');
      (window as any).evia?.windows?.hideSettingsWindow?.();
      setIsSettingsActive(false);
      settingsHideTimerRef.current = null;
    }, 50);
  };

  const handleToggleVisibility = async () => {
    await (window as any).evia?.windows?.toggleAllVisibility?.();
    onToggleVisibility?.();
  };

  const listenLabel = listenStatus === 'before' 
    ? i18n.t('overlay.header.listen') 
    : listenStatus === 'in' 
    ? i18n.t('overlay.header.stop') 
    : i18n.t('overlay.header.done');

  return (
    <div ref={headerRef} className="evia-main-header">
      {/* Listen button */}
      <button
        type="button"
        className={`evia-listen-button ${isListenActive ? 'listen-active' : ''} ${listenStatus === 'after' ? 'listen-done' : ''}`}
        onClick={handleListenClick}
        aria-busy={captureSession.state === 'starting' || captureSession.state === 'stopping'}
        data-capture-state={captureSession.state}
      >
        <span className="evia-listen-label">{listenLabel}</span>
        <span className="evia-listen-icon">
          {(isListenActive || listenStatus === 'after') ? (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="9" height="9" rx="1" fill="white" />
            </svg>
          ) : (
            <svg width="12" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.69922 2.7515C1.69922 2.37153 2.00725 2.0635 2.38722 2.0635H2.73122C3.11119 2.0635 3.41922 2.37153 3.41922 2.7515V8.2555C3.41922 8.63547 3.11119 8.9435 2.73122 8.9435H2.38722C2.00725 8.9435 1.69922 8.63547 1.69922 8.2555V2.7515Z" fill="white"/>
              <path d="M5.13922 1.3755C5.13922 0.995528 5.44725 0.6875 5.82722 0.6875H6.17122C6.55119 0.6875 6.85922 0.995528 6.85922 1.3755V9.6315C6.85922 10.0115 6.55119 10.3195 6.17122 10.3195H5.82722C5.44725 10.3195 5.13922 10.0115 5.13922 9.6315V1.3755Z" fill="white"/>
              <path d="M8.57922 3.0955C8.57922 2.71553 8.88725 2.4075 9.26722 2.4075H9.61122C9.99119 2.4075 10.2992 2.71553 10.2992 3.0955V7.9115C10.2992 8.29147 9.99119 8.5995 9.61122 8.5995H9.26722C8.88725 8.5995 8.57922 8.29147 8.57922 7.9115V3.0955Z" fill="white"/>
            </svg>
          )}
        </span>
      </button>

      {/* Ask action - WINDOWS FIX: Load shortcut dynamically like Glass MainHeader.js */}
      <div className="evia-header-actions" onClick={handleAskClick} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.ask')}</span>
        <div className="evia-shortcut-keys">
          {renderShortcutKey(shortcuts.nextStep)}
        </div>
      </div>

      {/* Show/Hide action - WINDOWS FIX: Load shortcut dynamically like Glass MainHeader.js */}
      <div className="evia-header-actions" onClick={handleToggleVisibility} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.show')}/{i18n.t('overlay.header.hide')}</span>
        <div className="evia-shortcut-keys">
          {renderShortcutKey(shortcuts.toggleVisibility)}
        </div>
      </div>

      {/* Settings button */}
      <button
        ref={settingsButtonRef}
        type="button"
        className={`evia-settings-button ${isSettingsActive ? 'active' : ''}`}
        onMouseEnter={showSettingsWindow}
        onMouseLeave={hideSettingsWindow}
        aria-label="Settings"
      >
        <svg width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="3.83" r="1" fill="white"/>
          <circle cx="8" cy="8.5" r="1" fill="white"/>
          <circle cx="8" cy="13.17" r="1" fill="white"/>
        </svg>
      </button>

      <div
        className="evia-bar-bottom-drag-region"
        aria-hidden="true"
        onPointerDown={handleBottomDragPointerDown}
        onPointerMove={handleBottomDragPointerMove}
        onPointerUp={stopBottomDrag}
        onPointerCancel={stopBottomDrag}
      />

    </div>
  );
};

export default EviaBar;
