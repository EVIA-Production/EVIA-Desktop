/**
 * SystemAudioWindowsService - Manages Windows system audio capture via WASAPI loopback helper
 *
 * Contract:
 * - Spawns WASAPILoopback.exe (bundled in src/main/assets/WASAPILoopback.exe)
 * - Helper outputs mono PCM16 at 24kHz in 100ms chunks, base64 lines or raw bytes
 * - We accept raw bytes and convert to base64; if helper already emits base64 JSON {data}, we pass through
 * - Emits 'system-audio-windows-data' to all renderers with shape { data: base64String }
 */

import { spawn, ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';

const CHUNK_DURATION_SEC = 0.1; // 100ms
const SAMPLE_RATE = 24000; // 24kHz
const BYTES_PER_SAMPLE = 2; // PCM16
const CHANNELS = 1; // mono (helper should downmix)
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION_SEC; // 4800 bytes

export class SystemAudioWindowsService {
  private proc: ChildProcess | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private running = false;
  
  // WINDOWS FIX (2025-12-05): Heartbeat monitoring to detect helper stalls
  private lastChunkTime: number = 0;
  private chunkCount: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_CHECK_MS = 2000;
  private readonly STALL_THRESHOLD_MS = 5000;

  private send(channel: string, data: any) {
    const wins = BrowserWindow.getAllWindows();
    wins.forEach(w => { if (!w.isDestroyed()) w.webContents.send(channel, data); });
  }

  private getHelperPath(): string {
    const helper = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', 'WASAPILoopback.exe')
      : path.join(app.getAppPath(), 'src', 'main', 'assets', 'WASAPILoopback.exe');
    return helper;
  }

  public async start(): Promise<{ success: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'windows_only' };
    }
    if (this.running) return { success: false, error: 'already_running' };

    try {
      const helperPath = this.getHelperPath();
      // Log the path we will spawn from
      console.log('[SystemAudioWindows] Helper path:', helperPath);

      // Verify helper exists (common dev issue if not compiled yet)
      try {
        const fs = require('fs');
        if (!fs.existsSync(helperPath)) {
          const msg = `[SystemAudioWindows] ❌ Helper not found at ${helperPath}. Build WASAPILoopback.exe and place it there.`;
          console.error(msg);
          this.send('system-audio-windows:status', msg);
          return { success: false, error: 'helper_not_found' };
        }
      } catch (e) {
        console.warn('[SystemAudioWindows] Helper existence check failed:', e);
      }
      // Args: ensure 24000 mono 16-bit little endian, 100ms
      const args: string[] = ['--sample-rate', String(SAMPLE_RATE), '--channels', '1', '--chunk-ms', '100', '--format', 's16le'];
      this.proc = spawn(helperPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (!this.proc.pid) return { success: false, error: 'spawn_failed' };
      this.running = true;

      // WINDOWS FIX: Start heartbeat monitoring
      this.lastChunkTime = Date.now();
      this.chunkCount = 0;
      this.heartbeatInterval = setInterval(() => {
        const timeSinceChunk = Date.now() - this.lastChunkTime;
        
        if (this.running && timeSinceChunk > this.STALL_THRESHOLD_MS) {
          console.warn(`[SystemAudioWindows] ⚠️ Helper stalled - no chunks for ${Math.round(timeSinceChunk/1000)}s`);
          this.send('system-audio-windows:status', `WARNING: Helper stalled (${Math.round(timeSinceChunk/1000)}s)`);
          
          // Auto-restart if stalled for too long
          if (timeSinceChunk > this.STALL_THRESHOLD_MS * 2) {
            console.log('[SystemAudioWindows] 🔄 Auto-restarting stalled helper...');
            this.stop().then(() => {
              setTimeout(() => this.start(), 500);
            });
          }
        }
      }, this.HEARTBEAT_CHECK_MS);

      this.proc.stdout!.on('data', (data: Buffer) => {
        // Accumulate stdout. Helper emits RAW PCM; optional JSON lines are supported only if stream begins with '{'.
        this.buffer = Buffer.concat([this.buffer, data]);

        // Only attempt JSON parsing if the very first byte indicates a JSON object ('{').
        // This avoids corrupting raw PCM by interpreting random 0x0A bytes as line breaks.
        if (this.buffer.length > 0 && this.buffer[0] === 0x7b /* '{' */) {
          // Parse complete JSON lines (newline-delimited) at the head of the buffer
          while (true) {
            const idx = this.buffer.indexOf(0x0a); // \n
            if (idx === -1) break;
            const lineBuf = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            const line = lineBuf.toString('utf8').trim();
            if (line.startsWith('{') && line.includes('data')) {
              try {
                const obj = JSON.parse(line);
                if (obj && typeof obj.data === 'string') {
                  this.send('system-audio-windows-data', { data: obj.data });
                  continue;
                }
              } catch {
                // If JSON parsing fails, fall through to raw mode for the remaining buffer
                break;
              }
            } else {
              // Non-matching JSON content – stop JSON mode and fall back to raw
              break;
            }
          }
        }

        // Raw mode: emit fixed-size chunks as base64
        while (this.buffer.length >= CHUNK_SIZE) {
          const chunk = this.buffer.slice(0, CHUNK_SIZE);
          this.buffer = this.buffer.slice(CHUNK_SIZE);
          const b64 = chunk.toString('base64');
          this.send('system-audio-windows-data', { data: b64 });
          
          // WINDOWS FIX: Track chunk time for heartbeat monitoring
          this.lastChunkTime = Date.now();
          this.chunkCount++;
          if (this.chunkCount <= 5 || this.chunkCount % 100 === 0) {
            console.log(`[SystemAudioWindows] Chunk #${this.chunkCount}: ${chunk.length} bytes`);
          }
        }
      });

      this.proc.stderr!.on('data', (d: Buffer) => {
        const line = d.toString('utf8').trim();
        this.send('system-audio-windows:status', line);
        console.error('[SystemAudioWindows] stderr:', line);
      });

      this.proc.on('close', (code) => {
        console.log('[SystemAudioWindows] helper closed with code', code);
        this.proc = null;
        this.running = false;
        this.buffer = Buffer.alloc(0);
      });

      this.proc.on('error', (err) => {
        console.error('[SystemAudioWindows] helper error:', err);
        this.proc = null;
        this.running = false;
        this.buffer = Buffer.alloc(0);
      });

      return { success: true };
    } catch (e: any) {
      this.running = false;
      return { success: false, error: e?.message || String(e) };
    }
  }

  public async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      // WINDOWS FIX: Stop heartbeat monitoring
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      this.chunkCount = 0;
      
      if (this.proc) {
        this.proc.kill();
        this.proc = null;
      }
      this.running = false;
      this.buffer = Buffer.alloc(0);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  public isRunning(): boolean { return this.running; }
}

export const systemAudioWindowsService = new SystemAudioWindowsService();
