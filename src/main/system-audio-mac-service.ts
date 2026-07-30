/**
 * SystemAudioService - Manages macOS system audio capture via SystemAudioDump binary
 * 
 * Architecture:
 * 1. Spawns SystemAudioDump binary (ScreenCaptureKit-based native process)
 * 2. Reads stereo PCM audio from stdout (24kHz, int16, 2 channels)
 * 3. Converts stereo to mono and base64 encodes
 * 4. Sends to renderer for AEC and to WebSocket for transcription
 * 
 * Based on Glass implementation: glass/src/features/listen/stt/sttService.js
 */

import { spawn, ChildProcess } from 'child_process';
import { app, systemPreferences, BrowserWindow } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appendAudioDiagnostic } from './audio-diagnostics';

const TARGET_SAMPLE_RATE = 24000;
const CAPTURE_READY_TIMEOUT_MS = 8000;

export type SystemAudioStartErrorCode =
  | 'already_running'
  | 'unsupported'
  | 'unsupported_os'
  | 'permission_denied'
  | 'missing_binary'
  | 'spawn_failed'
  | 'capture_timeout'
  | 'capture_failed'
  | 'invalid_audio_protocol';

export type SystemAudioStartResult = {
  success: boolean;
  error?: string;
  code?: SystemAudioStartErrorCode;
  readyInMs?: number;
  minimumMacOS?: string;
  currentMacOS?: string;
};

class SystemAudioStartError extends Error {
  constructor(
    public readonly code: SystemAudioStartErrorCode,
    message: string,
    public readonly details: { minimumMacOS?: string; currentMacOS?: string } = {},
  ) {
    super(message);
    this.name = 'SystemAudioStartError';
  }
}

export class SystemAudioMacService {
  private systemAudioProc: ChildProcess | null = null;
  private initialOrphanCleanup: Promise<void> | null = null;
  private didInitialOrphanCleanup = false;
  private stdoutBuffer = '';
  private isRunning: boolean = false;
  private chunkWatchdog: NodeJS.Timeout | null = null;
  private lastChunkAt: number = 0;
  private chunksForwarded: number = 0;
  private readonly CHUNK_STALL_MS = 8000;
  private readonly WATCHDOG_INTERVAL_MS = 3000;

  constructor() {
    // Only log/init details on macOS to avoid noise on Windows/Linux
    if (process.platform === 'darwin') {
      console.log('[SystemAudioMacService] Initialized');
    }
  }

  /**
   * Kill any existing SystemAudioDump processes before starting a new one
   */
  private async killExistingSystemAudioDump(): Promise<void> {
    // No-op on non-macOS
    if (process.platform !== 'darwin') return Promise.resolve();
    return new Promise((resolve) => {
      console.log('[SystemAudioMacService] Checking for existing SystemAudioDump processes...');

      const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
        stdio: 'ignore',
      });

      killProc.on('close', (code) => {
        if (code === 0) {
          console.log('[SystemAudioMacService] Killed existing SystemAudioDump processes');
        } else {
          console.log('[SystemAudioMacService] No existing SystemAudioDump processes found');
        }
        resolve();
      });

      killProc.on('error', (err) => {
        console.log('[SystemAudioMacService] Error checking for existing processes (normal):', err.message);
        resolve();
      });

      // Safety timeout
      setTimeout(() => {
        killProc.kill();
        resolve();
      }, 2000);
    });
  }

  /**
   * Remove a helper left behind by a previous crashed Taylos process once per
   * app lifetime. Re-running a process-name-wide pkill on every Listen/Stop
   * cycle adds latency and can terminate another active Taylos instance.
   */
  private async ensureInitialOrphanCleanup(): Promise<void> {
    if (this.didInitialOrphanCleanup) return;
    if (!this.initialOrphanCleanup) {
      this.initialOrphanCleanup = this.killExistingSystemAudioDump().then(() => {
        this.didInitialOrphanCleanup = true;
      });
    }
    await this.initialOrphanCleanup;
  }

  private async terminateOwnedProcess(proc: ChildProcess): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return;

    const waitForExit = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
      let settled = false;
      const finish = (exited: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        proc.off('close', onClose);
        proc.off('error', onError);
        resolve(exited);
      };
      const onClose = () => finish(true);
      const onError = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      proc.once('close', onClose);
      proc.once('error', onError);
    });

    const gracefulExit = waitForExit(500);
    proc.kill('SIGTERM');
    if (await gracefulExit) return;

    console.warn('[SystemAudioMacService] Helper did not exit after SIGTERM; sending SIGKILL');
    const forcedExit = waitForExit(500);
    proc.kill('SIGKILL');
    await forcedExit;
  }

  private convertFloat32PayloadToPcm16(
    encoded: string,
    sampleRate: number,
    channels: number,
  ): Buffer {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) {
      throw new SystemAudioStartError(
        'invalid_audio_protocol',
        `Invalid helper format rate=${sampleRate} channels=${channels}`,
      );
    }

    const source = Buffer.from(encoded, 'base64');
    const bytesPerFrame = Float32Array.BYTES_PER_ELEMENT * channels;
    const sourceFrames = Math.floor(source.length / bytesPerFrame);
    if (sourceFrames <= 0) return Buffer.alloc(0);

    const outputFrames = Math.max(1, Math.floor(sourceFrames * TARGET_SAMPLE_RATE / sampleRate));
    const output = Buffer.allocUnsafe(outputFrames * Int16Array.BYTES_PER_ELEMENT);

    for (let outputFrame = 0; outputFrame < outputFrames; outputFrame += 1) {
      const sourceFrame = Math.min(
        sourceFrames - 1,
        Math.floor(outputFrame * sampleRate / TARGET_SAMPLE_RATE),
      );
      let mono = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        mono += source.readFloatLE((sourceFrame * channels + channel) * Float32Array.BYTES_PER_ELEMENT);
      }
      mono = Math.max(-1, Math.min(1, mono / channels));
      const pcm16 = mono < 0 ? Math.round(mono * 32768) : Math.round(mono * 32767);
      output.writeInt16LE(pcm16, outputFrame * Int16Array.BYTES_PER_ELEMENT);
    }

    return output;
  }

  private parseAudioLine(line: string): Buffer {
    let payload: { data?: unknown; mimeType?: unknown };
    try {
      payload = JSON.parse(line);
    } catch {
      throw new SystemAudioStartError(
        'invalid_audio_protocol',
        'SystemAudioDump emitted non-JSON data on stdout',
      );
    }

    if (typeof payload.data !== 'string' || typeof payload.mimeType !== 'string') {
      throw new SystemAudioStartError(
        'invalid_audio_protocol',
        'SystemAudioDump audio frame is missing data or mimeType',
      );
    }

    const format = /^audio\/float32;rate=(\d+);channels=(\d+)$/.exec(payload.mimeType);
    if (!format) {
      throw new SystemAudioStartError(
        'invalid_audio_protocol',
        `Unsupported SystemAudioDump format: ${payload.mimeType}`,
      );
    }

    return this.convertFloat32PayloadToPcm16(
      payload.data,
      Number(format[1]),
      Number(format[2]),
    );
  }

  /**
   * Send system audio data to all renderer windows
   */
  private sendToRenderer(channel: string, data: any): void {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }

  private startChunkWatchdog(): void {
    this.stopChunkWatchdog();
    this.chunkWatchdog = setInterval(() => {
      if (!this.isRunning || !this.systemAudioProc) return;
      const ageMs = this.lastChunkAt > 0 ? Date.now() - this.lastChunkAt : 0;
      if (ageMs > this.CHUNK_STALL_MS) {
        console.warn(
          `[SystemAudioMacService] 🚨 No audio chunk for ${Math.round(ageMs / 1000)}s (chunks=${this.chunksForwarded})`
        );
        this.sendToRenderer('system-audio:status', `stall:${ageMs}`);
        appendAudioDiagnostic('system_audio_stall', {
          ageMs,
          chunksForwarded: this.chunksForwarded,
        });
      }
    }, this.WATCHDOG_INTERVAL_MS);
  }

  private stopChunkWatchdog(): void {
    if (this.chunkWatchdog) {
      clearInterval(this.chunkWatchdog);
      this.chunkWatchdog = null;
    }
  }

  /**
   * Check and request screen recording permission
   * Note: On macOS Sonoma+, askForMediaAccess may not work, manual grant required
   */
  private async checkAndRequestPermission(): Promise<void> {
    if (process.platform !== 'darwin') return; // macOS only
    try {
      const screenStatus = systemPreferences.getMediaAccessStatus('screen');
      console.log('[SystemAudioMacService] Screen recording permission status:', screenStatus);

      if (screenStatus !== 'granted') {
        console.log('[SystemAudioMacService] Requesting screen recording permission...');
        try {
          // Note: askForMediaAccess('screen') is not available in Electron 38+
          // Permission must be granted manually via System Settings
          // We try to call it anyway in case it works on some versions
          await (systemPreferences as any).askForMediaAccess('screen');
        } catch (requestError: any) {
          console.warn('[SystemAudioMacService] askForMediaAccess not available or failed:', requestError.message);
        }

        const refreshedStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log('[SystemAudioMacService] Permission status after request:', refreshedStatus);

        if (refreshedStatus !== 'granted') {
          console.warn('[SystemAudioMacService] ⚠️  Screen recording permission still not granted.');
          console.warn('[SystemAudioMacService] Please enable in System Settings → Privacy & Security → Screen Recording');
        }
      } else {
        console.log('[SystemAudioMacService] ✅ Screen recording permission already granted');
      }
    } catch (permissionError: any) {
      console.warn('[SystemAudioMacService] Unable to verify/request screen permission:', permissionError.message);
    }
  }

  /**
   * Get the path to SystemAudioDump binary (dev vs production)
   */
  private getSystemAudioPath(): string | null {
    const candidates = [
      app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', 'SystemAudioDump')
        : path.join(app.getAppPath(), 'src', 'main', 'assets', 'SystemAudioDump'),
      path.join(app.getAppPath(), 'src', 'main', 'assets', 'SystemAudioDump'),
      path.join(process.cwd(), 'src', 'main', 'assets', 'SystemAudioDump'),
    ];

    console.log('[SystemAudioMacService] 🔍 app.getAppPath():', app.getAppPath());
    console.log('[SystemAudioMacService] 🔍 app.isPackaged:', app.isPackaged);

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      console.log('[SystemAudioMacService] 🔍 Checking SystemAudioDump path:', candidate);

      try {
        const stats = fs.statSync(candidate);
        console.log('[SystemAudioMacService] ✅ Binary exists, size:', stats.size, 'bytes');
        console.log('[SystemAudioMacService] ✅ Binary permissions:', stats.mode.toString(8));
        console.log('[SystemAudioMacService] ✅ Binary executable:', !!(stats.mode & fs.constants.S_IXUSR));
        return candidate;
      } catch (err: any) {
        console.warn('[SystemAudioMacService] ⚠️ Binary not usable at path:', candidate, err.message);
      }
    }

    console.error('[SystemAudioMacService] ❌ SystemAudioDump binary missing in all known locations');
    return null;
  }

  /**
   * Start capturing system audio via SystemAudioDump binary.
   *
   * Microphone capture is intentionally owned by the renderer and is not
   * stopped when this optional channel fails.
   */
  public async start(): Promise<SystemAudioStartResult> {
    appendAudioDiagnostic('system_audio_start_requested', {
      platform: process.platform,
      osRelease: os.release(),
    });
    if (process.platform !== 'darwin') {
      return {
        success: false,
        code: 'unsupported',
        error: 'System audio capture is only available on macOS',
      };
    }

    if (this.isRunning) {
      return {
        success: false,
        code: 'already_running',
        error: 'System audio capture is already running',
      };
    }

    try {
      // Step 1: Clean up a helper left by a previous crashed app once. Normal
      // session shutdown targets the exact child process owned by this service.
      await this.ensureInitialOrphanCleanup();

      // Step 2: Check/request screen recording permission
      await this.checkAndRequestPermission();

      // Step 3: Spawn SystemAudioDump binary
      const systemAudioPath = this.getSystemAudioPath();
      if (!systemAudioPath) {
        const result: SystemAudioStartResult = {
          success: false,
          code: 'missing_binary',
          error: 'SystemAudioDump binary not found',
        };
        this.sendToRenderer('system-audio:status', result);
        return result;
      }
      
      console.log('[SystemAudioMacService] 🚀 Spawning SystemAudioDump binary...');
      console.log('[SystemAudioMacService] 🚀 Command:', systemAudioPath);
      console.log('[SystemAudioMacService] 🚀 Args:', []);

      const captureStartupStartedAt = Date.now();
      let captureReadySettled = false;
      let captureReadyTimeout: NodeJS.Timeout | null = null;
      let resolveCaptureReady!: (readyInMs: number) => void;
      let rejectCaptureReady!: (error: SystemAudioStartError) => void;
      let startupFailure: SystemAudioStartError | null = null;

      const captureReadyPromise = new Promise<number>((resolve, reject) => {
        resolveCaptureReady = resolve;
        rejectCaptureReady = reject;
      });

      const markCaptureReady = () => {
        if (captureReadySettled) return;
        captureReadySettled = true;
        if (captureReadyTimeout) {
          clearTimeout(captureReadyTimeout);
          captureReadyTimeout = null;
        }
        const readyInMs = Date.now() - captureStartupStartedAt;
        console.log(`[SystemAudioMacService] ✅ Native capture ready after ${readyInMs}ms`);
        this.sendToRenderer('system-audio:status', {
          status: 'ready',
          readyInMs,
        });
        appendAudioDiagnostic('system_audio_ready', { readyInMs });
        resolveCaptureReady(readyInMs);
      };

      const failCaptureReady = (error: SystemAudioStartError) => {
        startupFailure = error;
        if (captureReadySettled) return;
        captureReadySettled = true;
        if (captureReadyTimeout) {
          clearTimeout(captureReadyTimeout);
          captureReadyTimeout = null;
        }
        rejectCaptureReady(error);
      };

      let spawnedProc: ChildProcess;
      const handleProcessError = (err: any) => {
        console.error('[SystemAudioMacService] ❌ SystemAudioDump process error:', err);
        console.error('[SystemAudioMacService] ❌ Error name:', err.name);
        console.error('[SystemAudioMacService] ❌ Error message:', err.message);
        console.error('[SystemAudioMacService] ❌ Error stack:', err.stack);
        const failure = new SystemAudioStartError(
          'spawn_failed',
          `SystemAudioDump process error: ${err.code || err.message}`,
        );
        this.sendToRenderer('system-audio:status', {
          status: 'spawn_failed',
          error: failure.message,
        });
        if (this.systemAudioProc === spawnedProc) {
          this.systemAudioProc = null;
          this.isRunning = false;
          this.stdoutBuffer = '';
          this.stopChunkWatchdog();
        }
        failCaptureReady(failure);
      };

      spawnedProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.systemAudioProc = spawnedProc;
      spawnedProc.on('error', handleProcessError);

      if (!spawnedProc.pid) {
        console.error('[SystemAudioMacService] ❌ Failed to start SystemAudioDump - no PID assigned');
        const result: SystemAudioStartResult = {
          success: false,
          code: 'spawn_failed',
          error: 'Failed to spawn SystemAudioDump: no PID assigned',
        };
        this.sendToRenderer('system-audio:status', result);
        return result;
      }

      console.log('[SystemAudioMacService] ✅ SystemAudioDump started with PID:', spawnedProc.pid);
      this.isRunning = true;
      this.stdoutBuffer = '';
      this.lastChunkAt = 0;
      this.chunksForwarded = 0;

      // Step 4: Process versioned NDJSON audio frames from stdout. Diagnostic
      // status is written only to stderr, so a malformed stdout line is a
      // protocol failure rather than something to reinterpret as PCM.
      spawnedProc.stdout!.on('data', (data: Buffer) => {
        if (this.systemAudioProc !== spawnedProc || !this.isRunning) return;
        this.stdoutBuffer += data.toString('utf8');

        let newlineIndex = this.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
          newlineIndex = this.stdoutBuffer.indexOf('\n');
          if (!line) continue;

          try {
            const pcm16 = this.parseAudioLine(line);
            if (pcm16.length === 0) continue;

            this.lastChunkAt = Date.now();
            this.chunksForwarded += 1;
            this.sendToRenderer('system-audio-data', {
              data: pcm16.toString('base64'),
            });

            if (this.chunksForwarded % 50 === 0) {
              console.log(
                `[SystemAudioMacService] 🎧 Forwarded ${this.chunksForwarded} chunks (last=${new Date(this.lastChunkAt).toISOString()})`
              );
            }
          } catch (error: any) {
            const failure = error instanceof SystemAudioStartError
              ? error
              : new SystemAudioStartError(
                  'invalid_audio_protocol',
                  error?.message || 'Invalid SystemAudioDump audio protocol',
                );
            console.error('[SystemAudioMacService] ❌ Invalid helper audio protocol:', failure.message);
            this.sendToRenderer('system-audio:status', {
              status: failure.code,
              error: failure.message,
            });
            failCaptureReady(failure);
            void this.terminateOwnedProcess(spawnedProc);
            return;
          }
        }
      });

      // Step 5: Parse structured helper status from stderr.
      let stderrBuffer = '';
      spawnedProc.stderr!.on('data', (data: Buffer) => {
        stderrBuffer += data.toString('utf8');

        let newlineIndex = stderrBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = stderrBuffer.slice(0, newlineIndex).trim();
          stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
          newlineIndex = stderrBuffer.indexOf('\n');
          if (!line) continue;

          console.log('[SystemAudioMacService] Helper status:', line);
          let status: Record<string, unknown>;
          try {
            status = JSON.parse(line);
          } catch {
            console.warn('[SystemAudioMacService] Ignoring unstructured helper stderr:', line);
            continue;
          }

          this.sendToRenderer('system-audio:status', status);
          const statusName = typeof status.status === 'string' ? status.status : '';
          appendAudioDiagnostic('system_audio_helper_status', {
            status: statusName || 'unknown',
            code: typeof status.code === 'string' ? status.code : undefined,
            current: typeof status.current === 'string' ? status.current : undefined,
            minimum: typeof status.minimum === 'string' ? status.minimum : undefined,
          });
          if (statusName === 'capture_started') {
            markCaptureReady();
            continue;
          }
          if (statusName === 'first_audio_chunk') {
            console.log('[SystemAudioMacService] ✅ Native first_audio_chunk received');
            continue;
          }
          if (statusName === 'unsupported_os') {
            failCaptureReady(new SystemAudioStartError(
              'unsupported_os',
              'Native system audio requires macOS 13 or later',
              {
                minimumMacOS: typeof status.minimum === 'string' ? status.minimum : '13.0',
                currentMacOS: typeof status.current === 'string' ? status.current : undefined,
              },
            ));
            continue;
          }
          if (statusName === 'permission_error') {
            failCaptureReady(new SystemAudioStartError(
              'permission_denied',
              typeof status.error === 'string'
                ? status.error
                : 'Screen and system audio recording permission was denied',
            ));
            continue;
          }
          if (statusName === 'capture_error' || statusName === 'fatal_error') {
            failCaptureReady(new SystemAudioStartError(
              'capture_failed',
              typeof status.error === 'string'
                ? status.error
                : 'ScreenCaptureKit failed to start system audio capture',
            ));
          }
        }
      });

      spawnedProc.on('close', (code) => {
        console.log('[SystemAudioMacService] 🔴 SystemAudioDump process closed with code:', code);
        if (this.systemAudioProc === spawnedProc) {
          this.systemAudioProc = null;
          this.isRunning = false;
          this.stdoutBuffer = '';
          this.stopChunkWatchdog();
        }
        failCaptureReady(
          startupFailure || new SystemAudioStartError(
            'capture_failed',
            `SystemAudioDump closed before capture was ready (code=${code})`,
          ),
        );

        if (code !== 0 && code !== null) {
          console.error('[SystemAudioMacService] ❌ Binary exited with code:', code);
        }
      });

      captureReadyTimeout = setTimeout(() => {
        failCaptureReady(new SystemAudioStartError(
          'capture_timeout',
          `SystemAudioDump capture readiness timed out after ${CAPTURE_READY_TIMEOUT_MS}ms`,
        ));
      }, CAPTURE_READY_TIMEOUT_MS);

      const readyInMs = await captureReadyPromise;
      this.startChunkWatchdog();
      return { success: true, readyInMs };
    } catch (error: any) {
      console.error('[SystemAudioMacService] Failed to start system audio capture:', error);
      if (this.systemAudioProc) {
        const failedProc = this.systemAudioProc;
        this.systemAudioProc = null;
        await this.terminateOwnedProcess(failedProc);
      }
      this.isRunning = false;
      this.stdoutBuffer = '';
      this.lastChunkAt = 0;
      this.chunksForwarded = 0;
      this.stopChunkWatchdog();
      const failure = error instanceof SystemAudioStartError
        ? error
        : new SystemAudioStartError(
            'capture_failed',
            error?.message || 'System audio capture failed to start',
          );
      const result: SystemAudioStartResult = {
        success: false,
        code: failure.code,
        error: failure.message,
        minimumMacOS: failure.details.minimumMacOS,
        currentMacOS: failure.details.currentMacOS,
      };
      this.sendToRenderer('system-audio:status', {
        status: 'start_failed',
        ...result,
      });
      appendAudioDiagnostic('system_audio_start_failed', {
        code: result.code,
        error: result.error,
        minimumMacOS: result.minimumMacOS,
        currentMacOS: result.currentMacOS,
      });
      return result;
    }
  }

  /**
   * Stop capturing system audio
   */
  public async stop(): Promise<{ success: boolean; error?: string }> {
    // No-op on non-macOS; treat as success to simplify callers during app quit
    if (process.platform !== 'darwin') {
      return { success: true };
    }
    try {
      const ownedProc = this.systemAudioProc;
      this.systemAudioProc = null;
      if (ownedProc) {
        console.log('[SystemAudioMacService] Stopping SystemAudioDump process...');
        await this.terminateOwnedProcess(ownedProc);
      }

      this.isRunning = false;
      this.stdoutBuffer = '';
      this.lastChunkAt = 0;
      this.chunksForwarded = 0;
      this.stopChunkWatchdog();

      console.log('[SystemAudioMacService] ✅ System audio capture stopped');
      return { success: true };
    } catch (error: any) {
      console.error('[SystemAudioMacService] Failed to stop system audio capture:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if system audio capture is currently running
   */
  public isSystemAudioRunning(): boolean {
    return this.isRunning;
  }

  public async restart(): Promise<SystemAudioStartResult> {
    console.log('[SystemAudioMacService] 🔄 Restart requested');
    const stopResult = await this.stop();
    if (!stopResult.success) {
      return stopResult;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    return this.start();
  }

  /**
   * Get current audio buffer size (for debugging)
   */
  public getBufferSize(): number {
    return Buffer.byteLength(this.stdoutBuffer);
  }
}

// Singleton instance
export const systemAudioMacService = new SystemAudioMacService();
