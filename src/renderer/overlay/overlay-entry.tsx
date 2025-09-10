import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../overlay/overlay-tokens.css'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortCutSettingsView from './ShortCutSettingsView'

type View = 'header' | 'listen' | 'ask' | 'settings' | 'shortcuts' | null

const OverlayApp: React.FC = () => {
  const [view, setView] = useState<View>(() => {
    const qp = new URLSearchParams(window.location.search)
    const v = (qp.get('view') as View) || 'listen'
    return v
  })
  const [isListening, setIsListening] = useState(false)
  const [language, setLanguage] = useState<'de' | 'en'>('de')
  const [followLive, setFollowLive] = useState(true)
  const [lines, setLines] = useState<{ speaker: number | null, text: string, isFinal?: boolean }[]>([])
  const chatIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Read chat id + token from localStorage (temporary dev wiring)
    chatIdRef.current = window.localStorage.getItem('chat_id') || '1'
    const token = window.localStorage.getItem('auth_token')
    if (!token) return

    // Build WS URL; default to mic for visible transcripts
    const base = (window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + (new URL(window.location.href)).host
    // If backend URL is configured elsewhere, prefer it; else use current host for dev proxy
    const backend = (window as any).EVIA_BACKEND_WS || undefined
    const host = backend || base
    const url = `${host}/ws/transcribe?chat_id=${chatIdRef.current}&token=${token}&source=mic&dg_lang=${language}`

    let handle: any | null = null
    try {
      const w: any = window as any
      if (w.evia && typeof w.evia.createWs === 'function') {
        handle = w.evia.createWs(url)
        handle.onMessage((data: any) => {
          try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data
            if (msg && msg.type === 'transcript_segment' && msg.data) {
              const d = msg.data as any
              setLines(prev => [...prev, { speaker: typeof d.speaker === 'number' ? d.speaker : null, text: String(d.text || ''), isFinal: !!d.is_final }])
            }
          } catch { /* ignore */ }
        })
      }
    } catch { /* ignore */ }

    return () => { try { handle?.close?.() } catch {} }
  }, [language])

  return (
    <div
      style={{ position: 'fixed', left: 20, top: view === 'header' ? 20 : 80, display: 'flex', gap: 12, alignItems: 'flex-start', pointerEvents: 'none' }}
      onMouseEnter={() => { try { (window as any).evia?.overlay?.setClickThrough(false) } catch {} }}
      onMouseLeave={() => { try { (window as any).evia?.overlay?.setClickThrough(true) } catch {} }}
    >
      {view === 'header' ? (
        <EviaBar
          currentView={'listen'}
          onViewChange={(next) => {
            if (next === 'listen' || next === 'ask' || next === 'settings' || next === 'shortcuts') {
              // ask main process to show the window
              try { (window as any).electron?.ipcRenderer?.invoke('win:show', next) } catch {}
            }
          }}
          isListening={isListening}
          onToggleListening={() => setIsListening(v => !v)}
          language={language}
          onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')}
        />
      ) : (
        <EviaBar
          currentView={view}
          onViewChange={setView}
          isListening={isListening}
          onToggleListening={() => setIsListening(v => !v)}
          language={language}
          onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')}
        />
      )}

      {view === 'listen' && (
        <ListenView
          lines={lines}
          followLive={followLive}
          onToggleFollow={() => setFollowLive(v => !v)}
        />
      )}
      {view === 'ask' && (
        <AskView language={language} />
      )}
      {view === 'settings' && (
        <SettingsView language={language} onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')} />
      )}
      {view === 'shortcuts' && (
        <ShortCutSettingsView />
      )}
    </div>
  )
}

const mount = () => {
  const el = document.getElementById('overlay-root')
  if (!el) return
  const root = createRoot(el)
  root.render(<OverlayApp />)
}

mount()


