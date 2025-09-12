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
  const [storageTick, setStorageTick] = useState(0)

  useEffect(() => {
    // Only connect WS in the listen window
    const qp = new URLSearchParams(window.location.search)
    const currentView = (qp.get('view') as View) || 'listen'
    if (currentView !== 'listen') return

    const cid = window.localStorage.getItem('current_chat_id') || null
    if (!cid) {
      console.warn('[overlay] No current_chat_id; skipping WS connect')
      return
    }
    chatIdRef.current = cid

    // Wrap async logic
    let handle: any | null = null
    ;(async () => {
      // Prefer prefs JWT; fallback to localStorage
      let token: string | null = null
      try {
        const resp = await (window as any).evia?.prefs?.get?.()
        const fromPrefs = resp?.prefs?.auth_token
        token = fromPrefs || window.localStorage.getItem('auth_token')
      } catch {
        token = window.localStorage.getItem('auth_token')
      }
      if (!token) { console.warn('[overlay] No auth token; skipping WS connect'); return }

      const httpBase = (window as any).EVIA_BACKEND_URL || window.localStorage.getItem('evia_backend') || 'http://localhost:8000'
      const wsBase = httpBase.replace(/^http/, 'ws')
      const url = `${wsBase.replace(/\/$/, '')}/ws/transcribe?chat_id=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}&source=mic&dg_lang=${language}`

      try {
        const w: any = window as any
        if (w.evia && typeof w.evia.createWs === 'function') {
          handle = w.evia.createWs(url)
          handle.onOpen?.(() => { console.log('[listen] WS open for chat', cid) })
          handle.onMessage((data: any) => {
            try {
              const msg = typeof data === 'string' ? JSON.parse(data) : data
              if (msg && msg.type === 'transcript_segment' && msg.data) {
                const d = msg.data as any
                setLines(prev => [...prev, { speaker: typeof d.speaker === 'number' ? d.speaker : null, text: String(d.text || ''), isFinal: !!d.is_final }])
              } else if (msg && msg.type === 'status' && msg.data) {
                const d = msg.data as any
                if (typeof d.echo_text === 'string') {
                  setLines(prev => [...prev, { speaker: null, text: String(d.echo_text), isFinal: true }])
                }
              }
            } catch { /* ignore */ }
          })
          handle.onError?.(() => { console.warn('[listen] WS error') })
          handle.onClose?.(() => { console.log('[listen] WS closed') })
        }
      } catch { /* ignore */ }
    })()

    return () => { try { handle?.close?.() } catch {} }
  }, [language, storageTick])

  // React to storage changes (token/chat id updates from header window)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'current_chat_id' || e.key === 'auth_token') {
        setStorageTick(t => t + 1)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

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


