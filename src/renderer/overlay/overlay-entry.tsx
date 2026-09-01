import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortcutsView from './ShortcutsView'
import { i18n } from '../i18n/i18n'
import { startCapture, stopCapture } from '../audio-processor-glass-parity'
import { startConnectionWarmup, stopConnectionWarmup } from '../lib/connection-warmup'
import '../overlay/overlay-glass.css'
import '../overlay/liquid-glass.css'
import { getWebSocketInstance } from '../services/websocketService'
import { ToastContainer, showToast } from '../components/ToastNotification'
import { OfflineIndicator } from '../components/OfflineIndicator'
import { BACKEND_URL } from '../config/config'
import {
  beginAnalyticsCall,
  initPostHog,
  identifyUser,
  installGlobalErrorReporting,
  trackDesktopAppClosed,
  trackLanguageChanged,
  trackError,
  trackRecordingStarted,
} from '../services/posthogService'
import { bindWindowGroupFocus } from './window-group-focus'

// Before anything else in this window can throw. Every overlay view - header,
// listen, ask, settings - runs this module, so one call covers all of them, and
// it must not wait for React to mount or for initPostHog's idle callback: a
// crash during startup is precisely the crash that otherwise leaves no trace.
installGlobalErrorReporting()

// One close event per app, from the window that owns the bar.
//
// `desktop_app_launched` has fired from initPostHog since the beginning and its
// closing counterpart never fired at all, so every session in PostHog opens and
// none of them end. Session length has therefore never been measurable, and
// "how long does a rep keep Taylos open" is not a question the data could
// answer.
//
// pagehide rather than beforeunload: beforeunload does not fire reliably when
// Electron tears a window down, and a close event that misses half the closes
// is worse than none - it would bias every duration toward the sessions that
// happened to exit tidily.
if (new URLSearchParams(window.location.search).get('view') === null) {
  const appOpenedAt = Date.now()
  let closeReported = false
  window.addEventListener('pagehide', () => {
    if (closeReported) return
    closeReported = true
    trackDesktopAppClosed({
      session_duration_seconds: Math.max(0, Math.round((Date.now() - appOpenedAt) / 1000)),
      sessions_completed: Number(localStorage.getItem('taylos_calls_this_run') || 0),
    })
  })
}

// Initialize immediately after the first render has been scheduled. Waiting for
// requestIdleCallback left short open-and-test sessions completely invisible,
// while doing this after render keeps analytics off the Listen capture path.
const startAnalytics = () => { try { initPostHog() } catch { /* never block the app */ } }

type AudioStartFailureKind =
  | 'microphone_permission'
  | 'authentication'
  | 'network'
  | 'capture_start';

function classifyAudioStartFailure(error: unknown): AudioStartFailureKind {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('permission') ||
    message.includes('notallowed') ||
    message.includes('denied')
  ) {
    return 'microphone_permission';
  }
  if (
    message.includes('auth') ||
    message.includes('token') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return 'authentication';
  }
  if (
    message.includes('websocket') ||
    message.includes('network') ||
    message.includes('connect')
  ) {
    return 'network';
  }
  return 'capture_start';
}

function safeChatId(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function systemAudioWarning(
  status: string,
  language: 'de' | 'en',
): string {
  const german = language === 'de';
  switch (status) {
    case 'unsupported_os':
      return german
        ? 'Das Mikrofon hört zu. Direkte Anrufaudio-Erfassung benötigt macOS 13 oder neuer. Nutze auf macOS 12 den Lautsprecher.'
        : 'The microphone is listening. Direct call-audio capture requires macOS 13 or later. Use speaker mode on macOS 12.';
    case 'permission_denied':
      return german
        ? 'Das Mikrofon hört zu. Erlaube Taylos unter Datenschutz & Sicherheit den Zugriff auf Bildschirm- und Systemaudio.'
        : 'The microphone is listening. Allow Taylos under Privacy & Security to record screen and system audio.';
    case 'missing_binary':
    case 'invalid_audio_protocol':
      return german
        ? 'Das Mikrofon hört zu. Die Systemaudio-Komponente ist beschädigt. Installiere die aktuelle Taylos-Version neu.'
        : 'The microphone is listening. The system-audio component is damaged. Reinstall the latest Taylos version.';
    case 'socket_timeout':
    case 'socket_connection_failed':
    case 'socket_unavailable':
      return german
        ? 'Das Mikrofon hört zu. Die Verbindung für Anrufaudio ist fehlgeschlagen. Prüfe das Netzwerk und starte Zuhören neu.'
        : 'The microphone is listening. The call-audio connection failed. Check the network and restart Listen.';
    case 'capture_timeout':
    case 'spawn_failed':
    case 'capture_failed':
    default:
      return german
        ? 'Das Mikrofon hört zu, aber Anrufaudio konnte nicht gestartet werden. Starte Zuhören neu oder nutze den Lautsprecher.'
        : 'The microphone is listening, but call audio could not start. Restart Listen or use speaker mode.';
  }
}

function syncAuthTokenToLocalStorage(token: string | null, reason: string) {
  try {
    if (token) {
      localStorage.setItem('auth_token', token)
      console.log(`[OverlayEntry] 🔐 Synced auth token to localStorage (${reason})`)
      return
    }

    localStorage.removeItem('auth_token')
    localStorage.removeItem('current_chat_id')
    // Also the shared store: getOrCreateChatId falls back to main-process prefs
    // so an ACCIDENTAL key loss cannot fragment a live call across chats. A
    // logout is not accidental and must not survive in that fallback.
    try { (window as any).evia?.prefs?.set?.({ current_chat_id: null }) } catch { }
    console.log(`[OverlayEntry] 🔐 Cleared auth token + chat_id from localStorage (${reason})`)
  } catch (error) {
    console.error('[OverlayEntry] ❌ Failed to sync auth token state:', error)
  }
}

async function syncAuthTokenFromSecureStorage(reason: string): Promise<string | null> {
  try {
    const token = await (window as any).evia?.auth?.getToken?.()
    syncAuthTokenToLocalStorage(token ?? null, reason)
    return token ?? null
  } catch (error) {
    console.error('[OverlayEntry] ❌ Failed to read auth token from secure storage:', error)
    return null
  }
}

// Identify user from JWT token (if authenticated)
async function identifyUserFromToken() {
  try {
    const eviaAuth = (window as any).evia?.auth;
    const token = await eviaAuth?.getToken?.();
    
    if (token) {
      // Decode JWT to extract user info
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const username = payload.sub || payload.username || 'unknown';
        const email = payload.email;
        
        console.log('[PostHog] 🔑 Identifying user from JWT:', username);
        identifyUser(username, {
          email,
          username,
        });
      }
    } else {
      console.log('[PostHog] ⏭️ No token found, skipping user identification');
    }
  } catch (error) {
    console.error('[PostHog] ❌ Failed to identify user:', error);
  }
}

// Run identification after a short delay to ensure auth API is ready
setTimeout(async () => {
  await syncAuthTokenFromSecureStorage('initial-render')
  await identifyUserFromToken()
}, 500);

const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()
const rootEl = document.getElementById('overlay-root')

document.documentElement.dataset.material = params.get('material') || 'custom'
document.documentElement.dataset.surface = params.get('surface') || 'content'
document.documentElement.dataset.platform = params.get('platform') || 'unknown'
bindWindowGroupFocus()

// DEBUG: Entry point diagnostics (reduced to single line)
console.log('[OverlayEntry] Rendering view:', view)

// Initialize language from localStorage or default to German
const savedLanguage = i18n.getLanguage()

// DESKTOP SENTINEL: Race condition protection
let isTogglingLanguage = false;

// Language toggle function that broadcasts to all windows
const handleToggleLanguage = async (captureHandleRef: any, setIsCapturing: (val: boolean) => void) => {
  // EDGE CASE #1: Prevent rapid toggle race conditions
  if (isTogglingLanguage) {
    console.warn('[OverlayEntry] ⚠️ Language toggle already in progress, ignoring duplicate request');
    return;
  }
  
  isTogglingLanguage = true;
  
  try {
    const currentLang = i18n.getLanguage()
    const newLang = currentLang === 'de' ? 'en' : 'de'
    
    console.log('[OverlayEntry] 🌐 Language toggle started:', currentLang, '→', newLang)
    // Language is not a cosmetic setting here - it selects the prompt, the
    // preset and the guard rails, so every quality number is really a number
    // per language. Without this the two are averaged together and neither is
    // readable.
    trackLanguageChanged({ from_language: currentLang, to_language: newLang })
    
    // Stop through the same main-process lifecycle used by the Listen control.
    // Clearing only the renderer handle here previously left the public state at
    // `recording`, which made the next launch display Stop without live capture.
    const captureApi = (window as any).evia?.captureSession
    const activeHandle = captureHandleRef.current
    if (activeHandle) {
      console.log('[OverlayEntry] 🛑 Stopping audio capture before language toggle...')
      let stopGeneration: number | null = null
      try {
        let snapshot = await captureApi?.get?.()
        if (snapshot?.state === 'starting') {
          const started = await captureApi?.confirmStarted?.(snapshot.generation)
          snapshot = started?.snapshot ?? snapshot
        }
        if (snapshot?.state === 'recording') {
          const transition = await captureApi?.beginStop?.()
          if (transition && !transition.accepted) {
            throw new Error(`Capture lifecycle rejected language stop: ${transition.reason}`)
          }
          stopGeneration = transition?.snapshot?.generation ?? snapshot.generation
        } else if (snapshot?.state === 'stopping') {
          stopGeneration = snapshot.generation
        }

        await stopCapture(activeHandle)
        captureHandleRef.current = null
        setIsCapturing(false)

        if (stopGeneration !== null) {
          const stopped = await captureApi?.confirmStopped?.(stopGeneration)
          if (stopped?.snapshot?.state === 'review') {
            await captureApi?.complete?.(stopGeneration)
          } else {
            await captureApi?.reconcileNoCapture?.('language_changed')
          }
        } else {
          await captureApi?.reconcileNoCapture?.('language_changed')
        }
        
        // Notify Listen window to stop timer
        const eviaIpc = (window as any).evia?.ipc
        if (eviaIpc?.send) {
          eviaIpc.send('transcript-message', { type: 'recording_stopped' })
          console.log('[OverlayEntry] ✅ Sent recording_stopped message')
        }
      } catch (error) {
        console.error('[OverlayEntry] ❌ Error stopping audio capture:', error);
        if (stopGeneration !== null) {
          await captureApi?.failStop?.(stopGeneration, 'language_change_stop_failed')
        }
        showToast('Could not stop the current recording. Please try again.', 'error')
        return
      }
    } else {
      // A renderer reload can destroy its MediaStream while the main process is
      // still alive. Reconcile that stale state before changing language.
      await captureApi?.reconcileNoCapture?.('language_changed')
    }
  
  // BACKEND INTEGRATION: Send language change command via WebSocket
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
  
  // FIX ISSUE #4: Clear session state in ListenView (transcripts, insights, timer)
  const eviaIpc = (window as any).evia?.ipc
  if (eviaIpc?.send) {
    eviaIpc.send('clear-session')
    console.log('[OverlayEntry] ✅ Sent clear-session message to ListenView')
    
    // EDGE CASE #6: Abort streaming in Ask window if active
    eviaIpc.send('abort-ask-stream')
    console.log('[OverlayEntry] ✅ Sent abort-ask-stream message to AskView')
  }
  
  // CRITICAL: Clear current_chat_id to force new chat creation with new language
  // When user presses "Listen" or "Ask" next, a new chat will be created with the new language
  const oldChatId = localStorage.getItem('current_chat_id');
  if (oldChatId) {
    localStorage.removeItem('current_chat_id');
    // Deliberate: a language switch must start a new chat, so the shared
    // prefs fallback has to be cleared too or the old chat would be adopted.
    try { (window as any).evia?.prefs?.set?.({ current_chat_id: null }) } catch { }
    console.log(`[OverlayEntry] 🧹 Cleared chat_id ${oldChatId} to force new chat with new language: ${newLang}`);
  }
  
  // FIX: Close all child windows except Settings
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
  
  // Commit the language change immediately. The old one-second collapse/expand
  // animation hid the bar while every attached window was trying to follow its
  // transient geometry, which caused visible lag and stale anchoring.
  i18n.setLanguage(newLang)
  const languageIpc = (window as any).evia?.ipc
  languageIpc?.send?.('language-changed', newLang)
  window.dispatchEvent(new CustomEvent('evia-language-changed', {
    detail: { language: newLang },
  }))
  console.log('[OverlayEntry] ✅ Language changed immediately:', newLang)
  } catch (error) {
    // EDGE CASE #4: Error during toggle - log and recover gracefully
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
    // EDGE CASE #5: Always release lock, even if error occurred
    isTogglingLanguage = false;
    console.log('[OverlayEntry] 🔓 Language toggle lock released');
  }
}

function App() {
  const [language, setLanguage] = useState<'de' | 'en'>(savedLanguage as 'de' | 'en')
  const [isCapturing, setIsCapturing] = useState(false)
  const captureHandleRef = useRef<any>(null)

  // REACTIVE I18N: Listen for language changes (local window event)
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

  // REACTIVE I18N: Listen for language changes from OTHER windows via IPC
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

    // The renderer owns the getUserMedia track, so only it can release the
    // microphone. Logging out used to leave that track live: the capture
    // controller's reset() flips an in-memory snapshot and nothing downstream
    // touched the hardware, so a logged-out Taylos kept recording both sides of
    // the call. The main process now demands a stop and this is where it lands.
    const handleForceStopCapture = async (payload?: { reason?: string }) => {
      const reason = payload?.reason || 'unknown'
      console.log(`[OverlayEntry] 🛑 Force-stopping capture (${reason})`)
      stopConnectionWarmup()
      try {
        await stopCapture(captureHandleRef.current ?? undefined)
      } catch (error) {
        console.error('[OverlayEntry] Force-stop failed to release capture:', error)
      } finally {
        // Cleared even if stopCapture threw: a stale handle would make the next
        // start believe capture is already running and skip acquiring the mic.
        captureHandleRef.current = null
        setIsCapturing(false)
      }
    }

    eviaIpc.on('language-changed', handleCrossWindowLanguageChange)
    eviaIpc.on('capture:force-stop', handleForceStopCapture)
    console.log('[OverlayEntry] ✅ Registered cross-window language listener')

    return () => {
      eviaIpc.off?.('language-changed', handleCrossWindowLanguageChange)
      eviaIpc.off?.('capture:force-stop', handleForceStopCapture)
      console.log('[OverlayEntry] 🧹 Cleaned up language listener')
    }
  }, [])

  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc
    if (!eviaIpc?.on) {
      void syncAuthTokenFromSecureStorage('mount-without-ipc-listener')
      return
    }

    const handleAuthTokenChanged = async (payload?: { token?: string | null; authenticated?: boolean }) => {
      if (payload && payload.authenticated === false) {
        syncAuthTokenToLocalStorage(null, 'auth-token-changed')
        return
      }

      if (payload && Object.prototype.hasOwnProperty.call(payload, 'token')) {
        syncAuthTokenToLocalStorage(payload.token ?? null, 'auth-token-changed')
      } else {
        await syncAuthTokenFromSecureStorage('auth-token-changed-fallback')
      }

      await identifyUserFromToken()
    }

    eviaIpc.on('auth-token-changed', handleAuthTokenChanged)
    void syncAuthTokenFromSecureStorage('mount')

    return () => {
      eviaIpc.off('auth-token-changed', handleAuthTokenChanged)
    }
  }, [])

  // UI IMPROVEMENT: Proactive authentication validation
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
          syncAuthTokenToLocalStorage(null, 'validate-auth-failed')
          console.log('[OverlayEntry] ⚠️ Auth validation failed - returning to welcome');
        } else {
          await syncAuthTokenFromSecureStorage('validate-auth-success')
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
    void handleToggleLanguage(captureHandleRef, setIsCapturing)
  }

  const handleSetListening = async (enabled: boolean): Promise<boolean> => {
    try {
      if (enabled) {
        if (captureHandleRef.current) {
          setIsCapturing(true)
          return true
        }

        // Latency: use the local JWT-expiry check (no network round-trip) instead of
        // the server validate() call. Catches missing/expired tokens instantly; an
        // otherwise-invalid token still fails fast at websocket connect.
        console.log('[OverlayEntry] 🔐 Checking token validity (local) before starting session...');
        const eviaAuth = (window as any).evia?.auth;
        if (eviaAuth?.checkTokenValidity) {
          let tokenStatus = await eviaAuth.checkTokenValidity();
          // A token that lapses mid-call costs the seller the call. Renewing
          // here is cheap and turns "expiring_soon" into a non-event instead
          // of a login prompt thirty seconds into a conversation.
          if (tokenStatus?.reason === 'expiring_soon' || tokenStatus?.valid === false) {
            const renewed = await eviaAuth.refresh?.();
            if (renewed?.ok) {
              tokenStatus = await eviaAuth.checkTokenValidity();
              console.log('[OverlayEntry] 🔄 Session renewed before session start');
            }
          }
          if (!tokenStatus || tokenStatus.valid === false) {
            console.error('[OverlayEntry] ❌ Token invalid/expired - cannot start session:', tokenStatus?.reason);
            showToast('Please login to start recording', 'error');
            return false;
          }
          console.log('[OverlayEntry] ✅ Token valid (local check) - proceeding with session start');
        }

        // Start capture
        console.log('[OverlayEntry] Starting audio capture...')
        
        // Get auth token from keytar (secure credential storage)
        console.log('[OverlayEntry] 🔍 Getting auth token from keytar...')
        const token = await (window as any).evia?.auth?.getToken?.()
        const backend = BACKEND_URL
        // Before anything slow: the handshake costs ~530ms from far away and
        // is otherwise paid by the seller's first suggestion, mid-call.
        startConnectionWarmup(backend)
        
        if (!token) {
          console.error('[OverlayEntry] ❌ No auth token found - user must login first')
          console.error('[OverlayEntry] Run this in DevTools: await window.evia.auth.login("admin", "your-password")')
          showToast('No authentication token found', 'error');
          return false
        }
        
        console.log('[OverlayEntry] ✅ Got auth token (length:', token.length, 'chars)')
        
        // Import getOrCreateChatId dynamically to ensure chat exists
        const { getOrCreateChatId } = await import('../services/websocketService')
        const chatId = await getOrCreateChatId(backend, token)
        console.log('[OverlayEntry] Using chat_id:', chatId)
        
        // Start audio capture (mic + system audio for meeting transcription)
        console.log('[OverlayEntry] Starting audio capture...');
        const handle = await startCapture(true)
        captureHandleRef.current = handle
        setIsCapturing(true)
        console.log('[OverlayEntry] ✅ Audio capture started')

        const analyticsCallId = beginAnalyticsCall()
        trackRecordingStarted({
          source: handle.systemAudioAvailable ? 'both' : 'mic',
          language,
          system_audio_available: handle.systemAudioAvailable,
          system_audio_status: handle.systemAudioStatus,
        })

        if (!handle.systemAudioAvailable) {
          const warning = systemAudioWarning(handle.systemAudioStatus, language);
          showToast(warning, 'warning');
          trackError({
            error_type: 'system_audio_degraded',
            error_message: handle.systemAudioStatus,
            chat_id: safeChatId(localStorage.getItem('current_chat_id')),
            context: 'capture_start_mic_continues',
          });
        }
        
        // Notify Listen window to start timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('transcript-message', {
              type: 'recording_started',
              analyticsCallId,
              source: handle.systemAudioAvailable ? 'both' : 'mic',
              systemAudioAvailable: handle.systemAudioAvailable,
            });
            console.log('[OverlayEntry] Sent recording_started message to Listen window');
          }
        } catch (error) {
          console.error('[OverlayEntry] Failed to send recording_started:', error);
        }
        return true
      } else {
        const activeHandle = captureHandleRef.current
        if (!activeHandle) {
          setIsCapturing(false)
          return true
        }

        // Stop capture
        console.log('[OverlayEntry] Stopping audio capture...')
        await stopCapture(activeHandle)
        captureHandleRef.current = null
        setIsCapturing(false)
        console.log('[OverlayEntry] Audio capture stopped successfully')
        
        // FIX: Notify Listen window to stop timer
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('transcript-message', { type: 'recording_stopped' });
            console.log('[OverlayEntry] Sent recording_stopped message to Listen window');
          }
        } catch (error) {
          console.error('[OverlayEntry] Failed to send recording_stopped:', error);
        }
        return true
      }
    } catch (error) {
      console.error('[OverlayEntry] Error setting audio capture state:', error)
      const diagnostic = error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
        : String(error)
      try {
        ;(window as any).evia?.ipc?.send?.(
          'debug-log',
          `[AudioCapture] STARTUP FAILURE: ${diagnostic}`,
        )
      } catch {
        // Diagnostics must never mask the original startup failure.
      }
      // startCapture mutates module-level audio resources as it progresses. If
      // a later permission, socket, or system-audio step fails, release any
      // resources that were already acquired before allowing another start.
      try {
        await stopCapture(captureHandleRef.current ?? undefined)
      } catch (cleanupError) {
        console.warn('[OverlayEntry] Failed to fully clean up partial audio capture:', cleanupError)
      }
      const failureKind = classifyAudioStartFailure(error);
      const errorMessage = language === 'de'
        ? {
            microphone_permission: 'Taylos braucht Mikrofonzugriff. Erlaube ihn in den Systemeinstellungen und versuche es erneut.',
            authentication: 'Deine Anmeldung ist abgelaufen. Öffne Taylos erneut und melde dich an.',
            network: 'Taylos konnte keine sichere Verbindung herstellen. Prüfe das Internet und versuche es erneut.',
            capture_start: 'Das Zuhören konnte nicht gestartet werden. Starte Taylos neu und versuche es erneut.',
          }[failureKind]
        : {
            microphone_permission: 'Taylos needs microphone access. Allow it in System Settings and try again.',
            authentication: 'Your sign-in expired. Reopen Taylos and sign in again.',
            network: 'Taylos could not establish a secure connection. Check your internet and try again.',
            capture_start: 'Listening could not start. Restart Taylos and try again.',
          }[failureKind];
      showToast(errorMessage, 'error');
      trackError({
        error_type: failureKind,
        error_message: failureKind,
        chat_id: safeChatId(localStorage.getItem('current_chat_id')),
        context: 'capture_start_failed',
      });
      // Reset state on error
      captureHandleRef.current = null
      setIsCapturing(false)
      return false
    }
  }

  switch (view) {
    case 'header':
      return (
        <>
          <ToastContainer position="top-right" />
          <OfflineIndicator />
          <EviaBar
            currentView={null}
            onViewChange={() => {}}
            isListening={isCapturing}
            onSetListening={handleSetListening}
            language={language}
            onToggleLanguage={toggleLanguage}
          />
        </>
      )
    case 'listen':
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
          onSetListening={async () => true}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      )
  }
}

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  root.render(<App />)
  startAnalytics()
}
