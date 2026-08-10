/**
 * Acoustic echo cancellation with WebRTC AEC3.
 *
 * WHY THIS REPLACED SPEEX
 * -----------------------
 * The previous canceller was a Speex WASM blob with no source in the repo and
 * three exported symbols. Driven offline against a synthetic echo whose delay
 * was known exactly, it produced *identical* output at 0ms, 60ms and 150ms of
 * echo delay and at 1600 and 7080 taps - which is only possible if its filter
 * never adapted to the reference at all - while attenuating the near end by
 * 9.6dB. It removed none of the echo and damaged the rep's voice, so the
 * signal handed to the recogniser had a WORSE echo-to-speech ratio than the raw
 * microphone. That is a mechanism for the far end being transcribed in place of
 * the rep, which is what the transcripts showed.
 *
 * AEC3 is the canceller Chromium ships. Measured on the same bench, at the same
 * rate, through this same wrapper, it cancels 20dB at 60ms and its results
 * differ across delays - the signature of a filter that is actually adapting.
 * `tools/aec-bench.cjs` is that measurement and it gates every change here.
 *
 * WHAT THIS WRAPPER IS RESPONSIBLE FOR
 * ------------------------------------
 * AEC3 runs at 48kHz internally; the pipeline runs at 24kHz. The port resamples
 * both ways, so this wrapper's job is only to hand it matched 10ms frames of
 * render and capture, in that order, and to keep the streams contiguous across
 * calls. AEC3 finds the acoustic delay itself and tracks it as it changes; the
 * caller's job is to supply a reference whose alignment is *causal* (see
 * `aec-reference.ts`), not to pre-compensate the delay.
 *
 * DO NOT USE THE PORT'S `pre` OPTION. MEASURED, NOT SUSPECTED.
 * ------------------------------------------------------------
 * The port offers a `pre` buffer that promises the input after resampling but
 * before cancellation - exactly the baseline telemetry wants. Asking for it
 * silently destroys the output: measured on a silent reference, where the
 * correct answer is "unchanged", the output drops by 14.7dB with `pre` and by
 * 0.5dB without it.
 *
 * The mechanism, so nobody re-adds it hoping it was a fluke: `pre` is filled by
 * a second call to the port's `abCopyOut`, which is WebRTC's
 * `AudioBuffer::CopyTo`, which runs a STATEFUL `PushSincResampler` on the way
 * from 48kHz down to the stream rate. Calling it twice per frame advances that
 * resampler's history twice over one block, so the real output is computed from
 * corrupted state. It is only safe when no resampling happens at all, which is
 * never our case.
 *
 * The bench gets its baseline instead by running the same audio through a
 * second canceller against a SILENT reference - same code path, same resampler,
 * nothing to cancel - which costs a little CPU offline and nothing in
 * production. `tools/aec-bench.cjs` pins this so a regression is loud.
 */

// MUST stay above the package import: it declares a global the package assigns
// to on its first line, which is a ReferenceError under ES module strict mode.
import { AEC3_UMD_GLOBAL_DECLARED } from './aec3-umd-global';
import WebRtcAec3 from '@ennuicastr/webrtcaec3.js';

/** The pipeline's capture rate. */
export const AEC3_STREAM_RATE = 24_000;

/**
 * AEC3's own rate. The port supports 32kHz and 48kHz; 48kHz is the rate WebRTC
 * itself uses and the one the port's author recommends. Our streams are 24kHz
 * so nothing above 12kHz exists to preserve - this is about matching the rate
 * AEC3's internals are tuned for, not about bandwidth.
 */
export const AEC3_INTERNAL_RATE = 48_000;

/** AEC3 consumes 10ms at a time. 240 samples at 24kHz, and 2400 % 240 === 0. */
export const AEC3_FRAME_MS = 10;

export interface Aec3Options {
  /** Rate of the audio handed to `process`, and of the audio returned. */
  streamRate?: number;
  /** Rate AEC3 runs at internally. */
  internalRate?: number;
  /**
   * WASM bytes. The renderer supplies these from a base64 module because a
   * packaged Electron app cannot fetch a sibling .wasm over file://. Node
   * (the bench) omits it and lets emscripten read the file from node_modules;
   * the bench asserts the two are byte-identical so this difference cannot
   * hide a version skew.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Injection point for the module factory, so the bench can load it its own way. */
  loadModule?: (config: Record<string, unknown>) => Promise<any>;
}

/**
 * Algorithmic delay through the canceller, in samples at the stream rate.
 *
 * Measured with an impulse: in at sample 24000, out at 24239. It is the
 * resampler pair's group delay, and it is constant. Telemetry that compares the
 * output against the raw microphone must shift by this much or it will compare
 * two signals 10ms apart and report a delay that is not there.
 */
export const AEC3_ALGORITHMIC_DELAY_SAMPLES = 239;

/**
 * Largest render-to-capture lag AEC3 still finds, in ms.
 *
 * Measured, not quoted: full cancellation at 60, 100, 150, 200, 250, 300, 350,
 * 400 and 500ms of lag, collapsing to ~3dB by 650ms. Telemetry searches this
 * far so that a reference which has slipped outside AEC3's reach shows up as a
 * delay reading rather than as an unexplained loss of cancellation.
 */
export const AEC3_MAX_TRACKABLE_DELAY_MS = 500;

type Aec3Instance = {
  analyze: (data: Float32Array[], opts?: Record<string, unknown>) => void;
  processSize: (data: Float32Array[], opts?: Record<string, unknown>) => number;
  process: (out: Float32Array[], data: Float32Array[], opts?: Record<string, unknown>) => void;
  setAudioBufferDelay: (delayMs: number) => void;
  free: () => void;
};

/**
 * Load the module factory in a way that survives both environments.
 *
 * Two things were established by inspecting the built bundle rather than by
 * reasoning about it, because both fail only at runtime:
 *
 *   - A bare `require` compiles fine and ships the literal call into the
 *     renderer bundle, where `require` does not exist. Every build and every
 *     test passes and the canceller never loads.
 *   - A dynamic `import()` becomes a separate chunk that the renderer has to
 *     fetch at runtime, over file:// in a packaged app. There is precedent for
 *     that working here, but "the canceller silently does not load" is too
 *     expensive a failure to leave resting on precedent.
 *
 * A static import is bundled inline by vite and downlevelled to a require by
 * tsc for the Node bench, so neither environment resolves anything at runtime.
 * The package is CommonJS (`module.exports = factory`) and `esModuleInterop`
 * hands that value over as the default export.
 */
async function defaultLoadModule(config: Record<string, unknown>): Promise<any> {
  if (!AEC3_UMD_GLOBAL_DECLARED) {
    throw new Error('AEC3 UMD global shim did not load');
  }
  const factory = WebRtcAec3 as unknown as (c: Record<string, unknown>) => Promise<any>;
  if (typeof factory !== 'function') {
    throw new Error('AEC3 package did not resolve to a module factory');
  }
  return factory(config);
}

export class Aec3Canceller {
  readonly streamRate: number;
  readonly internalRate: number;
  /** Samples per AEC3 frame at `streamRate`. Input length must be a multiple. */
  readonly frameSamples: number;

  private instance: Aec3Instance | null;
  private readonly module: any;
  private readonly analyzeOpts: Record<string, unknown>;
  private readonly processOpts: Record<string, unknown>;
  /** Reused across calls; allocating a buffer per 10ms frame is avoidable churn. */
  private scratchOut: Float32Array;

  private constructor(module: any, instance: Aec3Instance, streamRate: number, internalRate: number) {
    this.module = module;
    this.instance = instance;
    this.streamRate = streamRate;
    this.internalRate = internalRate;
    this.frameSamples = Math.round((streamRate * AEC3_FRAME_MS) / 1000);
    this.analyzeOpts = { sampleRateIn: streamRate };
    this.processOpts = { sampleRateIn: streamRate, sampleRateOut: streamRate };
    this.scratchOut = new Float32Array(this.frameSamples);
  }

  static async create(options: Aec3Options = {}): Promise<Aec3Canceller> {
    const streamRate = options.streamRate ?? AEC3_STREAM_RATE;
    const internalRate = options.internalRate ?? AEC3_INTERNAL_RATE;

    const config: Record<string, unknown> = {};
    if (options.wasmBinary) config.wasmBinary = options.wasmBinary;

    const load = options.loadModule ?? defaultLoadModule;
    const module = await load(config);
    if (!module || typeof module.AEC3 !== 'function') {
      throw new Error('AEC3 module loaded but exposes no AEC3 constructor');
    }

    // One render channel, one capture channel: the reference is a mono
    // downmix of the system audio and the microphone is mono.
    const instance: Aec3Instance = new module.AEC3(internalRate, 1, 1);
    return new Aec3Canceller(module, instance, streamRate, internalRate);
  }

  /**
   * Cancel the echo of `reference` out of `mic`.
   *
   * `mic` and `reference` must be the same length, a multiple of
   * `frameSamples`, and CONTIGUOUS with the previous call on both streams -
   * AEC3 carries adaptation state, and a gap or an overlap in either stream is
   * a step change in the echo path it then has to re-converge through. The
   * pipeline's 100ms chunks are 2400 samples, which is exactly 10 frames.
   *
   * The two windows must be contemporaneous. Do NOT pre-shift the reference by
   * the acoustic delay: AEC3 keeps its own render history and searches it, so a
   * pre-shifted window only moves the echo toward the non-causal edge, and past
   * it the echo cannot be modelled at all. See `aec-reference.ts`.
   */
  process(mic: Float32Array, reference: Float32Array): Float32Array {
    const instance = this.instance;
    if (!instance) throw new Error('Aec3Canceller used after dispose()');
    if (mic.length !== reference.length) {
      throw new Error(`AEC3 needs matched windows, got mic=${mic.length} ref=${reference.length}`);
    }
    if (mic.length % this.frameSamples !== 0) {
      throw new Error(`AEC3 needs a multiple of ${this.frameSamples} samples, got ${mic.length}`);
    }

    const out = new Float32Array(mic.length);
    const outFrame = [this.scratchOut];

    for (let offset = 0; offset < mic.length; offset += this.frameSamples) {
      const refFrame = reference.subarray(offset, offset + this.frameSamples);
      const micFrame = mic.subarray(offset, offset + this.frameSamples);

      // Render first, then capture. AEC3 must have the far end in its history
      // before it is asked to find that far end inside the microphone.
      instance.analyze([refFrame], this.analyzeOpts);

      const produced = instance.processSize([micFrame], this.processOpts);
      if (produced !== this.frameSamples) {
        // The port is sample-exact at these rates and the bench pins it. A
        // mismatch means an assumption broke; say so rather than silently
        // shifting the stream, which would misalign every later frame.
        throw new Error(`AEC3 returned ${produced} samples for a ${this.frameSamples}-sample frame`);
      }
      instance.process(outFrame, [micFrame], this.processOpts);

      out.set(this.scratchOut, offset);
    }

    return out;
  }

  /**
   * Tell AEC3 the known buffering delay between render and capture, in ms.
   *
   * A hint only - AEC3 estimates the delay itself and this just seeds it.
   * Left uncalled by default: the estimate is measured and the hint is not.
   */
  setAudioBufferDelay(delayMs: number): void {
    this.instance?.setAudioBufferDelay(delayMs);
  }

  dispose(): void {
    if (!this.instance) return;
    this.instance.free();
    this.instance = null;
  }
}
