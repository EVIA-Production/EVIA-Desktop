import React, { useState, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortCutSettingsView from './ShortCutSettingsView'
import { i18n } from '../i18n/i18n'
import { startCapture, stopCapture } from '../audio-processor-glass-parity'
import '../overlay/overlay-glass.css'

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

// Language toggle function that broadcasts to all windows
const handleToggleLanguage = () => {
  const currentLang = i18n.getLanguage()
  const newLang = currentLang === 'de' ? 'en' : 'de'
  i18n.setLanguage(newLang)
  
  // Broadcast language change to all windows via IPC
  if (window.evia?.ipc) {
    window.evia.ipc.send('language-changed', newLang)
  }
  
  // Reload current window to apply new language
  window.location.reload()
}

function App() {
  const [language, setLanguage] = useState<'de' | 'en'>(savedLanguage as 'de' | 'en')
  const [isCapturing, setIsCapturing] = useState(false)
  const captureHandleRef = useRef<any>(null)

  const toggleLanguage = () => {
    handleToggleLanguage()
  }

  const handleToggleListening = async () => {
    try {
      if (!isCapturing) {
        // Start capture
        console.log('[OverlayEntry] Starting audio capture...')
        
        // 🔧 Get auth token from keytar (secure credential storage)
        console.log('[OverlayEntry] 🔍 Getting auth token from keytar...')
        const token = await (window as any).evia?.auth?.getToken?.()
        const backend = (window as any).EVIA_BACKEND_URL || 'http://localhost:8000'
        
        if (!token) {
          console.error('[OverlayEntry] ❌ No auth token found - user must login first')
          console.error('[OverlayEntry] Run this in DevTools: await window.evia.auth.login("admin", "your-password")')
          return
        }
        
        console.log('[OverlayEntry] ✅ Got auth token (length:', token.length, 'chars)')
        
        // Import getOrCreateChatId dynamically to ensure chat exists
        const { getOrCreateChatId } = await import('../services/websocketService')
        const chatId = await getOrCreateChatId(backend, token)
        console.log('[OverlayEntry] Using chat_id:', chatId)
        
        // Start audio capture (mic + system audio for meeting transcription)
        console.log('[OverlayEntry] Starting dual capture (mic + system audio)...')
        const handle = await startCapture(true) // Enable system audio for speaker diarization
        captureHandleRef.current = handle
        setIsCapturing(true)
        console.log('[OverlayEntry] Audio capture started successfully (mic + system)')
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
      // Reset state on error
      captureHandleRef.current = null
      setIsCapturing(false)
    }
  }

  switch (view) {
    case 'header':
      console.log('[OverlayEntry] 🔍 Rendering HEADER view')
      return (
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={isCapturing}
          onToggleListening={handleToggleListening}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      )
    case 'listen':
      console.log('[OverlayEntry] 🔍 Rendering LISTEN view - about to create ListenView component')
      console.log('[OverlayEntry] 🔍 ListenView imported:', typeof ListenView)
      return (
        <ListenView
          lines={[]}
          followLive={true}
          onToggleFollow={() => {}}
          onClose={() => window.evia.closeWindow('listen')}
        />
      )
    case 'ask':
      return <AskView language={language} />
    case 'settings':
      return <SettingsView language={language} onToggleLanguage={toggleLanguage} />
    case 'shortcuts':
      return <ShortCutSettingsView />
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