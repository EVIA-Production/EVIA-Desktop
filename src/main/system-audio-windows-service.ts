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
  // WINDOWS FIX (2025-12-09): Increased threshold from 5s to 8s to reduce false positives
  private readonly STALL_THRESHOLD_MS = 8000;
  
  // WINDOWS FIX (2025-12-09): Prevent infinite restart loops
  private restartCount: number = 0;
  private lastRestartTime: number = 0;
  private readonly MAX_RESTARTS_PER_MINUTE = 5; // Increased from 3 to allow more recovery attempts
  private readonly RESTART_COOLDOWN_MS = 15000; // Reduced cooldown from 20s to 15s for faster recovery

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
        const now = Date.now();
        
        // Reset restart count after 1 minute of successful operation (100+ chunks = ~10s of audio)
        if (this.chunkCount > 100 && this.restartCount > 0) {
          console.log(`[SystemAudioWindows] ✅ Helper stable (${this.chunkCount} chunks) - resetting restart counter`);
          this.restartCount = 0;
        }
        
        if (this.running && timeSinceChunk > this.STALL_THRESHOLD_MS) {
          console.warn(`[SystemAudioWindows] ⚠️ Helper stalled - no chunks for ${Math.round(timeSinceChunk/1000)}s (restarts: ${this.restartCount})`);
          this.send('system-audio-windows:status', `WARNING: Helper stalled (${Math.round(timeSinceChunk/1000)}s)`);
          
          // Auto-restart if stalled for too long, but respect limits
          if (timeSinceChunk > this.STALL_THRESHOLD_MS * 2) {
            const timeSinceLastRestart = now - this.lastRestartTime;
            
            // Check restart limits
            if (this.restartCount >= this.MAX_RESTARTS_PER_MINUTE) {
              console.error(`[SystemAudioWindows] 🚫 MAX RESTARTS REACHED (${this.MAX_RESTARTS_PER_MINUTE}). NOT restarting. Manual intervention required.`);
              this.send('system-audio-windows:status', `ERROR: Max restarts reached - manual restart required`);
              // Stop the heartbeat to prevent more restart attempts
              if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
              }
              return;
            }
            
            // Enforce cooldown between restarts
            if (timeSinceLastRestart < this.RESTART_COOLDOWN_MS) {
              console.log(`[SystemAudioWindows] ⏳ Cooldown active - ${Math.round((this.RESTART_COOLDOWN_MS - timeSinceLastRestart)/1000)}s until next restart allowed`);
              return;
            }
            
            console.log(`[SystemAudioWindows] 🔄 Auto-restarting stalled helper (attempt ${this.restartCount + 1}/${this.MAX_RESTARTS_PER_MINUTE})...`);
            this.restartCount++;
            this.lastRestartTime = now;
            
            this.stop().then(() => {
              setTimeout(() => this.start(), 1000); // Longer delay between restarts
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
        const proc = this.proc;
        this.proc = null;
        
        // WINDOWS FIX (2025-12-09): Wait for process to actually exit before returning
        return new Promise((resolve) => {
          const cleanup = () => {
            this.running = false;
            this.buffer = Buffer.alloc(0);
            resolve({ success: true });
          };
          
          // Set a timeout in case process doesn't exit cleanly
          const timeout = setTimeout(() => {
            console.warn('[SystemAudioWindows] Force cleanup after timeout');
            cleanup();
          }, 3000);
          
          proc.once('close', () => {
            clearTimeout(timeout);
            console.log('[SystemAudioWindows] Process exited cleanly');
            cleanup();
          });
          
          // Try graceful termination first, then force kill
          try {
            proc.kill('SIGTERM');
            setTimeout(() => {
              if (proc.killed === false) {
                console.log('[SystemAudioWindows] Force killing unresponsive process...');
                proc.kill('SIGKILL');
              }
            }, 1000);
          } catch (killErr) {
            console.warn('[SystemAudioWindows] Error during kill:', killErr);
            cleanup();
          }
        });
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
