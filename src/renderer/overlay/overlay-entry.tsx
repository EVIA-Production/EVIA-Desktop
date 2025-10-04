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
        
        // Ensure chat_id exists before starting capture
        const token = localStorage.getItem('auth_token') || ''
        const backend = (window as any).EVIA_BACKEND_URL || 'http://localhost:8000'
        
        if (!token) {
          console.error('[OverlayEntry] Missing auth token. Please login.')
          return
        }
        
        // Import getOrCreateChatId dynamically to ensure chat exists
        const { getOrCreateChatId } = await import('../services/websocketService')
        const chatId = await getOrCreateChatId(backend, token)
        console.log('[OverlayEntry] Using chat_id:', chatId)
        
        // Start audio capture (mic-only for now)
        const handle = await startCapture(false)
        captureHandleRef.current = handle
        setIsCapturing(true)
        console.log('[OverlayEntry] Audio capture started successfully')
      } else {
        // Stop capture
        console.log('[OverlayEntry] Stopping audio capture...')
        await stopCapture(captureHandleRef.current)
        captureHandleRef.current = null
        setIsCapturing(false)
        console.log('[OverlayEntry] Audio capture stopped successfully')
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