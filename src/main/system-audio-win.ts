// src/renderer/system-audio-win.ts
export async function startWindowsLoopback(
  wsSendBinary: (buf: ArrayBuffer) => void,
  pushLocalRef: (b64pcm16: string) => void
) {
  // 1) Try Chromium system audio, fallback to desktopCapturer source
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" as any },
      audio: {
        systemAudio: "include",
        suppressLocalAudioPlayback: true,
      } as any,
    } as any);
  } catch {
    const res = await (window as any).evia.systemAudio.getSources();
    if (!res?.ok || !res?.sources?.length)
      throw new Error("No desktop sources");
    const chosen = res.sources[0]; // or prompt user
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
  }

  const tracks = stream.getAudioTracks();
  if (!tracks.length) throw new Error("No audio track in loopback stream");
  const lbl = (tracks[0].label || "").toLowerCase();
  if (/mic|microphone/.test(lbl)) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Got microphone instead of loopback");
  }

  // 2) Capture without playing out
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  src.connect(proc);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  proc.connect(mute);
  mute.connect(ctx.destination);

  const f32ToPcm16B64 = (f32: Float32Array) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(i16.buffer);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  };

  proc.onaudioprocess = (e) => {
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

    // (A) send to WS as PCM16
    const i16 = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i++) {
      const s = Math.max(-1, Math.min(1, mono[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    wsSendBinary(i16.buffer);

    // (B) ALSO feed local AEC reference (b64 PCM16) so your mic side can subtract it
    const b64 = f32ToPcm16B64(mono);
    pushLocalRef(b64);
  };

  return {
    stop: async () => {
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
    },
  };
}
