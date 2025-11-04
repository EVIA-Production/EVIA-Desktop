export {}
// Minimal overlay app: connects two WS sockets (mic and system) once JWT/chat info provided

// Import audio processing utilities
// Import audio processing utilities dynamically to avoid TypeScript issues
// @ts-ignore
const audioProcessing = await import('./audio-processing.js');
const {
  SAMPLE_RATE,
  AUDIO_CHUNK_DURATION,
  SAMPLES_PER_CHUNK,
  initAudioProcessing,
  processSystemAudio,
  convertFloat32ToInt16,
  calculateRMS,
  base64ToFloat32Array,
  exportBufferToWav,
  pcmBuffers
} = audioProcessing;

// Add imports
import { getWebSocketInstance } from './services/websocketService';

type EviaBridge = {
  createWs: (url: string) => {
    sendBinary: (data: ArrayBuffer) => void
    sendCommand: (cmd: any) => void
    close: () => void
    onMessage?: (cb: (data: string | ArrayBuffer | Blob) => void) => void
    onOpen?: (cb: () => void) => void
    onClose?: (cb: (event: CloseEvent) => void) => void
    onError?: (cb: (event: Event) => void) => void
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

// Add micDisabled with other variables at top
let wsMic: ReturnType<EviaBridge['createWs']> | null = null
let wsSys: ReturnType<EviaBridge['createWs']> | null = null
let sysConnected = false
let micDisabled = false; // Add here

let micTranscript = ''
let sysTranscript = ''
let micInterim = ''
let sysInterim = ''

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

// System audio buffer for processing
let sysAudioBuffer: number[] = [];

// Add state for transcripts, suggestions from useWebSocketMessages
let transcriptLines: TranscriptLine[] = [];
let suggestion = '';

// Update transcript display every 250ms
setInterval(updateTranscriptDisplay, 250)

function updateTranscriptDisplay() {
  const micEl = document.getElementById('mic-transcript')
  const sysEl = document.getElementById('sys-transcript')
  
  if (micEl) {
    const micText = micTranscript + (micInterim ? (micTranscript ? '\n' : '') + micInterim : '')
    micEl.textContent = micText
  }
  if (sysEl) {
    const sysText = sysTranscript + (sysInterim ? (sysTranscript ? '\n' : '') + sysInterim : '')
    sysEl.textContent = sysText
  }
  
  // Auto-scroll to bottom if content is updated
  if (micEl && micTranscript) {
    const container = micEl.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }
  
  if (sysEl && sysTranscript) {
    const container = sysEl.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function toWsBase(url: string): string {
  if (!url) return ''
  // Convert HTTP URL to WS URL with same host:port
  return url.replace(/^http/, 'ws')
}

async function connect() {
  const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
  const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
  const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()

  if (!backend || !chatId || !token) {
    alert('Missing fields: backend, chatId, token are required')
      return
    }

  // Enforce numeric chat id to avoid 403/404 from backend
  const chatIdNum = Number(chatId)
  if (!Number.isFinite(chatIdNum) || !/^[0-9]+$/.test(chatId)) {
    alert('Chat ID must be a numeric ID')
      return
    }

  // Persist token for services that read from localStorage
  try { localStorage.setItem('auth_token', token) } catch {}

  // Disconnect any existing connections
  if (wsMic) {
    wsMic.close()
    wsMic = null
  }
  if (wsSys) {
    wsSys.close()
    wsSys = null
  }

  // Reset transcripts
  micTranscript = ''
  sysTranscript = ''
  updateTranscriptDisplay()

  // Connect mic WS
  try {
    const base = toWsBase(backend)
    log(`[connect] backend=${base} chat_id=${chatIdNum}`)
    // 🎯 FIX: Get language from settings instead of hardcoding
    const userLang = localStorage.getItem('language') || 'de';  // Default German
    // 🔥 FIX: Remove profile=mic parameter (backend doesn't extract it, causes Nova-3 timeout)
    // System audio works without it, so mic should too
    const urlMic = `${base}/ws/transcribe?chat_id=${encodeURIComponent(String(chatIdNum))}&token=${encodeURIComponent(token)}&source=mic&sample_rate=24000&dg_lang=${userLang}`
    const urlSys = `${base}/ws/transcribe?chat_id=${encodeURIComponent(String(chatIdNum))}&token=${encodeURIComponent(token)}&source=system&debug=1&sample_rate=24000&dg_lang=${userLang}`

    log(`Connecting mic WS: ${urlMic.split('?')[0]}`)
    const ws = window.evia.createWs(urlMic)
    
    // Create a wrapper with similar API to frontend's WebSocket wrapper
    wsMic = {
      sendBinary: (data) => ws.sendBinary(data),
      sendCommand: (cmd) => ws.sendCommand(cmd),
      close: () => ws.close()
    }
    log('[mic] connected')

    // Connect system WS
    log(`Connecting system WS: ${urlSys.split('?')[0]}`)
    const sys = window.evia.createWs(urlSys)
    wsSys = {
      sendBinary: (data) => sys.sendBinary(data),
      sendCommand: (cmd) => sys.sendCommand(cmd),
      close: () => sys.close()
    }
    log('[system] connected')

    // Start mic capture only if not disabled
    if (!micDisabled) {
      await startMicCapture(chatId, token)
    } else {
      log('[mic] Skipped start due to disabled state');
    }

    if (statusEl) {
      statusEl.textContent = 'Connected'
      statusEl.className = 'connected'
    }
    
    // System WS message handler (synthetic for now)
    const onMessage = (msg: string) => {
      try {
        const data = JSON.parse(msg)
        log(`[system msg:${data.type}] ${JSON.stringify(data).substring(0, 100)}${data.type === 'transcript_segment' ? '...' : ''}`)
        
        if (data.type === 'transcript_segment' && data.data && data.data.text) {
          const text = data.data.text
          log(`[system transcript] ${text}`)
          sysTranscript = sysTranscript ? `${sysTranscript}\n${text}` : text
        } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
          const isOpen = Boolean(data.data.dg_open)
          log(`[system status] dg_open=${isOpen ? 1 : 0}`)
        }
      } catch (e) {
        log(`[system error] Failed to parse WebSocket message: ${e}`)
      }
    }
    
    // Mic WS message handler (synthetic for now)
    const onMicMessage = (msg: string) => {
      try {
        const data = JSON.parse(msg)
        log(`[mic msg:${data.type}] ${JSON.stringify(data).substring(0, 100)}${data.type === 'transcript_segment' ? '...' : ''}`)
        
        if (data.type === 'transcript_segment' && data.data && data.data.text) {
          const text = data.data.text
          log(`[mic transcript] ${text}`)
          micTranscript = micTranscript ? `${micTranscript}\n${text}` : text
        } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
          const isOpen = Boolean(data.data.dg_open)
          log(`[mic status] dg_open=${isOpen ? 1 : 0}`)
        }
      } catch (e) {
        log(`[mic error] Failed to parse WebSocket message: ${e}`)
      }
    }

    // Wire native WebSocket handlers via preload bridge
    sys.onMessage?.((payload) => {
      try {
        if (typeof payload === 'string') {
          const data = JSON.parse(payload)
          if (data.type === 'transcript_segment' && data.data?.text) {
            const text = String(data.data.text)
            const isFinal = Boolean(data.data.is_final)
            if (isFinal) {
              sysTranscript = sysTranscript ? `${sysTranscript}\n${text}` : text
              sysInterim = ''
            } else {
              sysInterim = text
            }
            updateTranscriptDisplay()
          } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
            const isOpen = Boolean(data.data.dg_open)
            const statusIndicator = document.getElementById('sys-status')
            if (statusIndicator) {
              statusIndicator.textContent = isOpen ? 'Connected ✓' : 'Connecting...'
              statusIndicator.className = isOpen ? 'status-indicator active' : 'status-indicator'
            }
          }
        }
      } catch (err) {
        console.error('[system] onMessage parse error:', err)
      }
    })
    sys.onOpen?.(() => log('[system] ws open'))
    sys.onClose?.((e) => {
      const hint = (e.code === 1008 || e.code === 1006) ? ' (auth/chat mismatch or server policy violation)' : ''
      log(`[system] ws close code=${e.code}${hint}`)
      const status = document.getElementById('sys-status')
      if (status) {
        ;(status as HTMLElement).textContent = `Disconnected (${e.code})`
        status.className = 'status-indicator'
      }
    })
    sys.onError?.(() => {
      log('[system] ws error')
      const status = document.getElementById('sys-status')
      if (status) {
        ;(status as HTMLElement).textContent = 'Error'
        status.className = 'status-indicator'
      }
    })

    ws.onMessage?.((payload) => {
      try {
        if (typeof payload === 'string') {
          const data = JSON.parse(payload)
          if (data.type === 'transcript_segment' && data.data?.text) {
            const text = String(data.data.text)
            const isFinal = Boolean(data.data.is_final)
            if (isFinal) {
              micTranscript = micTranscript ? `${micTranscript}\n${text}` : text
              micInterim = ''
            } else {
              micInterim = text
            }
            updateTranscriptDisplay()
          } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
            const isOpen = Boolean(data.data.dg_open)
            const statusIndicator = document.getElementById('mic-status')
            if (statusIndicator) {
              statusIndicator.textContent = isOpen ? 'Connected ✓' : 'Connecting...'
              statusIndicator.className = isOpen ? 'status-indicator active' : 'status-indicator'
            }
          }
        }
      } catch (err) {
        console.error('[mic] onMessage parse error:', err)
      }
    })
    ws.onOpen?.(() => log('[mic] ws open'))
    ws.onClose?.((e) => {
      const hint = (e.code === 1008 || e.code === 1006) ? ' (auth/chat mismatch or server policy violation)' : ''
      log(`[mic] ws close code=${e.code}${hint}`)
      const status = document.getElementById('mic-status')
      if (status) {
        ;(status as HTMLElement).textContent = `Disconnected (${e.code})`
        status.className = 'status-indicator'
      }
    })
    ws.onError?.(() => {
      log('[mic] ws error')
      const status = document.getElementById('mic-status')
      if (status) {
        ;(status as HTMLElement).textContent = 'Error'
        status.className = 'status-indicator'
      }
    })
  } catch (e) {
    log(`Connection error: ${e}`)
    if (statusEl) {
      statusEl.textContent = `Error: ${e}`
      statusEl.className = 'error'
    }
    return
  }

  // Start system audio helper and forward frames to WS
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
        window.evia.systemAudio.onData(async (data: string) => {
          try {
            const json = JSON.parse(data);
            const [_, rateStr, chStr] = json.mimeType.match(/rate=(\d+);channels=(\d+)/) || [];
            const inputRate = parseInt(rateStr) || 48000;
            const channels = parseInt(chStr) || 1;
            const float32 = base64ToFloat32Array(json.data);
            
            // Log source format info
            log(`[system] Received float32 audio: rate=${inputRate}Hz, channels=${channels}, samples=${float32.length}`);
            
            // Process system audio (convert to 16kHz PCM16 mono with filtering)
            const pcm16 = await processSystemAudio(float32, inputRate, channels);
            
            // Only send non-empty chunks to WebSocket
            if (pcm16 && pcm16.length > 0) {
              // Send processed audio to WebSocket
              if (wsSys) wsSys.sendBinary(pcm16.buffer);
              
              // Log and store for diagnostics
              const rms = calculateRMS(pcm16);
              log(`[system] Processed chunk RMS=${rms.toFixed(4)} sampleCount=${pcm16.length}`);
              
              // Save to buffer for WAV export
              sysBuffer.push(pcm16.buffer);
              pcmBuffers.system.push(pcm16.buffer);
              if (pcmBuffers.system.length > 100) pcmBuffers.system.shift(); // Keep ~10s
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

// Quick mic-only connect helper for testing
async function connectMicOnly() {
  try {
    const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
    const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
    const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
    if (!backend || !chatId || !token) { alert('Missing fields: backend/chatId/token'); return }

    // Close any existing
    if (wsMic) { wsMic.close(); wsMic = null }
    if (wsSys) { wsSys.close(); wsSys = null }

    // Reset transcripts
    micTranscript = ''
    sysTranscript = ''
    micInterim = ''
    sysInterim = ''
    updateTranscriptDisplay()

    const base = toWsBase(backend)
    const userLang = localStorage.getItem('language') || 'de';
    // 🔥 COLD CALLING FIX: Add profile=mic for fast finalization
    const urlMic = `${base}/ws/transcribe?chat_id=${encodeURIComponent(String(chatId))}&token=${encodeURIComponent(token)}&source=mic&profile=mic&sample_rate=24000&dg_lang=${userLang}`
    log(`[mic-only] connecting ${urlMic.split('?')[0]}`)
    const ws = window.evia.createWs(urlMic)
    wsMic = { sendBinary: (d) => ws.sendBinary(d), sendCommand: (c) => ws.sendCommand(c), close: () => ws.close() }
    ws.onOpen?.(() => log('[mic-only] ws open'))
    ws.onMessage?.((payload) => {
      if (typeof payload !== 'string') return
      try {
        const data = JSON.parse(payload)
        if (data.type === 'transcript_segment' && data.data?.text) {
          const text = String(data.data.text)
          const isFinal = Boolean(data.data.is_final)
          if (isFinal) { micTranscript = micTranscript ? `${micTranscript}\n${text}` : text; micInterim = '' }
          else { micInterim = text }
          updateTranscriptDisplay()
        } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
          log(`[mic-only status] dg_open=${data.data.dg_open ? 1 : 0}`)
        }
      } catch {}
    })
    // Start mic capture
    await startMicCapture(chatId, token || '')
    log('[mic-only] started')
  } catch (e) {
    log(`[mic-only] error: ${e}`)
  }
}

// After connect, add button setups
const connectBtn = document.getElementById('connect') as HTMLButtonElement | null
if (connectBtn) connectBtn.onclick = connect

const suggestBtn = document.getElementById('suggest') as HTMLButtonElement | null
if (suggestBtn) suggestBtn.onclick = () => {
  if (!wsMic) { alert('Connect first'); return }
  wsMic.sendCommand({ command: 'suggest' })
}

const audioTestBtn = document.getElementById('audio-test') as HTMLButtonElement | null
if (audioTestBtn) audioTestBtn.onclick = startAudioTest

const micOffBtn = document.getElementById('mic-off') as HTMLButtonElement | null
if (micOffBtn) micOffBtn.onclick = () => {
  // No-op here; repurposed to 'System Off' in DOMContentLoaded to avoid conflicting handlers
}

const exportSysWavBtn = document.getElementById('export-system-wav') as HTMLButtonElement | null
if (exportSysWavBtn) exportSysWavBtn.onclick = () => exportSystemLastSeconds(10)

// Wire a visible button for mic-only if present
const micOnlyBtnStatic = document.getElementById('mic-only') as HTMLButtonElement | null
if (micOnlyBtnStatic) micOnlyBtnStatic.onclick = connectMicOnly

// Define audio test function
function startAudioTest() {
  console.log('Starting Audio Test Tool');
  // For now, open a new window or log; expand later
  const testWindow = window.open('', 'AudioTest', 'width=600,height=400');
  if (testWindow) {
    // @ts-ignore
    testWindow.document.write('<h1>Audio Test Tool</h1><p>Testing audio capture...</p>');
  }
}

// (removed duplicate static mic-off handler and duplicate startAudioTest/event listeners)

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize audio processing
  const audioInitialized = await initAudioProcessing();
  console.log(`Audio initialization ${audioInitialized ? 'successful' : 'failed'}`);
  
  // Improve form value persistence with better localStorage handling
  const inputs = ['backend', 'chatId', 'token']
  inputs.forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement
    if (el) {
      // Load saved value
      const savedValue = localStorage.getItem(`evia_${id}`) || ''
      el.value = savedValue
      
      // Save on change with debounce
      let saveTimeout: number | null = null
      const saveValue = () => {
        if (el.value) {
          localStorage.setItem(`evia_${id}`, el.value)
          console.log(`Saved ${id} value to localStorage`)
        }
      }
      
      // Save on input with debounce
      el.addEventListener('input', () => {
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = setTimeout(saveValue, 500) as unknown as number
      })
      
      // Also save on blur for immediate persistence
      el.addEventListener('blur', saveValue)
    }
  })

  // Add audio test button handler
  const audioTestBtn = document.getElementById('audio-test')
  if (audioTestBtn) {
    audioTestBtn.addEventListener('click', () => {
      // Use any type assertion to bypass TypeScript checking
      const evia = window.evia as any
      if (typeof evia.launchAudioTest === 'function') {
        evia.launchAudioTest()
      } else {
        console.error('launchAudioTest function not available')
        alert('Audio test feature not available. Please check the console for details.')
      }
    })
  }

  // Create a container for the buttons with proper styling
  const buttonContainer = document.createElement('div');
  buttonContainer.style.position = 'fixed';
  buttonContainer.style.bottom = '10px';
  buttonContainer.style.left = '10px';
  buttonContainer.style.zIndex = '1000';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '10px';
  buttonContainer.style.flexWrap = 'wrap';
  ;(buttonContainer.style as any).webkitAppRegion = 'no-drag';
  buttonContainer.style.pointerEvents = 'auto';
  document.body.appendChild(buttonContainer);

  // Create buttons with proper styling
  const createButton = (text: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.padding = '8px 12px';
    button.style.backgroundColor = '#4CAF50';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.margin = '5px';
    ;(button.style as any).webkitAppRegion = 'no-drag';
    button.style.pointerEvents = 'auto';
    button.onclick = onClick;
    return button;
  };

  // Create all the buttons
  const micWavBtn = createButton('Export Mic WAV', () => exportWav(micBuffer, SAMPLE_RATE, 'mic'));
  const sysWavBtn = createButton('Export System WAV (10s)', () => exportSystemLastSeconds(10));
  const micOnlyBtn = createButton('Connect Mic Only', async () => {
    try {
      const backend = (document.getElementById('backend') as HTMLInputElement | null)?.value?.trim()
      const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim()
      const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim()
      if (!backend || !chatId || !token) { alert('Missing fields'); return }

      // Close any existing
      if (wsMic) { wsMic.close(); wsMic = null }
      if (wsSys) { wsSys.close(); wsSys = null }

      // Reset transcripts
      micTranscript = ''
      sysTranscript = ''
      micInterim = ''
      sysInterim = ''
      updateTranscriptDisplay()

      const base = toWsBase(backend)
      const userLang = localStorage.getItem('language') || 'de';
      // 🔥 COLD CALLING FIX: Add profile=mic for fast finalization
      const urlMic = `${base}/ws/transcribe?chat_id=${encodeURIComponent(String(chatId))}&token=${encodeURIComponent(token)}&source=mic&profile=mic&sample_rate=24000&dg_lang=${userLang}`
      log(`[mic-only] connecting ${urlMic.split('?')[0]}`)
      const ws = window.evia.createWs(urlMic)
      wsMic = { sendBinary: (d) => ws.sendBinary(d), sendCommand: (c) => ws.sendCommand(c), close: () => ws.close() }
      ws.onOpen?.(() => log('[mic-only] ws open'))
      ws.onMessage?.((payload) => {
        if (typeof payload !== 'string') return
        try {
          const data = JSON.parse(payload)
          if (data.type === 'transcript_segment' && data.data?.text) {
            const text = String(data.data.text)
            const isFinal = Boolean(data.data.is_final)
            if (isFinal) { micTranscript = micTranscript ? `${micTranscript}\n${text}` : text; micInterim = '' }
            else { micInterim = text }
            updateTranscriptDisplay()
          } else if (data.type === 'status' && data.data && 'dg_open' in data.data) {
            log(`[mic-only status] dg_open=${data.data.dg_open ? 1 : 0}`)
          }
        } catch {}
      })
      // Start mic capture
      await startMicCapture(chatId, token || '')
      log('[mic-only] started')
    } catch (e) {
      log(`[mic-only] error: ${e}`)
    }
  });
  
  const testToneBtn = createButton('Test Tone (Sys)', () => {
    const tone = generateSinePCM16(1000, 200, SAMPLE_RATE, 0.25);
    wsSys?.sendBinary(tone.buffer as ArrayBuffer);
    sysBuffer.push(tone.buffer as ArrayBuffer);
    if (sysBuffer.length > 100) sysBuffer.shift();
    log('[system] Injected 1kHz 200ms test tone');
  });
  
  const micToggleBtn = createButton('Toggle Mic', async () => {
    const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim() || ''
    const token = (document.getElementById('token') as HTMLInputElement | null)?.value?.trim() || localStorage.getItem('auth_token') || ''
    if (micEnabled) {
      if (chatId) { await stopMicCapture(chatId) } else { await stopMicCapture('') }
      log('[mic] toggled OFF');
      micToggleBtn.textContent = 'Enable Mic';
      micToggleBtn.style.backgroundColor = '#f44336';
    } else {
      await startMicCapture(chatId, token);
      log('[mic] toggled ON');
      micToggleBtn.textContent = 'Disable Mic';
      micToggleBtn.style.backgroundColor = '#4CAF50';
    }
  });
  
  // Add diagnostic button
  const diagBtn = createButton('Run Diagnostics', () => {
    // Get references to global variables safely
    const ctx = (window as any).audioContext;
    const processor = (window as any).processorNode;
    const sysBufManager = (window as any).systemBufferManager || { getBufferLength: () => 0, targetSampleRate: SAMPLE_RATE, targetChunkSize: SAMPLES_PER_CHUNK };
    const micBufManager = (window as any).micBufferManager || { getBufferLength: () => 0, targetSampleRate: SAMPLE_RATE, targetChunkSize: SAMPLES_PER_CHUNK };
    
    // Show diagnostic info in a dialog
    const diagnosticInfo = {
      audioContext: ctx ? {
        sampleRate: ctx.sampleRate,
        state: ctx.state,
        baseLatency: ctx.baseLatency,
      } : 'Not initialized',
      processorNode: processor ? 'Active' : 'Not created',
      systemBufferManager: {
        bufferLength: sysBufManager.getBufferLength(),
        targetSampleRate: sysBufManager.targetSampleRate,
        targetChunkSize: sysBufManager.targetChunkSize,
      },
      micBufferManager: {
        bufferLength: micBufManager.getBufferLength(),
        targetSampleRate: micBufManager.targetSampleRate,
        targetChunkSize: micBufManager.targetChunkSize,
      },
      webSocketState: {
        mic: wsMic ? 'Connected' : 'Not connected',
        system: wsSys ? 'Connected' : 'Not connected',
      },
      localStorage: {
        backend: localStorage.getItem('evia_backend') || 'Not set',
        chatId: localStorage.getItem('evia_chatId') ? 'Set' : 'Not set',
        token: localStorage.getItem('evia_token') ? 'Set' : 'Not set',
      },
      buffers: {
        micBufferLength: micBuffer.length,
        sysBufferLength: sysBuffer.length,
      }
    };
    
    log('===== DIAGNOSTICS =====');
    log(JSON.stringify(diagnosticInfo, null, 2));
    log('======================');
    
    // Check for common issues
    if (!ctx) {
      log('[ISSUE] AudioContext not initialized');
    }
    if (!processor) {
      log('[ISSUE] AudioWorkletNode not created - check console for errors');
    }
    if (sysBufManager.getBufferLength() > 10000) {
      log('[ISSUE] System buffer too large - possible audio processing bottleneck');
    }
    
    // Display in a more visible way
    alert('Diagnostic information logged to console.\n\nKey findings:\n' + 
          `- AudioContext: ${ctx ? 'OK' : 'FAILED'}\n` +
          `- AudioProcessor: ${processor ? 'OK' : 'FAILED'}\n` +
          `- System Audio: ${wsSys ? 'Connected' : 'Not connected'}\n` +
          `- Mic Audio: ${wsMic ? 'Connected' : 'Not connected'}`);
  });

  // Add buttons to the container
  buttonContainer.appendChild(micWavBtn);
  buttonContainer.appendChild(sysWavBtn);
  buttonContainer.appendChild(micOnlyBtn);
  buttonContainer.appendChild(testToneBtn);
  buttonContainer.appendChild(micToggleBtn);
  buttonContainer.appendChild(diagBtn);
  
  // Add a status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.style.position = 'fixed';
  statusIndicator.style.top = '10px';
  statusIndicator.style.right = '10px';
  statusIndicator.style.padding = '5px 10px';
  statusIndicator.style.backgroundColor = '#333';
  statusIndicator.style.color = 'white';
  statusIndicator.style.borderRadius = '4px';
  statusIndicator.style.fontSize = '12px';
  statusIndicator.textContent = 'Audio System: ' + (audioInitialized ? 'Ready' : 'Fallback Mode');
  document.body.appendChild(statusIndicator);

  // Wire static buttons if present in DOM
  const staticMicOff = document.getElementById('mic-off');
  if (staticMicOff) {
    ;((staticMicOff as HTMLElement).style as any).webkitAppRegion = 'no-drag'
    ;(staticMicOff as HTMLElement).style.pointerEvents = 'auto'
    // Repurpose as System Off to test mic-only path
    ;(staticMicOff as HTMLElement).textContent = 'System Off'
    staticMicOff.addEventListener('click', async () => {
      const chatId = (document.getElementById('chatId') as HTMLInputElement | null)?.value?.trim() || '';
      if (!chatId) { log('[system] No chatId'); return; }
      await stopSystemCapture(chatId);
      sysInterim = ''
      log('[system] turned OFF');
      updateTranscriptDisplay()
    });
  }
  const staticExportSys = document.getElementById('export-system-wav');
  if (staticExportSys) {
    ;((staticExportSys as HTMLElement).style as any).webkitAppRegion = 'no-drag'
    ;(staticExportSys as HTMLElement).style.pointerEvents = 'auto'
    ;(staticExportSys as HTMLElement).textContent = 'Export Mic WAV'
    staticExportSys.addEventListener('click', () => exportMicToWAV());
  }
  // Ensure core controls are clickable
  const staticConnect = document.getElementById('connect') as HTMLElement | null
  if (staticConnect) { ;(staticConnect.style as any).webkitAppRegion = 'no-drag'; staticConnect.style.pointerEvents = 'auto' }
  const staticSuggest = document.getElementById('suggest') as HTMLElement | null
  if (staticSuggest) { ;(staticSuggest.style as any).webkitAppRegion = 'no-drag'; staticSuggest.style.pointerEvents = 'auto' }
  const staticAudioTest = document.getElementById('audio-test') as HTMLElement | null
  if (staticAudioTest) { ;(staticAudioTest.style as any).webkitAppRegion = 'no-drag'; staticAudioTest.style.pointerEvents = 'auto' }
})

async function startMicCapture(chatId: string, token: string) {
  try {
    // Request mic access
    micStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: SAMPLE_RATE },
        channelCount: { ideal: 1 }
      } 
    });

    // Log mic settings
    const track = micStream.getAudioTracks()[0];
    const settings = track.getSettings();
    console.log('[mic] Track settings:', settings);
    log(`[mic] Started with sampleRate=${settings.sampleRate || 'default'}`);

    // Create context at target rate
    micCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try { await micCtx.resume() } catch {}

    // Create source and processor
    const source = micCtx.createMediaStreamSource(micStream);
    micProc = micCtx.createScriptProcessor(1024, 1, 1); // Smaller buffer for lower latency

    // Connect graph and ensure processor runs; route through zero-gain to avoid feedback
    source.connect(micProc);
    const zero = micCtx.createGain();
    zero.gain.value = 0.0;
    micProc.connect(zero);
    zero.connect(micCtx.destination);

    // Mic buffer for chunking
    let micAccumulated = new Float32Array(0);

    let firstChunkLogged = false;
    micProc.onaudioprocess = (e) => {
      const inputChannelData = e.inputBuffer.getChannelData(0);
      
      // Accumulate samples
      const newLength = micAccumulated.length + inputChannelData.length;
      const newAccumulated = new Float32Array(newLength);
      newAccumulated.set(micAccumulated);
      newAccumulated.set(inputChannelData, micAccumulated.length);
      micAccumulated = newAccumulated;

      // Process complete chunks
      while (micAccumulated.length >= SAMPLES_PER_CHUNK) {
        const chunk = micAccumulated.slice(0, SAMPLES_PER_CHUNK);
        micAccumulated = micAccumulated.slice(SAMPLES_PER_CHUNK);

        // Add soft limiting
        const limited = new Float32Array(SAMPLES_PER_CHUNK);
        for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
          limited[i] = Math.tanh(chunk[i] * 0.8) * 0.95;
        }

        // Convert to PCM16
        const pcm16 = new Int16Array(SAMPLES_PER_CHUNK);
        for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, limited[i] * 32767));
        }

        // Send to WS via overlay WS
        if (wsMic) {
          wsMic.sendBinary(pcm16.buffer as ArrayBuffer);
        }

        // Log RMS and first samples for diagnostics
        const rms = calculateRMS(pcm16);
        if (!firstChunkLogged) { log('[mic] audio flow active'); firstChunkLogged = true }
        log(`[mic] Processed chunk RMS=${rms.toFixed(4)} sampleCount=${pcm16.length}`);
        console.log('[mic] First 5 samples:', pcm16.slice(0,5));

        // Store for export
        micBuffer.push(pcm16.buffer);
        if (micBuffer.length > 100) micBuffer.shift(); // ~10s
      }
    };

    micEnabled = true;
    log('[mic] Capture started');
  } catch (err) {
    console.error('[mic] Start failed:', err);
    log(`[mic] Error: ${err}`);
  }
}

// System capture
async function startSystemCapture(chatId: string) {
  // Existing native start
  await window.evia.systemAudio.start();
  
  // Listen for data
  // ipcRenderer.on('system-audio-data', (event, data) => { // This line is commented out as ipcRenderer is not defined in this file
  //   // Process like mic
  //   const audioContext = new AudioContext({ sampleRate: 16000 });
  //   // Assume data is Float32 or convert, then process
  //   const inputData = new Float32Array(data); // Adapt based on native format
  //   const int16Data = new Int16Array(inputData.length);
  //   for (let i = 0; i < inputData.length; i++) {
  //     int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
  //   }
  //   const wsSys = getWebSocketInstance(chatId, 'system');
  //   if (wsSys.isConnected()) wsSys.sendBinaryData(int16Data.buffer);
  // });

  const wsSys = getWebSocketInstance(chatId, 'system');
  wsSys.connect();
  wsSys.onMessage(handleWebSocketMessage);
}

// Start both in UI flow
// ... existing code ...

// Add handleWebSocketMessage from user's code
function handleWebSocketMessage(message: any) {
  // Logic from useWebSocketMessages.tsx
  const msgType = message.type;
  const msgData = message.data;

  if (msgType === 'transcript_segment') {
    const transcriptData = msgData;
    const speaker = transcriptData.speaker ?? -1;
    const text = transcriptData.text.trim();

    if (text) {
      transcriptLines = [...transcriptLines];
      const last = transcriptLines[transcriptLines.length - 1];
      if (transcriptData.is_final) {
        if (last && last.speaker === speaker) {
          last.text = normalizeAppend(last.text, text);
          last.isInterim = false;
        } else {
          transcriptLines.push({ speaker, text, isInterim: false });
        }
      } else {
        if (last && last.speaker === speaker) {
          last.text = normalizeAppend(last.text, text);
          last.isInterim = true;
        } else {
          transcriptLines.push({ speaker, text, isInterim: true });
        }
      }
      // Update UI with transcriptLines
    }
  } else if (msgType === 'suggestion') {
    suggestion = msgData;
    // Update UI
  } // ... other cases
}

// Generate sine wave PCM16 tone for testing
function generateSinePCM16(freqHz: number, durationMs: number, sampleRate: number, amplitude: number): Int16Array {
  const samples = Math.floor(sampleRate * durationMs / 1000)
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) {
    const s = Math.sin(2 * Math.PI * freqHz * (i / sampleRate)) * amplitude
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// Export WAV file from buffer
function exportWav(buffers: ArrayBuffer[], sampleRate: number, name: string): void {
  if (!buffers || buffers.length === 0) {
    log(`[Export] No buffers to export for ${name}`);
    return;
  }

  // Concatenate PCM16 buffers
  let totalLength = 0;
  for (const buf of buffers) totalLength += new Int16Array(buf).length;
  const combined = new Int16Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    const view = new Int16Array(buf);
    combined.set(view, offset);
    offset += view.length;
  }

  // Build WAV header (mono, 16-bit)
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = combined.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor
  view.setUint32(0, 0x52494646, false); // 'RIFF'
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // 'WAVE'

  // fmt subchunk
  view.setUint32(12, 0x666d7420, false); // 'fmt '
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat=1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data subchunk
  view.setUint32(36, 0x64617461, false); // 'data'
  view.setUint32(40, dataSize, true);

  // Combine header + data
  const wavBuffer = new Uint8Array(44 + dataSize);
  wavBuffer.set(new Uint8Array(header), 0);
  wavBuffer.set(new Uint8Array(combined.buffer), 44);

  // Download
  const blob = new Blob([wavBuffer.buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `evia-${name}-${now}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log(`[Export] Saved ${name}.wav (${(dataSize/2)|0} samples @ ${sampleRate}Hz)`);
}

// Add WAV export function
function exportMicToWAV() {
  if (pcmBuffers.mic.length === 0) {
    console.log('[Export] No mic audio data available');
    return;
  }

  // Combine all buffers
  let totalLength = 0;
  pcmBuffers.mic.forEach((buf: ArrayBuffer) => totalLength += new Int16Array(buf).length);
  
  const combined = new Int16Array(totalLength);
  let offset = 0;
  pcmBuffers.mic.forEach((buf: ArrayBuffer) => {
    const view = new Int16Array(buf);
    combined.set(view, offset);
    offset += view.length;
  });

  // Create WAV header
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  
  // RIFF header
  view.setUint32(0, 0x52494646, false); // 'RIFF'
  view.setUint32(4, 36 + totalLength * 2, true);
  view.setUint32(8, 0x57415645, false); // 'WAVE'
  
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // 'fmt '
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // 'data'
  view.setUint32(40, totalLength * 2, true);

  // Combine header and data
  const wavBuffer = new ArrayBuffer(44 + totalLength * 2);
  const wavView = new Uint8Array(wavBuffer);
  wavView.set(new Uint8Array(wavHeader), 0);
  wavView.set(new Uint8Array(combined.buffer), 44);

  // Save file
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `evia_mic_export_${new Date().toISOString()}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('[Export] Mic audio exported to WAV');
}

// Add types and function
interface TranscriptLine {
  speaker: number;
  text: string;
  isInterim?: boolean;
}

// Add normalizeAppend from user's code
function normalizeAppend(prev: string, addition: string) {
  if (!prev) return addition.trim();
  const a = addition.trim();
  if (!a) return prev;
  return /[\s]$/.test(prev) ? prev + a : prev + ' ' + a;
}

// Add stop functions
async function stopMicCapture(chatId: string) {
  if (micProc) micProc.disconnect();
  if (micCtx) await micCtx.close();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micProc = null;
  micCtx = null;
  micStream = null;
  micEnabled = false;
  
  if (chatId && wsMic) {
    wsMic.close();
    wsMic = null;
  }
  log('[mic] Stopped');
}

async function stopSystemCapture(chatId: string) {
  await window.evia.systemAudio.stop();
  const wsSys = getWebSocketInstance(chatId, 'system');
  wsSys.disconnect();
}

function exportSystemLastSeconds(seconds: number) {
  try {
    // Prefer already processed PCM16 buffers at target SAMPLE_RATE
    if (pcmBuffers && pcmBuffers.system && pcmBuffers.system.length) {
      const chunksNeeded = Math.max(1, Math.ceil(seconds / AUDIO_CHUNK_DURATION));
      const recent = pcmBuffers.system.slice(-chunksNeeded);
      let total = 0;
      for (const b of recent) total += new Int16Array(b).length;
      const combined = new Int16Array(total);
      let off = 0;
      for (const b of recent) { const v = new Int16Array(b); combined.set(v, off); off += v.length; }
      exportWav([combined.buffer], SAMPLE_RATE, `system_last_${seconds}s`);
      log(`[Export] Exported last ~${seconds}s of system audio`);
      return;
    }

    // Fallback: use systemBufferManager recent float samples (may be at input rate)
    const sysBufManager = (window as any).systemBufferManager;
    if (sysBufManager && typeof sysBufManager.getLastNSeconds === 'function') {
      const floatSamples: Float32Array = sysBufManager.getLastNSeconds(seconds);
      if (!floatSamples || floatSamples.length === 0) {
        log('[Export] No recent system audio to export');
        return;
      }
      const int16 = new Int16Array(floatSamples.length);
      for (let i = 0; i < floatSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, floatSamples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      exportWav([int16.buffer], SAMPLE_RATE, `system_last_${seconds}s_fallback`);
      log(`[Export] Exported last ${seconds}s of system audio (fallback)`);
      return;
    }

    log('[Export] No system audio buffered');
  } catch (err) {
    console.error('[Export] System WAV export failed:', err);
    log('[Export] Failed to export system WAV');
  }
}