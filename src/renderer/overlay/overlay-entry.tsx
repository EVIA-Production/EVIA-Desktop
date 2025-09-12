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
    chatIdRef.current = window.localStorage.getItem('current_chat_id') || window.localStorage.getItem('chat_id') || '1'
    const prefsToken = (window as any).evia?.prefs ? undefined : undefined
    const token = window.localStorage.getItem('auth_token')
    if (!token) return

    const httpBase = (window as any).EVIA_BACKEND_URL || window.localStorage.getItem('evia_backend') || 'http://localhost:8000'
    const wsBase = httpBase.replace(/^http/, 'ws')
    const url = `${wsBase.replace(/\/$/, '')}/ws/transcribe?chat_id=${chatIdRef.current}&token=${token}&source=mic&dg_lang=${language}`

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

  if (view === 'header') {
    const [current, setCurrent] = useState<'listen' | 'ask' | 'settings' | 'shortcuts' | null>(null)
    return (
      <div
        style={{ position: 'fixed', left: 0, top: 0, display: 'flex', gap: 12, alignItems: 'flex-start', pointerEvents: 'auto' }}
        onMouseDown={async (e) => {
          try {
            const pos = await (window as any).evia?.windows?.getHeaderPosition?.()
            const startX = e.screenX
            const startY = e.screenY
            const baseX = pos?.x ?? 0
            const baseY = pos?.y ?? 0
            const onMove = (ev: MouseEvent) => {
              const nx = baseX + (ev.screenX - startX)
              const ny = baseY + (ev.screenY - startY)
              ;(window as any).evia?.windows?.moveHeaderTo?.(nx, ny)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove, true)
              window.removeEventListener('mouseup', onUp, true)
            }
            window.addEventListener('mousemove', onMove, true)
            window.addEventListener('mouseup', onUp, true)
          } catch {}
        }}
      >
        <EviaBar
          currentView={current}
          onViewChange={(next) => setCurrent(next)}
          isListening={isListening}
          onToggleListening={() => setIsListening(v => !v)}
          language={language}
          onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')}
        />
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', left: 20, top: 80, display: 'flex', gap: 12, alignItems: 'flex-start', pointerEvents: 'auto' }}>
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


