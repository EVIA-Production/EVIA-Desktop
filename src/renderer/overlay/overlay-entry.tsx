import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortcutsView from './ShortcutsView'
import { i18n } from '../i18n/i18n'
import { startCapture, stopCapture } from '../audio-processor-glass-parity'
import '../overlay/overlay-glass.css'
import { getWebSocketInstance } from '../services/websocketService'
import { ToastContainer, showToast } from '../components/ToastNotification'
import { OfflineIndicator } from '../components/OfflineIndicator'
import { BACKEND_URL } from '../config/config'

const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()
const rootEl = document.getElementById('overlay-root')

// 🔍 DIAGNOSTIC: Entry point execution
console.log('[OverlayEntry] 🔍 ENTRY POINT EXECUTING')
console.log('[OverlayEntry] 🔍 URL:', window.location.href)
console.log('[OverlayEntry] 🔍 Search params:', window.location.search)
console.log('[OverlayEntry] 🔍 View param:', view)
console.log('[OverlayEntry] 🔍 rootEl exists:', !!rootEl)

// Initialize language from localStorage or default to German
const savedLanguage = i18n.getLanguage()

// 🔧 DESKTOP SENTINEL: Race condition protection
let isTogglingLanguage = false;

// Language toggle function that broadcasts to all windows
const handleToggleLanguage = async (captureHandleRef: any, isCapturing: boolean, setIsCapturing: (val: boolean) => void) => {
  // 🔧 EDGE CASE #1: Prevent rapid toggle race conditions
  if (isTogglingLanguage) {
    console.warn('[OverlayEntry] ⚠️ Language toggle already in progress, ignoring duplicate request');
    return;
  }
  
  isTogglingLanguage = true;
  
  try {
    const currentLang = i18n.getLanguage()
    const newLang = currentLang === 'de' ? 'en' : 'de'
    
    console.log('[OverlayEntry] 🌐 Language toggle started:', currentLang, '→', newLang)
    
    // 🔧 EDGE CASE #2: Stop audio capture first (graceful close of active session)
    if (isCapturing && captureHandleRef.current) {
      console.log('[OverlayEntry] 🛑 Stopping audio capture before language toggle...')
      try {
        await stopCapture(captureHandleRef.current)
        captureHandleRef.current = null
        setIsCapturing(false)
        
        // Notify Listen window to stop timer
        const eviaIpc = (window as any).evia?.ipc
        if (eviaIpc?.send) {
          eviaIpc.send('transcript-message', { type: 'recording_stopped' })
          console.log('[OverlayEntry] ✅ Sent recording_stopped message')
        }
      } catch (error) {
        console.error('[OverlayEntry] ❌ Error stopping audio capture:', error);
        // Continue with toggle even if stop fails
      }
    }
  
  // 🔧 BACKEND INTEGRATION: Send language change command via WebSocket
  try {
    const chatId = localStorage.getItem('current_chat_id');
    if (chatId) {
      console.log('[OverlayEntry] 📡 Sending language change command to backend:', newLang);
      const micWs = getWebSocketInstance(chatId, 'mic');
      micWs.sendMessage({ command: 'change_language', language: newLang });
      console.log('[OverlayEntry] ✅ Language change command sent to backend');
    } else {
      console.warn('[OverlayEntry] ⚠️ No chat_id available, skipping backend language update');
    }
  } catch (error) {
    console.error('[OverlayEntry] ❌ Error sending language change to backend:', error);
    // Continue with toggle even if backend command fails
  }
  
  // 🔧 FIX ISSUE #4: Clear session state in ListenView (transcripts, insights, timer)
  const eviaIpc = (window as any).evia?.ipc
  if (eviaIpc?.send) {
    eviaIpc.send('clear-session')
    console.log('[OverlayEntry] ✅ Sent clear-session message to ListenView')
    
    // 🔧 EDGE CASE #6: Abort streaming in Ask window if active
    eviaIpc.send('abort-ask-stream')
    console.log('[OverlayEntry] ✅ Sent abort-ask-stream message to AskView')
  }
  
  // 🔧 FIX: Close all child windows except Settings
  const eviaWindows = (window as any).evia?.windows
  if (eviaWindows) {
    console.log('[OverlayEntry] Closing child windows (keeping Settings open)...')
    try {
      await eviaWindows.hide('listen')
      await eviaWindows.hide('ask')
      // Keep Settings open - user is toggling from Settings window
    } catch (error) {
      console.error('[OverlayEntry] ❌ Error closing windows:', error);
      // Continue even if windows fail to close
    }
  }
  
  // 🔧 SINGULARITY ANIMATION: Shrink header to point, then expand with new language
  const headerElement = document.querySelector('.evia-main-header') as HTMLElement
  if (headerElement) {
    console.log('[OverlayEntry] 🌀 Starting singularity animation...')
    
    // Phase 1: Compress to singularity (500ms)
    headerElement.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease'
    headerElement.style.transform = 'scale(0.01)'
    headerElement.style.opacity = '0'
    
    // Wait for compression to complete
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Update language (happens at singularity point)
    i18n.setLanguage(newLang)
    
    // 🔧 REACTIVE I18N: Broadcast to all windows
    const eviaIpc = (window as any).evia?.ipc
    if (eviaIpc) {
      eviaIpc.send('language-changed', newLang)
    }
    
    // Trigger local re-render
    window.dispatchEvent(new CustomEvent('evia-language-changed', { detail: { language: newLang } }))
    
    // Small delay for language to update in DOM
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Phase 2: Expand from singularity (500ms)
    headerElement.style.transform = 'scale(1)'
    headerElement.style.opacity = '1'
    
    // Wait for expansion to complete
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Reset transition for normal animations
    headerElement.style.transition = ''
    
    console.log('[OverlayEntry] ✅ Singularity animation complete, language:', newLang)
  } else {
    // 🔧 EDGE CASE #3: Fallback if header element not found
    console.warn('[OverlayEntry] ⚠️ Header element not found, performing instant language toggle');
    i18n.setLanguage(newLang)
    const eviaIpc = (window as any).evia?.ipc
    if (eviaIpc) {
      eviaIpc.send('language-changed', newLang)
    }
    window.dispatchEvent(new CustomEvent('evia-language-changed', { detail: { language: newLang } }))
  }
  } catch (error) {
    // 🔧 EDGE CASE #4: Error during toggle - log and recover gracefully
    console.error('[OverlayEntry] ❌ Error during language toggle:', error);
    // Attempt basic language change even if animation fails
    try {
      const currentLang = i18n.getLanguage()
      const newLang = currentLang === 'de' ? 'en' : 'de'
      i18n.setLanguage(newLang)
      console.log('[OverlayEntry] ⚠️ Basic language toggle completed despite error');
    } catch (recoveryError) {
      console.error('[OverlayEntry] ❌ Failed to recover from toggle error:', recoveryError);
    }
  } finally {
    // 🔧 EDGE CASE #5: Always release lock, even if error occurred
    isTogglingLanguage = false;
    console.log('[OverlayEntry] 🔓 Language toggle lock released');
  }
}

function App() {
  const [language, setLanguage] = useState<'de' | 'en'>(savedLanguage as 'de' | 'en')
  const [isCapturing, setIsCapturing] = useState(false)
  const captureHandleRef = useRef<any>(null)

  // 🔧 REACTIVE I18N: Listen for language changes (local window event)
  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ language: 'de' | 'en' }>
      const newLang = customEvent.detail.language
      console.log('[OverlayEntry] 🌐 Language changed:', newLang)
      setLanguage(newLang)
    }
    window.addEventListener('evia-language-changed', handleLanguageChange)
    return () => window.removeEventListener('evia-language-changed', handleLanguageChange)
  }, [])

  // 🔧 REACTIVE I18N: Listen for language changes from OTHER windows via IPC
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc
    if (!eviaIpc) {
      console.warn('[OverlayEntry] IPC not available for cross-window language sync')
      return
    }

    const handleCrossWindowLanguageChange = (newLang: 'de' | 'en') => {
      console.log('[OverlayEntry] 🌐 Language changed from other window:', newLang)
      i18n.setLanguage(newLang)
      setLanguage(newLang)
      // Trigger local event to update all components in THIS window
      window.dispatchEvent(new CustomEvent('evia-language-changed', { detail: { language: newLang } }))
    }

    eviaIpc.on('language-changed', handleCrossWindowLanguageChange)
    console.log('[OverlayEntry] ✅ Registered cross-window language listener')
    
    return () => {
      console.log('[OverlayEntry] 🧹 Cleaning up language listener')
    }
  }, [])

  // 🔧 UI IMPROVEMENT: Proactive authentication validation
  // Validates auth status periodically and before critical actions
  // If not authenticated, main process will hide header and show welcome window
  useEffect(() => {
    const eviaAuth = (window as any).evia?.auth;
    if (!eviaAuth?.validate) {
      console.warn('[OverlayEntry] ⚠️ Auth validation not available');
      return;
    }

    // Validate auth immediately on mount
    const validateAuth = async () => {
      try {
        const result = await eviaAuth.validate();
        if (result && !result.authenticated) {
          console.log('[OverlayEntry] ⚠️ Auth validation failed - returning to welcome');
        } else {
          console.log('[OverlayEntry] ✅ Auth validation passed');
        }
      } catch (error) {
        console.error('[OverlayEntry] ❌ Auth validation error:', error);
      }
    };

    // Validate immediately
    validateAuth();

    // Validate every 5 minutes (proactive checks)
    const intervalId = setInterval(() => {
      console.log('[OverlayEntry] 🔐 Periodic auth validation...');
      validateAuth();
    }, 5 * 60 * 1000);  // 5 minutes

    // Validate when window gains focus (user returns to app)
    const handleFocus = () => {
      console.log('[OverlayEntry] 🔐 App focused - validating auth...');
      validateAuth();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [])

  const toggleLanguage = () => {
    handleToggleLanguage(captureHandleRef, isCapturing, setIsCapturing)
  }

  const handleToggleListening = async () => {
    try {
      if (!isCapturing) {
        // 🔧 UI IMPROVEMENT: Validate auth before starting session
        console.log('[OverlayEntry] 🔐 Validating auth before starting session...');
        const eviaAuth = (window as any).evia?.auth;
        if (eviaAuth?.validate) {
          const authResult = await eviaAuth.validate();
          if (!authResult || !authResult.authenticated) {
            console.error('[OverlayEntry] ❌ Auth validation failed - cannot start session');
            showToast('Please login to start recording', 'error');
            return;
          }
          console.log('[OverlayEntry] ✅ Auth validated - proceeding with session start');
        }

        // Start capture
        console.log('[OverlayEntry] Starting audio capture...')
        
        // 🔧 Get auth token from keytar (secure credential storage)
        console.log('[OverlayEntry] 🔍 Getting auth token from keytar...')
        const token = await (window as any).evia?.auth?.getToken?.()
        const backend = BACKEND_URL
        
        if (!token) {
          console.error('[OverlayEntry] ❌ No auth token found - user must login first')
          console.error('[OverlayEntry] Run this in DevTools: await window.evia.auth.login("admin", "your-password")')
          showToast('No authentication token found', 'error');
          return
        }
        
        console.log('[OverlayEntry] ✅ Got auth token (length:', token.length, 'chars)')
        
        // Import getOrCreateChatId dynamically to ensure chat exists
        const { getOrCreateChatId } = await import('../services/websocketService')
        const chatId = await getOrCreateChatId(backend, token)
        console.log('[OverlayEntry] Using chat_id:', chatId)
        
        // Start audio capture (mic + system audio for meeting transcription)
        // 🔥🔥🔥 ULTRA-CRITICAL DIAGNOSTIC: Force visible output
        console.error('[OverlayEntry] ═══════════════════════════════════');
        console.error('[OverlayEntry] 🚀 ABOUT TO CALL startCapture()');
        console.error('[OverlayEntry] ═══════════════════════════════════');
        console.error('[OverlayEntry] startCapture type:', typeof startCapture);
        console.error('[OverlayEntry] startCapture function:', startCapture);
        
        // Test IPC before calling startCapture
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', '🔥🔥🔥 HEADER: About to call startCapture()');
          console.error('[OverlayEntry] ✅ IPC send successful');
        } else {
          console.error('[OverlayEntry] ❌ IPC NOT AVAILABLE!');
        }
        
        // Call startCapture with try/catch to see any errors
        try {
          console.error('[OverlayEntry] Calling startCapture(true)...');
          const handle = await startCapture(true)
          console.error('[OverlayEntry] ✅ startCapture returned:', handle);
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '✅ HEADER: startCapture completed successfully');
          }
        } catch (error) {
          console.error('[OverlayEntry] ❌ startCapture FAILED:', error);
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `❌ HEADER: startCapture FAILED: ${error}`);
          }
          throw error; // Re-throw so user sees error
        }
        
        const handle = { success: true } // Placeholder since we already called startCapture above
        captureHandleRef.current = handle
        setIsCapturing(true)
        console.log('[OverlayEntry] ✅ Audio capture started successfully (mic + system)')
        
        // 🔧 CRITICAL: Forward success to Ask console
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '[OverlayEntry] ✅ Audio capture started successfully');
          }
        } catch (e) {
          console.error('[OverlayEntry] ❌ Failed to send success debug-log:', e);
        }
        
        // 🔧 FIX: Notify Listen window to start timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('transcript-message', { type: 'recording_started' });
            console.log('[OverlayEntry] Sent recording_started message to Listen window');
          }
        } catch (error) {
          console.error('[OverlayEntry] Failed to send recording_started:', error);
        }
      } else {
        // Stop capture
        console.log('[OverlayEntry] Stopping audio capture...')
        await stopCapture(captureHandleRef.current)
        captureHandleRef.current = null
        setIsCapturing(false)
        console.log('[OverlayEntry] Audio capture stopped successfully')
        
        // 🔧 FIX: Notify Listen window to stop timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('transcript-message', { type: 'recording_stopped' });
            console.log('[OverlayEntry] Sent recording_stopped message to Listen window');
          }
        } catch (error) {
          console.error('[OverlayEntry] Failed to send recording_stopped:', error);
        }
      }
    } catch (error) {
      console.error('[OverlayEntry] Error toggling audio capture:', error)
      showToast(`Audio capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      // Reset state on error
      captureHandleRef.current = null
      setIsCapturing(false)
    }
  }

  switch (view) {
    case 'header':
      console.log('[OverlayEntry] 🔍 Rendering HEADER view')
      return (
        <>
          <ToastContainer position="top-right" />
          <OfflineIndicator />
          <EviaBar
            currentView={null}
            onViewChange={() => {}}
            isListening={isCapturing}
            onToggleListening={handleToggleListening}
            language={language}
            onToggleLanguage={toggleLanguage}
          />
        </>
      )
    case 'listen':
      console.log('[OverlayEntry] 🔍 Rendering LISTEN view - about to create ListenView component')
      console.log('[OverlayEntry] 🔍 ListenView imported:', typeof ListenView)
      return (
        <>
          <ToastContainer position="top-right" />
          <ListenView
            lines={[]}
            followLive={true}
            onToggleFollow={() => {}}
            onClose={() => (window as any).evia?.closeWindow?.('listen')}
          />
        </>
      )
    case 'ask':
      return (
        <>
          <ToastContainer position="top-right" />
          <AskView language={language} />
        </>
      )
    case 'settings':
      return (
        <>
          <ToastContainer position="top-right" />
          <SettingsView language={language} onToggleLanguage={toggleLanguage} />
        </>
      )
    case 'shortcuts':
      return (
        <>
          <ToastContainer position="top-right" />
          <ShortcutsView language={language} />
        </>
      )
    default:
      return (
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      )
  }
}

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  root.render(<App />)
}