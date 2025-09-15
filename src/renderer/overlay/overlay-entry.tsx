import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../overlay/overlay-tokens.css";
import EviaBar from "./EviaBar";
import ListenView from "./ListenView";
import AskView from "./AskView";
import SettingsView from "./SettingsView";
import ShortCutSettingsView from "./ShortCutSettingsView";

type View = "header" | "listen" | "ask" | "settings" | "shortcuts" | null;

const OverlayApp: React.FC = () => {
  const [view, setView] = useState<View>(() => {
    const qp = new URLSearchParams(window.location.search);
    const v = (qp.get("view") as View) || "listen";
    return v;
  });
  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [followLive, setFollowLive] = useState(true);
  const [lines, setLines] = useState<
    { speaker: number | null; text: string; isFinal?: boolean }[]
  >([]);
  const chatIdRef = useRef<string | null>(null);
  const [storageTick, setStorageTick] = useState(0);
  // Mic streaming refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  // WS handles
  const micWsRef = useRef<any | null>(null);
  const sysWsRef = useRef<any | null>(null);
  // Prevent repeated permission prompts: start system helper once per session
  const systemStartAttemptedRef = useRef(false);
  // Audio constants (component scope so helpers can access)
  const SAMPLE_RATE = 16000;
  const CHUNK_MS = 100;
  const SAMPLES_PER_CHUNK = Math.floor((SAMPLE_RATE * CHUNK_MS) / 1000);

  // AEC/system reference buffer (store PCM16 base64 @16kHz)
  // NOTE: rename from previous systemRefB64 to make semantics clearer and add rate
  const systemAudioBuffer: { data: string; timestamp: number; rate: number }[] =
    [];
  const SYSTEM_AUDIO_BUFFER_MAX = 10;
  // Alias for external integration instructions (consistency with docs/suggestions)
  const MAX_SYSTEM_BUFFER_SIZE = SYSTEM_AUDIO_BUFFER_MAX; // do not change both separately
  // Tradeoffs: retaining only ~1s of far-end reference keeps memory small and is
  // adequate for most desktop echo paths (<200ms). If future AEC needs longer
  // tail modeling we can extend or maintain a parallel circular history.

  // keep a handle to stop the loopback processor
  const winLoopStopRef = useRef<null | (() => Promise<void>)>(null);

  // ===== Shared audio helpers (will later move to audio-processing.js for unification) =====
  function resampleF32Linear(
    input: Float32Array,
    inRate: number,
    outRate: number
  ) {
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

  function f32ToPcm16(f32: Float32Array) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return i16;
  }

  function pcm16BufToB64(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }

  // Windows loopback capture with explicit 48k->16k resample and 100ms chunking
  async function startWindowsLoopbackRenderer_16kChunks(
    onChunk16k: (buf: ArrayBuffer) => void,
    onLocalRefB64: (b64: string) => void
  ) {
    const platform = navigator.platform.toLowerCase();
    if (!platform.startsWith("win")) throw new Error("Not Windows platform");

    // Revised: attempt getDisplayMedia, but also fallback if it returns no audio tracks
    let stream: MediaStream | null = null;
    try {
      console.log("[system][loopback] attempting getDisplayMedia");
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" as any },
        audio: {
          systemAudio: "include",
          suppressLocalAudioPlayback: true,
        } as any,
      } as any);
      const aTracks = s.getAudioTracks();
      if (aTracks.length > 0) {
        console.log(
          "[system][loopback] getDisplayMedia returned audio track(s)"
        );
        stream = s;
      } else {
        console.log(
          "[system][loopback] getDisplayMedia no audio → fallback planned"
        );
        try {
          s.getTracks().forEach((t) => t.stop());
        } catch {}
      }
    } catch (e) {
      console.warn("[system][loopback] getDisplayMedia threw →", e);
    }
    if (!stream) {
      console.log("[system][loopback] invoking fallback desktopCapturer path");
      const res = await (window as any).evia?.systemAudio?.getSources?.();
      const chosen = res?.sources?.[0];
      if (!chosen) throw new Error("No desktop source for loopback");
      console.log(
        "[system][loopback] chosen source id=",
        chosen?.id,
        "name=",
        chosen?.name
      );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: chosen.id,
          },
        } as any,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: chosen.id,
          },
        } as any,
      } as any);
      console.log("[system][loopback] fallback getUserMedia obtained stream");
    }
    // At this point stream must be non-null
    const streamNonNull = stream as MediaStream;

    const a = streamNonNull.getAudioTracks();
    if (!a.length) {
      streamNonNull.getTracks().forEach((t) => t.stop());
      throw new Error("No loopback audio track");
    }
    // Log track label for diagnostics
    try {
      console.log("[system] track label =", a[0]?.label || "(none)");
    } catch {}
    const lbl = (a[0].label || "").toLowerCase();
    if (/mic|microphone/.test(lbl)) {
      streamNonNull.getTracks().forEach((t) => t.stop());
      throw new Error("Got microphone instead of loopback");
    }

    const IN_RATE = 48000; // typical display / system capture
    const OUT_RATE = 16000;
    const OUT_SAMPLES_PER_CHUNK = 1600; // 100ms @16k

    const ctx = new AudioContext({ sampleRate: IN_RATE });
    await ctx.resume();
    const src = ctx.createMediaStreamSource(streamNonNull);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    src.connect(proc);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    proc.connect(mute);
    mute.connect(ctx.destination);

    let acc16k = new Float32Array(0);

    proc.onaudioprocess = (e) => {
      try {
        const chs = e.inputBuffer.numberOfChannels;
        let mono: Float32Array;
        if (chs > 1) {
          const len = e.inputBuffer.getChannelData(0).length;
          mono = new Float32Array(len);
          for (let c = 0; c < chs; c++) {
            const cd = e.inputBuffer.getChannelData(c);
            for (let i = 0; i < len; i++) mono[i] += cd[i];
          }
          for (let i = 0; i < mono.length; i++) mono[i] /= chs;
        } else {
          mono = e.inputBuffer.getChannelData(0).slice();
        }
        // Resample newly arrived 48k mono to 16k
        const resampled = resampleF32Linear(mono, IN_RATE, OUT_RATE);
        const next = new Float32Array(acc16k.length + resampled.length);
        next.set(acc16k, 0);
        next.set(resampled, acc16k.length);
        acc16k = next;

        while (acc16k.length >= OUT_SAMPLES_PER_CHUNK) {
          const outChunk = acc16k.slice(0, OUT_SAMPLES_PER_CHUNK);
          acc16k = acc16k.slice(OUT_SAMPLES_PER_CHUNK);
          const i16 = f32ToPcm16(outChunk);
          // Once per second peak metric (lightweight)
          try {
            const nowSec = (Date.now() / 1000) | 0;
            if (nowSec !== (window as any).__eviaLastSysPeakLogSec) {
              (window as any).__eviaLastSysPeakLogSec = nowSec;
              const sliceLen = Math.min(2048, i16.length);
              let peak = 0;
              for (let i = 0; i < sliceLen; i++) {
                const v = i16[i];
                const av = v < 0 ? -v : v;
                if (av > peak) peak = av;
              }
              console.log("[system] peek(i16)=", peak);
            }
          } catch {}
          onChunk16k(i16.buffer);
          onLocalRefB64(pcm16BufToB64(i16.buffer));
        }
      } catch (err) {
        console.warn("[overlay][loopback16k] processing error", err);
      }
    };

    return async () => {
      try {
        proc.disconnect();
      } catch {}
      try {
        src.disconnect();
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        await ctx.close();
      } catch {}
    };
  }

  // Load initial language from prefs/localStorage
  useEffect(() => {
    (async () => {
      try {
        const prefLang = (await (window as any).evia?.prefs?.get?.())?.prefs
          ?.language;
        const lsLang = window.localStorage.getItem("dg_lang");
        const initial =
          prefLang === "en" || prefLang === "de"
            ? prefLang
            : lsLang === "en" || lsLang === "de"
            ? lsLang
            : null;
        if (initial && initial !== language) {
          console.log(
            "[overlay] init language from prefs/localStorage →",
            initial
          );
          setLanguage(initial as "en" | "de");
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist language changes
  useEffect(() => {
    try {
      window.localStorage.setItem("dg_lang", language);
    } catch {}
    try {
      (window as any).evia?.prefs?.set?.({ language });
    } catch {}
    console.log("[overlay] language set →", language);
  }, [language]);

  useEffect(() => {
    // Only connect WS and start streaming in the listen window
    const qp = new URLSearchParams(window.location.search);
    const currentView = (qp.get("view") as View) || "listen";
    if (currentView !== "listen") return;

    // Prefer prefs current_chat_id; fallback to localStorage (refresh in IIFE)
    let cid = window.localStorage.getItem("current_chat_id") || null;
    chatIdRef.current = cid;

    // Wrap async logic
    let handleMic: any | null = null;
    let handleSys: any | null = null;
    (async () => {
      // Try to refresh cid from prefs if available; if still missing, bail
      try {
        const respCid = await (window as any).evia?.prefs?.get?.();
        const fromPrefsCid = respCid?.prefs?.current_chat_id;
        if (fromPrefsCid) {
          chatIdRef.current = String(fromPrefsCid);
          cid = chatIdRef.current;
        }
      } catch {}
      if (!cid) {
        console.warn("[overlay] No current_chat_id; skipping WS connect");
        return;
      }
      // Prefer prefs JWT; fallback to localStorage
      let token: string | null = null;
      try {
        const resp = await (window as any).evia?.prefs?.get?.();
        const fromPrefs = resp?.prefs?.auth_token;
        token = fromPrefs || window.localStorage.getItem("auth_token");
      } catch {
        token = window.localStorage.getItem("auth_token");
      }
      if (!token) {
        console.warn("[overlay] No auth token; skipping WS connect");
        return;
      }

      const httpBase =
        (window as any).EVIA_BACKEND_URL ||
        (window as any).API_BASE_URL ||
        window.localStorage.getItem("evia_backend") ||
        "http://localhost:8000";
      const wsBase = httpBase.replace(/^http/, "ws").replace(/\/$/, "");

      const w: any = window as any;
      if (!(w.evia && typeof w.evia.createWs === "function")) return;

      // Helper: parse incoming WS messages
      const onWsMessage = (data: any) => {
        try {
          const msg = typeof data === "string" ? JSON.parse(data) : data;
          if (msg && msg.type === "transcript_segment" && msg.data) {
            const d = msg.data as any;
            setLines((prev) => [
              ...prev,
              {
                speaker: typeof d.speaker === "number" ? d.speaker : null,
                text: String(d.text || ""),
                isFinal: !!d.is_final,
              },
            ]);
          } else if (msg && msg.type === "status" && msg.data) {
            const d = msg.data as any;
            if (typeof d.echo_text === "string") {
              setLines((prev) => [
                ...prev,
                { speaker: null, text: String(d.echo_text), isFinal: true },
              ]);
            }
          }
        } catch {
          /* ignore */
        }
      };

      // Open system WS and stream system audio
      try {
        const urlSys = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(
          cid
        )}&token=${encodeURIComponent(
          token
        )}&source=system&sample_rate=${SAMPLE_RATE}&debug=1&dg_lang=${language}`;
        handleSys = w.evia.createWs(urlSys);
        sysWsRef.current = handleSys;
        handleSys.onOpen?.(async () => {
          console.log("[listen] WS open (system) for chat", cid);
          if (!systemStartAttemptedRef.current) {
            systemStartAttemptedRef.current = true;
            try {
              await w.evia.systemAudio.start();
            } catch {}
          }
          // Attempt Windows renderer loopback capture
          try {
            const stop = await startWindowsLoopbackRenderer_16kChunks(
              (buf) => {
                try {
                  sysWsRef.current?.sendBinary(buf);
                } catch {}
              },
              (b64) => {
                // Store latest system chunk for AEC reference (rate fixed @16k)
                systemAudioBuffer.push({
                  data: b64,
                  timestamp: Date.now(),
                  rate: 16000,
                });
                if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
                  systemAudioBuffer.splice(
                    0,
                    systemAudioBuffer.length - MAX_SYSTEM_BUFFER_SIZE
                  );
                }
              }
            );
            winLoopStopRef.current = stop;
            console.log("[listen] Windows loopback active");
          } catch (e) {
            console.warn("[listen] windows loopback failed:", e);
          }
        });
        // Forward system audio frames
        try {
          w.evia.systemAudio.onData((frame: any) => {
            const ab = toArrayBuffer(frame);
            if (ab && sysWsRef.current) {
              try {
                sysWsRef.current.sendBinary(ab);
              } catch {}
            }
          });
          w.evia.systemAudio.onStatus((line: string) => {
            if (line)
              setLines((prev) => [
                ...prev,
                { speaker: null, text: String(line), isFinal: true },
              ]);
          });
        } catch {}
        handleSys.onMessage(onWsMessage);
        handleSys.onError?.(() => {
          console.warn("[listen] WS error (system)");
        });
        handleSys.onClose?.(() => {
          console.log("[listen] WS closed (system)");
        });
      } catch {
        /* ignore */
      }

      // Open mic WS and stream mic audio
      try {
        const urlMic = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(
          cid
        )}&token=${encodeURIComponent(
          token
        )}&source=mic&sample_rate=${SAMPLE_RATE}&dg_lang=${language}`;
        handleMic = w.evia.createWs(urlMic);
        micWsRef.current = handleMic;
        handleMic.onOpen?.(async () => {
          console.log("[listen] WS open (mic) for chat", cid);
          try {
            await startMicStreaming((buffer: ArrayBuffer) => {
              if (micWsRef.current) {
                try {
                  micWsRef.current.sendBinary(buffer);
                } catch {}
              }
            });
          } catch (e) {
            console.warn("[listen] mic start failed", e);
          }
        });
        handleMic.onMessage(onWsMessage);
        handleMic.onError?.(() => {
          console.warn("[listen] WS error (mic)");
        });
        handleMic.onClose?.(() => {
          console.log("[listen] WS closed (mic)");
        });
      } catch {
        /* ignore */
      }
    })();

    return () => {
      // 1) Stop capturing audio first
      try {
        stopMicRef.current?.();
      } catch {}
      stopMicRef.current = null;

      // stop renderer-side Windows loopback (AudioContext/stream)
      try {
        winLoopStopRef.current?.();
      } catch {}
      winLoopStopRef.current = null;

      // stop main helper (no-op on Windows if you wired it that way)
      try {
        (window as any).evia?.systemAudio?.stop?.();
      } catch {}

      // 2) Now close the websockets
      try {
        micWsRef.current?.close?.();
      } catch {}
      try {
        sysWsRef.current?.close?.();
      } catch {}
      micWsRef.current = null;
      sysWsRef.current = null;
    };
  }, [language, storageTick]);

  // React to storage changes (token/chat id updates from header window)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "current_chat_id" || e.key === "auth_token") {
        setStorageTick((t) => t + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Utilities
  function toArrayBuffer(data: any): ArrayBuffer | null {
    try {
      if (!data) return null;
      if (data instanceof ArrayBuffer) return data;
      if (
        typeof data?.buffer?.slice === "function" &&
        data.buffer instanceof ArrayBuffer
      ) {
        // TypedArray
        const u8 = new Uint8Array(
          data.buffer,
          data.byteOffset || 0,
          data.byteLength || data.length || 0
        );
        return u8.slice().buffer;
      }
      if (typeof data === "string") {
        // assume base64
        const bin = atob(data);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8.buffer;
      }
    } catch {}
    return null;
  }

  async function startMicStreaming(onChunk: (buf: ArrayBuffer) => void) {
    // Request mic (enable EC/NS/AGC like the working branch)
    // Primary constraints (enhanced) with fallback minimal request to recover from NotAllowedError
    const primaryConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: SAMPLE_RATE },
        channelCount: { ideal: 1 },
      } as any,
      video: false,
    };
    const fallbackConstraints: MediaStreamConstraints = {
      audio: true,
      video: false,
    };
    let stream: MediaStream | null = null;
    let primaryError: any = null;
    try {
      console.log("[mic] requesting getUserMedia(primary)");
      stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
    } catch (err) {
      primaryError = err;
      console.warn("[mic] primary getUserMedia failed →", err);
      if (err && (err as any).name === "NotAllowedError") {
        try {
          console.log("[mic] retrying getUserMedia(minimal)");
          stream = await navigator.mediaDevices.getUserMedia(
            fallbackConstraints
          );
        } catch (err2) {
          console.warn("[mic] minimal getUserMedia failed →", err2);
          try {
            setLines((prev) => [
              ...prev,
              {
                speaker: null,
                text: "[mic] permission denied. Enable microphone access in system privacy settings & restart.",
                isFinal: true,
              },
            ]);
          } catch {}
          throw err2;
        }
      } else {
        throw err;
      }
    }
    if (!stream) throw primaryError || new Error("Mic stream unavailable");
    console.log(
      "[mic] stream acquired. tracks=",
      stream.getAudioTracks().length
    );
    try {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        const inputs = devs.filter((d) => d.kind === "audioinput");
        console.log(
          "[mic] devices after permission:",
          inputs.map((d) => ({ id: d.deviceId, label: d.label }))
        );
      });
    } catch {}
    micStreamRef.current = stream;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)(
      { sampleRate: SAMPLE_RATE }
    );
    micAudioContextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    micProcessorRef.current = processor;

    // route through zero gain to keep processor running without audio out
    const zero = ctx.createGain();
    zero.gain.value = 0.0;
    processor.connect(zero);
    zero.connect(ctx.destination);
    source.connect(processor);

    let acc = new Float32Array(0);
    // AEC configuration
    const enableAec = true; // set false to disable quickly
    const AEC_TARGET_RATE = 16000; // adjust if your AEC lib expects different
    const FRAME_SIZE_10MS = 160; // 10ms @16k
    // Framing rationale: 10ms is standard for WebRTC / most AEC DSP. We still
    // batch 100ms to transport (bandwidth & WS overhead) but internally slice
    // to enable rapid substitution of a real AEC without further refactors.

    // Import unified helpers dynamically (already loaded in main renderer elsewhere)
    // We defensively access window import if bundler tree-shakes; fallback to local lightweight versions
    let unifiedResample = (window as any).eviaResampleAudio as
      | ((a: Float32Array, i: number, o: number) => Float32Array)
      | undefined;
    let unifiedSlice = (window as any).eviaSliceIntoFrames as
      | ((a: Float32Array, f: number) => Float32Array[])
      | undefined;
    if (!unifiedResample || !unifiedSlice) {
      try {
        // dynamic import same file path pattern as other renderer modules
        // @ts-ignore
        // eslint-disable-next-line
        const ap = await import("../audio-processing.js");
        unifiedResample = ap.resampleAudio;
        unifiedSlice = ap.sliceIntoFrames;
        // expose for any later callers
        (window as any).eviaResampleAudio = unifiedResample;
        (window as any).eviaSliceIntoFrames = unifiedSlice;
      } catch {
        /* keep fallback */
      }
    }

    function linearResample(
      src: Float32Array,
      srcRate: number,
      dstRate: number
    ): Float32Array {
      // Deprecated path; prefer unifiedResample
      if (unifiedResample) return unifiedResample(src, srcRate, dstRate);
      if (srcRate === dstRate) return src as Float32Array;
      const ratio = dstRate / srcRate;
      const outLen = Math.max(1, Math.round(src.length * ratio));
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(src.length - 1, i0 + 1);
        const t = pos - i0;
        out[i] = src[i0] * (1 - t) + src[i1] * t;
      }
      return out as Float32Array;
    }

    // Placeholder AEC routine – replace with actual implementation
    function runAecSync(mic: Float32Array, ref: Float32Array): Float32Array {
      // Placeholder: future implementation should operate internally on 160-sample (10ms @16k) frames.
      // For now passthrough. Keep signature so we can drop in real AEC easily.
      return mic as Float32Array;
    }

    processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      if (
        micStreamRef.current &&
        micStreamRef.current
          .getAudioTracks()
          .some((t) => t.readyState === "ended")
      ) {
        console.warn("[mic] track ended unexpectedly");
      }
      // accumulate
      const next = new Float32Array(acc.length + input.length);
      next.set(acc, 0);
      next.set(input, acc.length);
      acc = next;

      // process as many whole 100ms chunks as available (1600 samples @16k)
      while (acc.length >= SAMPLES_PER_CHUNK) {
        const micF32 = acc.slice(0, SAMPLES_PER_CHUNK);
        acc = acc.slice(SAMPLES_PER_CHUNK);

        // Build latest system reference Float32 (already 16k PCM16 base64)
        let sysF32 = new Float32Array(0);
        if (enableAec && systemAudioBuffer.length) {
          try {
            const latest = systemAudioBuffer[systemAudioBuffer.length - 1];
            const bin = atob(latest.data);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < u8.length; i++) u8[i] = bin.charCodeAt(i);
            const refI16 = new Int16Array(u8.buffer);
            sysF32 = Float32Array.from(refI16, (v) => v / 32768);
            const refRate = latest.rate || AEC_TARGET_RATE;
            if (refRate !== AEC_TARGET_RATE) {
              sysF32 = (
                (unifiedResample || linearResample)(
                  sysF32,
                  refRate,
                  AEC_TARGET_RATE
                ) as Float32Array
              ).slice();
            }
          } catch (e) {
            console.warn("[aec] reference decode failed", e);
            sysF32 = new Float32Array(0);
          }
        }

        // Run AEC at 16k over entire 100ms chunk (internally can frame at 160 samples later)
        const cleanedF32 = enableAec ? runAecSync(micF32, sysF32) : micF32;

        // Convert cleaned Float32 -> PCM16
        const pcm16 = new Int16Array(cleanedF32.length);
        for (let i = 0; i < cleanedF32.length; i++) {
          const s = Math.max(-1, Math.min(1, cleanedF32[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        onChunk(pcm16.buffer);
      }
    };

    stopMicRef.current = () => {
      try {
        processor.disconnect();
      } catch {}
      try {
        source.disconnect();
      } catch {}
      try {
        zero.disconnect();
      } catch {}
      try {
        ctx.close();
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      micProcessorRef.current = null;
      micAudioContextRef.current = null;
      micStreamRef.current = null;
    };
  }

  if (view === "header") {
    const [current, setCurrent] = useState<
      "listen" | "ask" | "settings" | "shortcuts" | null
    >(null);
    return (
      <div
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          pointerEvents: "auto",
        }}
        onMouseDown={async (e) => {
          try {
            const pos = await (
              window as any
            ).evia?.windows?.getHeaderPosition?.();
            const startX = e.screenX;
            const startY = e.screenY;
            const baseX = pos?.x ?? 0;
            const baseY = pos?.y ?? 0;
            const onMove = (ev: MouseEvent) => {
              const nx = baseX + (ev.screenX - startX);
              const ny = baseY + (ev.screenY - startY);
              (window as any).evia?.windows?.moveHeaderTo?.(nx, ny);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove, true);
              window.removeEventListener("mouseup", onUp, true);
            };
            window.addEventListener("mousemove", onMove, true);
            window.addEventListener("mouseup", onUp, true);
          } catch {}
        }}
      >
        <EviaBar
          currentView={current}
          onViewChange={(next) => setCurrent(next)}
          isListening={isListening}
          onToggleListening={() => setIsListening((v) => !v)}
          language={language}
          onToggleLanguage={() =>
            setLanguage((prev) => (prev === "de" ? "en" : "de"))
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 20,
        top: 80,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        pointerEvents: "auto",
      }}
    >
      {view === "listen" && (
        <ListenView
          lines={lines}
          followLive={followLive}
          onToggleFollow={() => setFollowLive((v) => !v)}
        />
      )}
      {view === "ask" && <AskView language={language} />}
      {view === "settings" && (
        <SettingsView
          language={language}
          onToggleLanguage={() =>
            setLanguage((prev) => (prev === "de" ? "en" : "de"))
          }
        />
      )}
      {view === "shortcuts" && <ShortCutSettingsView />}
    </div>
  );
};

const mount = () => {
  const el = document.getElementById("overlay-root");
  if (!el) return;
  const root = createRoot(el);
  root.render(<OverlayApp />);
};

mount();
