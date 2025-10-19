// Helper to trigger the native Windows screen-picker with "Share system audio" option.
// It requests a display media stream (video+audio) and immediately stops it.
// Use this inside a trusted user gesture (e.g., button click) so the browser shows the picker.
export async function requestWindowsSystemAudioPermissionOnce(): Promise<boolean> {
  const isWindows =
    !!(window as any).evia?.isWindows ||
    (window as any).evia?.platform === "win32";
  if (!isWindows) return false;

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    } as any);
    // Immediately stop all tracks; this is just a permission/picker handshake
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    return true;
  } catch (err) {
    console.warn(
      "requestWindowsSystemAudioPermissionOnce: user cancelled or failed",
      err
    );
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    return false;
  }
}

// ---------------------------------------------------------------------------
// Windows capture (Glass parity): mic via getUserMedia, system via getDisplayMedia
// Sends 24kHz, 100ms chunks to backend using websocketService just like mac.
// No WASAPI loopback or chromeMediaSource. Strictly use browser APIs.
// ---------------------------------------------------------------------------

import {
  getWebSocketInstance,
  getOrCreateChatId,
  closeWebSocketInstance,
} from "../../services/websocketService";

const WIN_SAMPLE_RATE = 24000; // match mac/glass pipeline
const WIN_BUFFER_SIZE = 2048;
const WIN_CHUNK_DURATION_S = 0.1; // 100ms
const WIN_SAMPLES_PER_CHUNK = Math.floor(
  WIN_SAMPLE_RATE * WIN_CHUNK_DURATION_S
); // 2400

let winMicCtx: AudioContext | null = null;
let winMicProc: ScriptProcessorNode | null = null;
let winMicStream: MediaStream | null = null;
let winMicWs: any = null;

let winSysCtx: AudioContext | null = null;
let winSysProc: ScriptProcessorNode | null = null;
let winSysStream: MediaStream | null = null;
let winSysWs: any = null;

function f32ToI16(buf: Float32Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return out;
}

function makeMono(inputBuffer: AudioBuffer): Float32Array {
  const chs = inputBuffer.numberOfChannels;
  const len = inputBuffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const cd = inputBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += cd[i];
  }
  if (chs > 1) for (let i = 0; i < len; i++) mono[i] /= chs;
  return mono;
}

function resampleLinear(
  input: Float32Array,
  inRate: number,
  outRate: number
): Float32Array {
  if (inRate === outRate) return input;
  const ratio = outRate / inRate;
  const out = new Float32Array(Math.floor(input.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i / ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(x0 + 1, input.length - 1);
    const t = x - x0;
    out[i] = input[x0] * (1 - t) + input[x1] * t;
  }
  return out;
}

/**
 * Start Windows mic+system capture and stream to backend.
 * Returns a stop function. Only runs on Windows.
 */
export async function startWindowsCapture(
  includeSystemAudio = true,
  opts?: { sourceId?: string }
): Promise<() => Promise<void>> {
  const IS_WINDOWS =
    !!(window as any).evia?.isWindows ||
    (window as any).evia?.platform === "win32";
  if (!IS_WINDOWS) throw new Error("Not Windows");

  // Ensure chat + WS
  const backend = (window as any).EVIA_BACKEND_URL || "http://localhost:8000";
  const token = await (window as any).evia?.auth?.getToken?.();
  if (!token) throw new Error("Missing auth token");
  const chatId = await getOrCreateChatId(backend, token);

  // MIC
  winMicWs = getWebSocketInstance(chatId, "mic");
  await winMicWs.connect();
  // Forward transcript/status to Listen window (tag as mic)
  if (winMicWs && typeof winMicWs.onMessage === "function") {
    winMicWs.onMessage((msg: any) => {
      if (msg?.type === "transcript_segment" || msg?.type === "status") {
        try {
          (window as any).evia?.ipc?.send?.("transcript-message", {
            ...msg,
            _source: "mic",
          });
        } catch {}
      }
    });
  }
  winMicStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
      sampleRate: WIN_SAMPLE_RATE,
      autoGainControl: true,
    } as MediaTrackConstraints,
    video: false,
  });
  winMicCtx = new AudioContext({ sampleRate: WIN_SAMPLE_RATE });
  const micSrc = winMicCtx.createMediaStreamSource(winMicStream);
  winMicProc = winMicCtx.createScriptProcessor(WIN_BUFFER_SIZE, 1, 1);
  let micBuf: number[] = [];
  winMicProc.onaudioprocess = (e: AudioProcessingEvent) => {
    const inRate = winMicCtx!.sampleRate;
    const mono = makeMono(e.inputBuffer);
    const rs = resampleLinear(mono, inRate, WIN_SAMPLE_RATE);
    for (let i = 0; i < rs.length; i++) micBuf.push(rs[i]);
    while (micBuf.length >= WIN_SAMPLES_PER_CHUNK) {
      const chunk = micBuf.splice(0, WIN_SAMPLES_PER_CHUNK);
      const i16 = f32ToI16(new Float32Array(chunk));
      try {
        winMicWs.sendBinaryData(i16.buffer);
      } catch (err) {
        console.warn("Mic WS send failed", err);
      }
    }
  };
  micSrc.connect(winMicProc);
  winMicProc.connect(winMicCtx.destination);
  if (winMicCtx.state === "suspended") await winMicCtx.resume();

  // SYSTEM via getDisplayMedia
  if (includeSystemAudio) {
    try {
      if (opts?.sourceId) {
        // Custom picker via chromeMediaSource on Windows (Electron Chromium)
        winSysStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: opts.sourceId,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: opts.sourceId,
            },
          },
        } as any);
      } else {
        // Fallback to native picker
        winSysStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        } as any);
      }
      // Stop video tracks to reduce load
      winSysStream.getVideoTracks().forEach((t) => t.stop());

      // Ensure WS
      winSysWs = getWebSocketInstance(chatId, "system");
      await winSysWs.connect();
      // Forward transcript/status to Listen window (tag as system)
      if (winSysWs && typeof winSysWs.onMessage === "function") {
        winSysWs.onMessage((msg: any) => {
          if (msg?.type === "transcript_segment" || msg?.type === "status") {
            try {
              (window as any).evia?.ipc?.send?.("transcript-message", {
                ...msg,
                _source: "system",
              });
            } catch {}
          }
        });
      }

      winSysCtx = new AudioContext({ sampleRate: WIN_SAMPLE_RATE });
      const sysSrc = winSysCtx.createMediaStreamSource(winSysStream);
      winSysProc = winSysCtx.createScriptProcessor(WIN_BUFFER_SIZE, 2, 1); // accept stereo
      let sysBuf: number[] = [];
      winSysProc.onaudioprocess = (e: AudioProcessingEvent) => {
        const inRate = winSysCtx!.sampleRate;
        const mono = makeMono(e.inputBuffer);
        const rs = resampleLinear(mono, inRate, WIN_SAMPLE_RATE);
        for (let i = 0; i < rs.length; i++) sysBuf.push(rs[i]);
        while (sysBuf.length >= WIN_SAMPLES_PER_CHUNK) {
          const chunk = sysBuf.splice(0, WIN_SAMPLES_PER_CHUNK);
          const i16 = f32ToI16(new Float32Array(chunk));
          try {
            winSysWs.sendBinaryData(i16.buffer);
          } catch (err) {
            console.warn("System WS send failed", err);
          }
        }
      };
      sysSrc.connect(winSysProc);
      // Mute path
      const mute = winSysCtx.createGain();
      mute.gain.value = 0;
      winSysProc.connect(mute);
      mute.connect(winSysCtx.destination);
      if (winSysCtx.state === "suspended") await winSysCtx.resume();
    } catch (err) {
      console.warn(
        "Windows getDisplayMedia (system audio) failed or was cancelled",
        err
      );
    }
  }

  // Notify listen timer
  try {
    (window as any).evia?.ipc?.send?.("transcript-message", {
      type: "recording_started",
    });
  } catch {}

  return async () => {
    await stopWindowsCapture();
  };
}

export async function stopWindowsCapture(): Promise<void> {
  const backend = (window as any).EVIA_BACKEND_URL || "http://localhost:8000";
  const chatId = localStorage.getItem("current_chat_id") || "";

  try {
    if (winMicProc) {
      try {
        winMicProc.disconnect();
      } catch {}
      winMicProc = null;
    }
    if (winMicCtx) {
      try {
        await winMicCtx.close();
      } catch {}
      winMicCtx = null;
    }
    if (winMicStream) {
      try {
        winMicStream.getTracks().forEach((t) => t.stop());
      } catch {}
      winMicStream = null;
    }
    if (winMicWs) {
      try {
        closeWebSocketInstance(chatId, "mic");
      } catch {}
      winMicWs = null;
    }

    if (winSysProc) {
      try {
        winSysProc.disconnect();
      } catch {}
      winSysProc = null;
    }
    if (winSysCtx) {
      try {
        await winSysCtx.close();
      } catch {}
      winSysCtx = null;
    }
    if (winSysStream) {
      try {
        winSysStream.getTracks().forEach((t) => t.stop());
      } catch {}
      winSysStream = null;
    }
    if (winSysWs) {
      try {
        closeWebSocketInstance(chatId, "system");
      } catch {}
      winSysWs = null;
    }
  } finally {
    try {
      (window as any).evia?.ipc?.send?.("transcript-message", {
        type: "recording_stopped",
      });
    } catch {}
  }
}
