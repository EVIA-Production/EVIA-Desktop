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
  // Mic streaming refs
  const micStreamRef = useRef<MediaStream | null>(null)
  const micAudioContextRef = useRef<AudioContext | null>(null)
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const stopMicRef = useRef<(() => void) | null>(null)
  // WS handles
  const micWsRef = useRef<any | null>(null)
  const sysWsRef = useRef<any | null>(null)

  useEffect(() => {
    // Only connect WS and start streaming in the listen window
    const qp = new URLSearchParams(window.location.search)
    const currentView = (qp.get('view') as View) || 'listen'
    if (currentView !== 'listen') return

    // Prefer prefs current_chat_id; fallback to localStorage (refresh in IIFE)
    let cid = window.localStorage.getItem('current_chat_id') || null
    chatIdRef.current = cid

    // Wrap async logic
    let handleMic: any | null = null
    let handleSys: any | null = null
    ;(async () => {
      // Try to refresh cid from prefs if available; if still missing, bail
      try {
        const respCid = await (window as any).evia?.prefs?.get?.()
        const fromPrefsCid = respCid?.prefs?.current_chat_id
        if (fromPrefsCid) {
          chatIdRef.current = String(fromPrefsCid)
          cid = chatIdRef.current
        }
      } catch {}
      if (!cid) { console.warn('[overlay] No current_chat_id; skipping WS connect'); return }
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

      const httpBase = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || window.localStorage.getItem('evia_backend') || 'http://localhost:8000'
      const wsBase = httpBase.replace(/^http/, 'ws').replace(/\/$/, '')
      const SAMPLE_RATE = 16000
      const CHUNK_MS = 100
      const SAMPLES_PER_CHUNK = Math.floor(SAMPLE_RATE * CHUNK_MS / 1000)

      const w: any = window as any
      if (!(w.evia && typeof w.evia.createWs === 'function')) return

      // Helper: parse incoming WS messages
      const onWsMessage = (data: any) => {
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
      }

      // Open system WS and stream system audio
      try {
        const urlSys = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}&source=system&sample_rate=${SAMPLE_RATE}&debug=1&dg_lang=${language}`
        handleSys = w.evia.createWs(urlSys)
        sysWsRef.current = handleSys
        handleSys.onOpen?.(() => {
          console.log('[listen] WS open (system) for chat', cid)
          try { w.evia.systemAudio.start() } catch {}
        })
        // Forward system audio frames
        try {
          w.evia.systemAudio.onData((frame: any) => {
            const ab = toArrayBuffer(frame)
            if (ab && sysWsRef.current) { try { sysWsRef.current.sendBinary(ab) } catch {} }
          })
          w.evia.systemAudio.onStatus((line: string) => {
            if (line) setLines(prev => [...prev, { speaker: null, text: String(line), isFinal: true }])
          })
        } catch {}
        handleSys.onMessage(onWsMessage)
        handleSys.onError?.(() => { console.warn('[listen] WS error (system)') })
        handleSys.onClose?.(() => { console.log('[listen] WS closed (system)') })
      } catch { /* ignore */ }

      // Open mic WS and stream mic audio
      try {
        const urlMic = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}&source=mic&sample_rate=${SAMPLE_RATE}&dg_lang=${language}`
        handleMic = w.evia.createWs(urlMic)
        micWsRef.current = handleMic
        handleMic.onOpen?.(async () => {
          console.log('[listen] WS open (mic) for chat', cid)
          try {
            await startMicStreaming((buffer: ArrayBuffer) => {
              if (micWsRef.current) { try { micWsRef.current.sendBinary(buffer) } catch {} }
            })
          } catch (e) {
            console.warn('[listen] mic start failed', e)
          }
        })
        handleMic.onMessage(onWsMessage)
        handleMic.onError?.(() => { console.warn('[listen] WS error (mic)') })
        handleMic.onClose?.(() => { console.log('[listen] WS closed (mic)') })
      } catch { /* ignore */ }
    })()

    return () => {
      try { micWsRef.current?.close?.() } catch {}
      try { sysWsRef.current?.close?.() } catch {}
      micWsRef.current = null
      sysWsRef.current = null
      // Stop mic
      try { stopMicRef.current?.() } catch {}
      stopMicRef.current = null
      // Stop system audio
      try { (window as any).evia?.systemAudio?.stop?.() } catch {}
    }
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

  // Utilities
  function toArrayBuffer(data: any): ArrayBuffer | null {
    try {
      if (!data) return null
      if (data instanceof ArrayBuffer) return data
      if (typeof data?.buffer?.slice === 'function' && data.buffer instanceof ArrayBuffer) {
        // TypedArray
        const u8 = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length || 0)
        return u8.slice().buffer
      }
      if (typeof data === 'string') {
        // assume base64
        const bin = atob(data)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        return u8.buffer
      }
    } catch {}
    return null
  }

  async function startMicStreaming(onChunk: (buf: ArrayBuffer) => void) {
    // Request mic (enable EC/NS/AGC like the working branch)
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: SAMPLE_RATE },
        channelCount: { ideal: 1 }
      }, 
      video: false 
    })
    micStreamRef.current = stream

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE })
    micAudioContextRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(1024, 1, 1)
    micProcessorRef.current = processor

    // route through zero gain to keep processor running without audio out
    const zero = ctx.createGain(); zero.gain.value = 0.0
    processor.connect(zero); zero.connect(ctx.destination)
    source.connect(processor)

    let acc = new Float32Array(0)
    processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0)
      // accumulate
      const next = new Float32Array(acc.length + input.length)
      next.set(acc, 0)
      next.set(input, acc.length)
      acc = next
      // send fixed ~100ms chunks
      while (acc.length >= SAMPLES_PER_CHUNK) {
        const chunk = acc.slice(0, SAMPLES_PER_CHUNK)
        acc = acc.slice(SAMPLES_PER_CHUNK)
        const pcm16 = new Int16Array(SAMPLES_PER_CHUNK)
        for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
          const s = Math.max(-1, Math.min(1, chunk[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        onChunk(pcm16.buffer)
      }
    }

    stopMicRef.current = () => {
      try { processor.disconnect() } catch {}
      try { source.disconnect() } catch {}
      try { zero.disconnect() } catch {}
      try { ctx.close() } catch {}
      try { stream.getTracks().forEach(t => t.stop()) } catch {}
      micProcessorRef.current = null
      micAudioContextRef.current = null
      micStreamRef.current = null
    }
  }

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


