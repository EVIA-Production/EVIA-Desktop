import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import EviaBar from "./EviaBar";
import ListenView from "./ListenView";
import AskView from "./AskView";
import SettingsView from "./SettingsView";
import ShortCutSettingsView from "./ShortCutSettingsView";
import "../overlay/overlay-glass.css";
import { getOrCreateChatId } from "../services/websocketService";
import { startAudioCapture } from "../audio-processor"; // Assume this exists or add if needed

// Types for linter
interface WsHandle {
  sendBinary: (data: ArrayBuffer) => void;
  close: () => void;
}

// Ported from Glass: Audio utilities
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1;
const BUFFER_SIZE = 4096;

// WASM AEC (port from Glass - add aec.wasm to src/renderer/assets and load)
let aecMod: any = null;
let aecPtr: number = 0;

async function getAec() {
  if (aecMod) return aecMod;
  aecMod = await (require("./assets/aec") as any)(); // Adjust path to WASM
  aecPtr = aecMod.newPtr(160, 1600, SAMPLE_RATE, 1);
  return aecMod;
}

function runAecSync(micF32: Float32Array, sysF32: Float32Array): Float32Array {
  const frameSize = 160;
  const numFrames = Math.floor(micF32.length / frameSize);
  const processedF32 = new Float32Array(micF32.length);

  const alignedSysF32 = new Float32Array(micF32.length);
  const lengthToCopy = Math.min(micF32.length, sysF32.length);
  alignedSysF32.set(sysF32.slice(0, lengthToCopy));

  for (let i = 0; i < numFrames; i++) {
    const offset = i * frameSize;
    const micFrame = micF32.subarray(offset, offset + frameSize);
    const echoFrame = alignedSysF32.subarray(offset, offset + frameSize);

    const micPtr = int16PtrFromFloat32(aecMod, micFrame);
    const echoPtr = int16PtrFromFloat32(aecMod, echoFrame);
    const outPtr = aecMod._malloc(frameSize * 2);

    aecMod.cancel(aecPtr, micPtr.ptr, echoPtr.ptr, outPtr, frameSize);

    const outFrameI16 = new Int16Array(aecMod.HEAP16.buffer, outPtr, frameSize);
    const outFrameF32 = float32FromInt16View(outFrameI16);

    processedF32.set(outFrameF32, offset);

    aecMod._free(micPtr.ptr);
    aecMod._free(echoPtr.ptr);
    aecMod._free(outPtr);
  }
  return processedF32;
}

// Helpers (from Glass)
function int16PtrFromFloat32(
  mod: any,
  f32: Float32Array
): { ptr: number; view: Int16Array } {
  const len = f32.length;
  const bytes = len * 2;
  const ptr = mod._malloc(bytes);
  const heapBuf = mod.HEAP16 ? mod.HEAP16.buffer : mod.HEAPU8.buffer;
  const i16 = new Int16Array(heapBuf, ptr, len);
  for (let i = 0; i < len; ++i) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return { ptr, view: i16 };
}

function float32FromInt16View(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; ++i) out[i] = i16[i] / 32768;
  return out;
}

function base64ToFloat32Array(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function convertFloat32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// EVIA state
let wsMic: {
  sendBinary: (data: ArrayBuffer) => void;
  close: () => void;
} | null = null;
let wsSys: {
  sendBinary: (data: ArrayBuffer) => void;
  close: () => void;
} | null = null;
let sysConnected = false;
let micDisabled = false;
let micTranscript = "";
let sysTranscript = "";
let micInterim = "";
let sysInterim = "";
let micBuffer: ArrayBuffer[] = [];
let sysBuffer: ArrayBuffer[] = [];
let sysAudioBuffer: number[] = [];
let micCtx: AudioContext | null = null;
let micProc: ScriptProcessorNode | null = null;
let micStream: MediaStream | null = null;
let micEnabled = true;
let sysIpcSubscribed = false;
let sysHelperStarted = false;
let transcriptLines: { speaker: number; text: string; isInterim?: boolean }[] =
  [];
let suggestion = "";

// UI render (basic for overlay)
const OverlayEntry: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const logRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Setup on mount
    getAec().catch(console.error);
  }, []);

  const log = (msg: string) => {
    if (logRef.current) logRef.current.value += msg + "\n";
  };

  const connect = async () => {
    // Your connect logic with Glass integration
    await getAec();
    // ... implement full connect as per previous
  };

  const handleListenClick = async () => {
    console.log("Listen button clicked");
    const chatId = await getOrCreateChatId();
    console.log(`Chat ID ${chatId ? "reused/created" : "failed"}: ${chatId}`);
    if (!chatId) return;

    // Open WS (mic-only)
    const wsUrl = `ws://localhost:8000/ws/transcribe?chat_id=${chatId}&token=${localStorage.getItem(
      "auth_token"
    )}&source=mic&dg_lang=de${
      process.env.FAST_MODE === "true" ? "&fast_mode=true" : ""
    }`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log("Mic WS opened");
      startAudioCapture((chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
          console.log(`Sent chunk size: ${chunk.byteLength}, cadence: 150ms`); // Approx log
        }
      });
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log(`Received segment: ${JSON.stringify(msg)}`);
      // Pass to ListenView for rendering (assume prop or context)
    };
    // ... error/close handling
  };

  return (
    <div>
      <button onClick={connect}>Connect</button>
      <textarea ref={logRef} readOnly />
      {/* Add full UI from Glass mapping */}
    </div>
  );
};

export default OverlayEntry;

// Handler for toggle visibility functionality
const handleToggleVisibility = async () => {
  try {
    console.log("[EviaBar] Toggling all windows visibility");

    // Try the windows.toggleAll method first
    if (
      (window.evia as any).windows &&
      (window.evia as any).windows.toggleAll
    ) {
      const result = await (window.evia as any).windows.toggleAll();
      console.log("[EviaBar] Toggle result:", result);
    } else {
      console.log("[EviaBar] Using fallback toggle implementation");

      // Use the show method on listen window to detect current state and toggle
      const listenResult = await (window.evia as any).windows.show("listen");
      console.log("[EviaBar] Listen window toggle result:", listenResult);

      if (listenResult.toggled === "shown") {
        // Windows were hidden, listen is now shown - show other windows too
        console.log("[EviaBar] Restoring all windows");
        await (window.evia as any).windows.ensureShown("ask");
        await (window.evia as any).windows.ensureShown("settings");
      } else if (listenResult.toggled === "hidden") {
        // Windows were shown, listen is now hidden - hide other windows too
        console.log("[EviaBar] Hiding all windows");
        await (window.evia as any).windows.hide("ask");
        await (window.evia as any).windows.hide("settings");
      }
    }
  } catch (e) {
    console.error("[EviaBar] Toggle visibility failed", e);
  }
};

// Mount the appropriate view based on ?view=
const params = new URLSearchParams(window.location.search);
const view = (params.get("view") || "header").toLowerCase();
const rootEl = document.getElementById("overlay-root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  switch (view) {
    case "header":
      root.render(
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={"de"}
          onToggleLanguage={() => {}}
          onToggleVisibility={handleToggleVisibility}
        />
      );
      break;
    case "listen":
      root.render(
        (
          <ListenView
            lines={[]}
            followLive={true}
            onToggleFollow={() => {}}
            onClose={() => (window.evia as any).closeWindow("listen")}
          />
        ) as any
      );
      break;
    case "ask":
      root.render((<AskView language={"de"} />) as any);
      break;
    case "settings":
      root.render(
        (<SettingsView language={"de"} onToggleLanguage={() => {}} />) as any
      );
      break;
    case "shortcuts":
      root.render((<ShortCutSettingsView />) as any);
      break;
    default:
      root.render(
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={"de"}
          onToggleLanguage={() => {}}
          onToggleVisibility={handleToggleVisibility}
        />
      );
  }
}
