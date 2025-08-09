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

const logEl = document.getElementById('log') as HTMLTextAreaElement
const statusEl = document.getElementById('status') as HTMLSpanElement

function log(line: string) {
  logEl.value += line + '\n'
  logEl.scrollTop = logEl.scrollHeight
}

let wsMic: ReturnType<EviaBridge['createWs']> | null = null
let wsSys: ReturnType<EviaBridge['createWs']> | null = null
let sysConnected = false

function connect() {
  const backend = prompt('Backend base URL (e.g., https://backend...azurecontainerapps.io)')
  const chatId = prompt('chat_id?')
  const token = prompt('JWT token?')
  if (!backend || !chatId || !token) { return }

  const urlMic = `${backend.replace(/\/$/, '')}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=mic`
  const urlSys = `${backend.replace(/\/$/, '')}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=system`

  const rawMic = new WebSocket(urlMic)
  const rawSys = new WebSocket(urlSys)

  rawMic.onopen = () => { statusEl.textContent = 'mic connected'; log('[mic] connected') }
  rawSys.onopen = () => { statusEl.textContent = 'system connected'; log('[system] connected') }

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

  // Start system audio helper and forward frames to WS
  window.evia.systemAudio.start().then(() => {
    window.evia.systemAudio.onData((line) => {
      try {
        const obj = JSON.parse(line)
        const b = atob(obj.data)
        const buf = new ArrayBuffer(b.length)
        const view = new Uint8Array(buf)
        for (let i = 0; i < b.length; i++) view[i] = b.charCodeAt(i)
        wsSys?.sendBinary(buf)
      } catch {}
    })
  })
}

(document.getElementById('connect') as HTMLButtonElement).onclick = connect
(document.getElementById('suggest') as HTMLButtonElement).onclick = () => {
  if (!wsMic) { alert('Connect first'); return }
  wsMic.sendCommand({ command: 'suggest' })
}

