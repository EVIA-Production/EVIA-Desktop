export {}
// Minimal overlay app: connects two WS sockets (mic and system) once JWT/chat info provided
// For now, prompts via window.prompt and logs events. Later we will wire mic/system capture.

type EviaBridge = {
  createWs: (url: string) => {
    sendBinary: (data: ArrayBuffer) => void
    sendCommand: (cmd: any) => void
    close: () => void
  }
  systemAudio: {
    start: () => Promise<{ ok: boolean }>
    stop: () => Promise<{ ok: boolean }>
    onData: (cb: (jsonLine: string) => void) => void
  }
}

declare global { interface Window { evia: EviaBridge } }

const logEl = document.getElementById('log') as HTMLTextAreaElement | null
const statusEl = document.getElementById('status') as HTMLSpanElement | null

function log(line: string) {
  if (!logEl) return
  logEl.value += line + '\n'
  logEl.scrollTop = logEl.scrollHeight
}

let wsMic: ReturnType<EviaBridge['createWs']> | null = null
let wsSys: ReturnType<EviaBridge['createWs']> | null = null
let sysConnected = false

function connect() {
  const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
  const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
  const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
  if (!backend || !chatId || !token) { alert('Enter backend, chat ID and token'); return }

  const urlMic = `${backend.replace(/\/$/, '')}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=mic`
  const urlSys = `${backend.replace(/\/$/, '')}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=system`

  const rawMic = new WebSocket(urlMic)
  const rawSys = new WebSocket(urlSys)

  rawMic.onopen = () => { if (statusEl) statusEl.textContent = 'mic connected'; log('[mic] connected') }
  rawSys.onopen = () => { if (statusEl) statusEl.textContent = 'system connected'; log('[system] connected') }

  rawMic.onmessage = ev => { log('[mic] ' + ev.data) }
  rawSys.onmessage = ev => { log('[system] ' + ev.data) }

  rawMic.onclose = ev => { log(`[mic] closed ${ev.code}`) }
  rawSys.onclose = ev => { log(`[system] closed ${ev.code}`) }

  // Wrap to expose send helpers
  wsMic = {
    sendBinary: (data: ArrayBuffer) => { if (rawMic.readyState === WebSocket.OPEN) rawMic.send(data) },
    sendCommand: (cmd: any) => { if (rawMic.readyState === WebSocket.OPEN) rawMic.send(JSON.stringify(cmd)) },
    close: () => rawMic.close(),
  }
  wsSys = {
    sendBinary: (data: ArrayBuffer) => { if (rawSys.readyState === WebSocket.OPEN) rawSys.send(data) },
    sendCommand: (cmd: any) => { if (rawSys.readyState === WebSocket.OPEN) rawSys.send(JSON.stringify(cmd)) },
    close: () => rawSys.close(),
  }

  // Start microphone capture → WS (source=mic)
  startMicCapture(wsMic).catch(() => {})

  // Start system audio helper and forward frames to WS
  if ((window as any).evia && (window as any).evia.systemAudio) {
    window.evia.systemAudio.start().then(() => {
      window.evia.systemAudio.onData((line: string) => {
        try {
          const obj = JSON.parse(line)
          const b = atob(obj.data)
          const buf = new ArrayBuffer(b.length)
          const view = new Uint8Array(buf)
          for (let i = 0; i < b.length; i++) view[i] = b.charCodeAt(i)
          wsSys?.sendBinary(buf)
        } catch {}
      })
    }).catch(() => {})
  } else {
    log('[system] helper unavailable in this build')
  }
}

const connectBtn = document.getElementById('connect') as HTMLButtonElement | null
if (connectBtn) connectBtn.onclick = connect
const suggestBtn = document.getElementById('suggest') as HTMLButtonElement | null
if (suggestBtn) suggestBtn.onclick = () => {
  if (!wsMic) { alert('Connect first'); return }
  wsMic.sendCommand({ command: 'suggest' })
}

async function startMicCapture(ws: { sendBinary: (data: ArrayBuffer) => void } | null) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    })
    const ctx = new AudioContext({ sampleRate: 48000 })
    const src = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const chunkMs = 100
    const targetRate = 16000
    let buffer: number[] = []
    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      for (let i = 0; i < input.length; i++) buffer.push(input[i])
      const samplesPerChunk = Math.floor((ctx.sampleRate / 1000) * chunkMs)
      while (buffer.length >= samplesPerChunk) {
        const chunk = buffer.splice(0, samplesPerChunk)
        const down = downsampleLinear(new Float32Array(chunk), ctx.sampleRate, targetRate)
        const i16 = floatTo16BitPCM(down)
        ws?.sendBinary(i16.buffer as ArrayBuffer)
      }
    }
    src.connect(proc)
    proc.connect(ctx.destination)
  } catch (e) {
    log('[mic] capture unavailable: ' + String(e))
  }
}

function downsampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return input
  const ratio = inRate / outRate
  const newLen = Math.floor(input.length / ratio)
  const output = new Float32Array(newLen)
  let pos = 0
  for (let i = 0; i < newLen; i++) {
    const nextPos = (i + 1) * ratio
    const start = Math.floor(pos)
    const end = Math.min(Math.floor(nextPos), input.length - 1)
    let sum = 0
    let count = 0
    for (let j = start; j <= end; j++) { sum += input[j]; count++ }
    output[i] = count ? sum / count : 0
    pos = nextPos
  }
  return output
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

