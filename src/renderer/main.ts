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
    onStatus?: (cb: (jsonLine: string) => void) => void
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

let micTranscript = ''
let sysTranscript = ''

let micBuffer: ArrayBuffer[] = []  // For WAV export
let sysBuffer: ArrayBuffer[] = []  // For system

// Mic capture state for toggle
let micCtx: AudioContext | null = null
let micProc: ScriptProcessorNode | null = null
let micStream: MediaStream | null = null
let micEnabled = true

// System IPC subscription/launch guards to prevent listener leaks
let sysIpcSubscribed = false
let sysHelperStarted = false

async function connect() {
  const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
  const chatIdInput = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
  const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
  if (!backend || !token) { alert('Enter backend and token'); return }

  let chatId = chatIdInput
  if (!chatId) {
    // Create new chat if no ID provided
    try {
      const res = await fetch(`${backend}/chat/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Chat ' + new Date().toISOString().slice(0,19) })
      })
      if (!res.ok) throw new Error(`Create chat failed: ${res.status}`)
      const data = await res.json()
      chatId = data.id.toString()
      log(`[chat] Created new ID=${chatId}`)
    } catch (e) {
      alert(`Failed to create chat: ${e}`)
      return
    }
  } else {
    // Verify existing ID
    try {
      const res = await fetch(`${backend}/chat/${chatId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 404) {
        log(`[chat] ID=${chatId} not found, creating new`)
        // Create with provided ID? No, backend assigns IDs; create new
        const createRes = await fetch(`${backend}/chat/`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Recovered Chat ' + chatId })
        })
        if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`)
        const data = await createRes.json()
        chatId = data.id.toString()
        log(`[chat] Created replacement ID=${chatId}`)
      } else if (!res.ok) {
        throw new Error(`Verify failed: ${res.status}`)
      }
    } catch (e) {
      alert(`Chat ID check failed: ${e}`)
      return
    }
  }

  // Proceed with connect using verified/created chatId
  const base = backend.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const scheme = backend.startsWith('https') ? 'wss' : 'ws'
  const urlMic = `${scheme}://${base}/ws/transcribe?chat_id=${encodeURIComponent(chatId!)}&token=${encodeURIComponent(token)}&source=mic`
  const urlSys = `${scheme}://${base}/ws/transcribe?chat_id=${encodeURIComponent(chatId!)}&token=${encodeURIComponent(token)}&source=system`

  const rawMic = new WebSocket(urlMic)
  const rawSys = new WebSocket(urlSys)

  rawMic.onopen = () => { if (statusEl) statusEl.textContent = 'mic connected'; log('[mic] connected') }
  rawSys.onopen = () => { if (statusEl) statusEl.textContent = 'system connected'; log('[system] connected') }

  rawMic.onmessage = ev => {
    log('[mic] ' + ev.data)
    const msg = JSON.parse(ev.data)
    if (msg.type === 'transcript_segment') {
      micTranscript += msg.data.text + ' '
      updateTranscriptDisplay()
    }
  }
  rawSys.onmessage = ev => {
    log('[system] ' + ev.data)
    const msg = JSON.parse(ev.data)
    if (msg.type === 'transcript_segment') {
      sysTranscript += msg.data.text + ' '
      updateTranscriptDisplay()
    }
  }

  // Reconnect with exponential backoff
  let micReconnectAttempts = 0
  let sysReconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 5
  const BASE_RECONNECT_DELAY_MS = 1000
  
  function getReconnectDelay(attempts: number): number {
    return Math.min(30000, BASE_RECONNECT_DELAY_MS * Math.pow(1.5, attempts)) * (0.9 + Math.random() * 0.2)
  }
  
  rawMic.onclose = ev => { 
    log(`[mic] closed ${ev.code}${ev.reason ? ': ' + ev.reason : ''}`)
    if (statusEl) statusEl.textContent = `mic closed (${ev.code})`
    
    // Reconnect with exponential backoff
    if (!micEnabled || micReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log('[mic] Max reconnect attempts reached')
      return
    }
    
    const delay = getReconnectDelay(micReconnectAttempts)
    log(`[mic] Reconnecting in ${Math.round(delay/1000)}s (attempt ${micReconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`)
    
    setTimeout(() => {
      micReconnectAttempts++
      // Only reopen mic socket; do not re-register system listeners
      try {
        const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
        const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
        const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
        if (!backend || !token || !chatId) return
        const base = backend.replace(/^https?:\/\//, '').replace(/\/$/, '')
        const scheme = backend.startsWith('https') ? 'wss' : 'ws'
        const urlMic = `${scheme}://${base}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=mic`
        const newMic = new WebSocket(urlMic)
        newMic.onopen = () => { if (statusEl) statusEl.textContent = 'mic connected'; log('[mic] connected') }
        newMic.onmessage = ev => {
          log('[mic] ' + ev.data)
          const msg = JSON.parse(ev.data)
          if (msg.type === 'transcript_segment') {
            micTranscript += msg.data.text + ' '
            updateTranscriptDisplay()
          }
        }
        newMic.onerror = ev => { log(`[mic] error: ${ev}`) }
        newMic.onclose = rawMic.onclose
        wsMic = {
          sendBinary: (data: ArrayBuffer) => { if (newMic.readyState === WebSocket.OPEN) newMic.send(data) },
          sendCommand: (cmd: any) => { if (newMic.readyState === WebSocket.OPEN) newMic.send(JSON.stringify(cmd)) },
          close: () => newMic.close(),
        }
        if (micEnabled && !micCtx) startMicCapture(wsMic).catch(() => {})
      } catch {}
    }, delay)
  }
  
  rawSys.onclose = ev => { 
    log(`[system] closed ${ev.code}${ev.reason ? ': ' + ev.reason : ''}`)
    if (statusEl) statusEl.textContent = `system closed (${ev.code})`
    
    // Reconnect with exponential backoff
    if (sysReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log('[system] Max reconnect attempts reached')
      return
    }
    
    const delay = getReconnectDelay(sysReconnectAttempts)
    log(`[system] Reconnecting in ${Math.round(delay/1000)}s (attempt ${sysReconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`)
    
    setTimeout(() => {
      sysReconnectAttempts++
      // Only reopen system socket; do not re-run full connect
      try {
        const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
        const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
        const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
        if (!backend || !token || !chatId) return
        const base = backend.replace(/^https?:\/\//, '').replace(/\/$/, '')
        const scheme = backend.startsWith('https') ? 'wss' : 'ws'
        const urlSys = `${scheme}://${base}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}&source=system`
        const newSys = new WebSocket(urlSys)
        newSys.onopen = () => { if (statusEl) statusEl.textContent = 'system connected'; log('[system] connected') }
        newSys.onmessage = ev => {
          log('[system] ' + ev.data)
          const msg = JSON.parse(ev.data)
          if (msg.type === 'transcript_segment') {
            sysTranscript += msg.data.text + ' '
            updateTranscriptDisplay()
          }
        }
        newSys.onerror = ev => { log(`[system] error: ${ev}`) }
        newSys.onclose = rawSys.onclose
        wsSys = {
          sendBinary: (data: ArrayBuffer) => { if (newSys.readyState === WebSocket.OPEN) newSys.send(data) },
          sendCommand: (cmd: any) => { if (newSys.readyState === WebSocket.OPEN) newSys.send(JSON.stringify(cmd)) },
          close: () => newSys.close(),
        }
        // Ensure helper remains started; listeners are already subscribed
        if (!sysHelperStarted && (window as any).evia?.systemAudio) {
          window.evia.systemAudio.start().catch(() => {})
          sysHelperStarted = true
        }
      } catch {}
    }, delay)
  }
  
  // Add error handlers
  rawMic.onerror = ev => {
    log(`[mic] error: ${ev}`)
    if (statusEl) statusEl.textContent = 'mic error'
  }
  
  rawSys.onerror = ev => {
    log(`[system] error: ${ev}`)
    if (statusEl) statusEl.textContent = 'system error'
  }

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
  if (micEnabled) startMicCapture(wsMic).catch(() => {})

  // Start system audio helper and forward frames to WS (subscribe/start once)
  if ((window as any).evia && (window as any).evia.systemAudio) {
    if (!sysIpcSubscribed) {
      try {
        if (typeof window.evia.systemAudio.onStatus === 'function') {
          window.evia.systemAudio.onStatus!((line: string) => {
            log('[system][status] ' + line)
          })
        }
      } catch {}
      try {
        window.evia.systemAudio.onData((data: string) => {
          try {
            const json = JSON.parse(data);
            const [_, rateStr, chStr] = json.mimeType.match(/rate=(\d+);channels=(\d+)/) || [];
            const inputRate = parseInt(rateStr) || 48000;
            const channels = parseInt(chStr) || 1;
            const float32 = base64ToFloat32Array(json.data);
            // Mix to mono if stereo
            let mono = float32;
            if (channels === 2) {
              mono = new Float32Array(float32.length / 2);
              for (let i = 0; i < mono.length; i++) {
                mono[i] = (float32[i*2] + float32[i*2+1]) / 2;
              }
            }
            // Downsample to 24000
            const downsampled = downsampleLinear(mono, inputRate, SAMPLE_RATE);
            sysAudioBuffer.push(...downsampled);

            while (sysAudioBuffer.length >= SAMPLES_PER_CHUNK) {
              const chunkArr = sysAudioBuffer.splice(0, SAMPLES_PER_CHUNK);
              const chunk = new Float32Array(chunkArr);
              const pcm16 = convertFloat32ToInt16(chunk);
              if (wsSys) (wsSys as any).sendBinary(pcm16.buffer as ArrayBuffer);
              const rms = calculateRMS(pcm16);
              log(`[system] Chunk RMS=${rms.toFixed(4)} sampleCount=${pcm16.length}`);
              sysBuffer.push(pcm16.buffer as ArrayBuffer);
            }
          } catch (e) {
            console.error('Invalid system audio data:', e);
          }
        });
      } catch {}
      sysIpcSubscribed = true
    }
    if (!sysHelperStarted) {
      window.evia.systemAudio.start().catch(() => {})
      sysHelperStarted = true
    }
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

document.addEventListener('DOMContentLoaded', () => {
  const inputs = ['backend', 'chatId', 'token']
  inputs.forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement
    if (el) {
      el.value = localStorage.getItem(id) || ''
      el.addEventListener('input', () => localStorage.setItem(id, el.value))
    }
  })

  const micWavBtn = document.createElement('button')
  micWavBtn.textContent = 'Export Mic WAV'
  micWavBtn.onclick = () => exportWav(micBuffer, 16000, 'mic')
  document.body.appendChild(micWavBtn)

  const sysWavBtn = document.createElement('button')
  sysWavBtn.textContent = 'Export Sys WAV'
  sysWavBtn.onclick = () => exportWav(sysBuffer, 16000, 'system')
  document.body.appendChild(sysWavBtn)

  const testToneBtn = document.createElement('button')
  testToneBtn.textContent = 'Test Tone (Sys)'
  testToneBtn.onclick = () => {
    const tone = generateSinePCM16(1000, 200, 16000, 0.25)
    wsSys?.sendBinary(tone.buffer as ArrayBuffer)
    sysBuffer.push(tone.buffer as ArrayBuffer)
    if (sysBuffer.length > 100) sysBuffer.shift()
    log('[system] Injected 1kHz 200ms test tone')
  }
  document.body.appendChild(testToneBtn)

  const micToggleBtn = document.createElement('button')
  micToggleBtn.textContent = 'Toggle Mic'
  micToggleBtn.onclick = async () => {
    if (micEnabled) {
      stopMicCapture()
      log('[mic] toggled OFF')
    } else {
      await startMicCapture(wsMic)
      log('[mic] toggled ON')
    }
  }
  document.body.appendChild(micToggleBtn)
})

async function startMicCapture(ws: { sendBinary: (data: ArrayBuffer) => void } | null) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: 48000 },
      },
      video: false,
    })
    const ctx = new AudioContext({ sampleRate: stream.getAudioTracks()[0].getSettings().sampleRate || 48000 })
    const src = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)

    // Add low-pass filter (Butterworth, cutoff at 3600 Hz to avoid aliasing)
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 3600  // Fixed value instead of relative calculation
    lowpass.Q.value = 0.7071  // Butterworth response (1/sqrt(2))

    src.connect(lowpass)
    lowpass.connect(proc)
    proc.connect(ctx.destination)

    const chunkMs = 100
    const targetRate = 16000
    let buffer: number[] = []
    let gain = 1.0  // Initial gain
    let maxGain = 12.0  // Max amplification (reduced from 24.0 to avoid distortion)

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      for (let i = 0; i < input.length; i++) buffer.push(input[i])

      const samplesPerChunk = Math.floor((ctx.sampleRate / 1000) * chunkMs)
      while (buffer.length >= samplesPerChunk) {
        const chunk = buffer.splice(0, samplesPerChunk)

        // Compute RMS for VAD and gain
        let rms = 0
        for (let s of chunk) rms += s * s
        rms = Math.sqrt(rms / chunk.length)
        log(`[mic] Processing chunk RMS=${rms.toFixed(4)}`)
        // if (rms < 0.005) {  // Lowered from 0.01
        //   log(`[mic] Skipped silent chunk RMS=${rms.toFixed(4)}`)
        //   continue
        // }

        if (rms > 0) {
          gain = Math.min(maxGain, Math.max(1.0, gain * (0.1 / rms)))
        }

        // Apply gain with more conservative soft limiting
        // Use tanh for soft limiting but with gentler curve to avoid distortion
        const processed = chunk.map(s => {
          const amplified = s * gain
          return Math.tanh(amplified * 0.8) * 1.2  // Gentler curve with slight boost to compensate
        })

        const down = downsampleLinear(new Float32Array(processed), ctx.sampleRate, targetRate)
        const i16 = floatTo16BitPCM(down)
        ws?.sendBinary(i16.buffer as ArrayBuffer)
        micBuffer.push(i16.buffer as ArrayBuffer)
        if (micBuffer.length > 100) micBuffer.shift()  // Keep ~10s
      }
    }
    // Save state for toggle
    micCtx = ctx
    micProc = proc
    micStream = stream
    micEnabled = true
  } catch (e) {
    log('[mic] capture unavailable: ' + String(e))
  }
}

function stopMicCapture() {
  try {
    micProc?.disconnect()
  } catch {}
  try {
    micCtx?.close()
  } catch {}
  try {
    micStream?.getTracks().forEach(t => t.stop())
  } catch {}
  micCtx = null
  micProc = null
  micStream = null
  micEnabled = false
}

function updateTranscriptDisplay() {
  // Assume UI elements micDisplay and sysDisplay
  const micEl = document.getElementById('micTranscript')
  const sysEl = document.getElementById('sysTranscript')
  if (micEl) micEl.textContent = micTranscript
  if (sysEl) sysEl.textContent = sysTranscript
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

function exportWav(buffers: ArrayBuffer[], sampleRate: number, label: string) {
  const totalSamples = buffers.reduce((sum, b) => sum + (b.byteLength / 2), 0)
  const wav = new ArrayBuffer(44 + totalSamples * 2)
  const view = new DataView(wav)

  // RIFF header
  view.setUint32(0, 0x52494646, false)  // 'RIFF'
  view.setUint32(4, 36 + totalSamples * 2, true)
  view.setUint32(8, 0x57415645, false)  // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x666d7420, false)  // 'fmt '
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)  // PCM
  view.setUint16(22, 1, true)  // Mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)  // Byte rate
  view.setUint16(32, 2, true)  // Block align
  view.setUint16(34, 16, true)  // Bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false)  // 'data'
  view.setUint32(40, totalSamples * 2, true)

  let offset = 44
  for (let buf of buffers) {
    const viewBuf = new Int16Array(buf)
    for (let s of viewBuf) {
      view.setInt16(offset, s, true)
      offset += 2
    }
  }

  const blob = new Blob([wav], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${label}-audio.wav`
  a.click()
  URL.revokeObjectURL(url)
}

function generateSinePCM16(freqHz: number, durationMs: number, sampleRate: number, amplitude: number): Int16Array {
  const samples = Math.floor(sampleRate * (durationMs / 1000))
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) {
    const s = Math.sin(2 * Math.PI * freqHz * (i / sampleRate)) * amplitude
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// Add at top (after imports)
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms
const SAMPLES_PER_CHUNK = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400

// Helper functions (adapted from Glass)
function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    int16Array[i] = Math.min(1, Math.max(-1, float32Array[i])) * 0x7FFF;
  }
  return int16Array;
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ToFloat32Array(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 0x8000;
  }
  return float32Array;
}

// Add calculateRMS (for Int16Array)
function calculateRMS(samples: Int16Array): number {
  let sum = 0;
  for (let s of samples) {
    const norm = s / 32768.0;
    sum += norm * norm;
  }
  return Math.sqrt(sum / samples.length);
}

// Add base64ToFloat32Array function
function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// In onData handler
let sysAudioBuffer: number[] = [];