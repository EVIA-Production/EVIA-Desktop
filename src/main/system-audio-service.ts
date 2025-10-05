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
import path from 'path';

// Audio format constants (must match SystemAudioDump output)
const CHUNK_DURATION = 0.1; // seconds
const SAMPLE_RATE = 24000; // Hz
const BYTES_PER_SAMPLE = 2; // int16
const CHANNELS = 2; // stereo
const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION; // 4800 bytes

export class SystemAudioService {
  private systemAudioProc: ChildProcess | null = null;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private isRunning: boolean = false;

  constructor() {
    console.log('[SystemAudioService] Initialized');
  }

  /**
   * Kill any existing SystemAudioDump processes before starting a new one
   */
  private async killExistingSystemAudioDump(): Promise<void> {
    return new Promise((resolve) => {
      console.log('[SystemAudioService] Checking for existing SystemAudioDump processes...');

      const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
        stdio: 'ignore',
      });

      killProc.on('close', (code) => {
        if (code === 0) {
          console.log('[SystemAudioService] Killed existing SystemAudioDump processes');
        } else {
          console.log('[SystemAudioService] No existing SystemAudioDump processes found');
        }
        resolve();
      });

      killProc.on('error', (err) => {
        console.log('[SystemAudioService] Error checking for existing processes (normal):', err.message);
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
   * Convert stereo PCM to mono by taking only the left channel
   * Input: Stereo buffer (LLRRLLRR... format, 2 bytes per sample)
   * Output: Mono buffer (LLLL... format, 2 bytes per sample)
   */
  private convertStereoToMono(stereoBuffer: Buffer): Buffer {
    const samples = stereoBuffer.length / 4; // 2 bytes per sample * 2 channels
    const monoBuffer = Buffer.alloc(samples * 2); // 2 bytes per sample

    for (let i = 0; i < samples; i++) {
      const leftSample = stereoBuffer.readInt16LE(i * 4); // Read left channel
      monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
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

  /**
   * Check and request screen recording permission
   * Note: On macOS Sonoma+, askForMediaAccess may not work, manual grant required
   */
  private async checkAndRequestPermission(): Promise<void> {
    try {
      const screenStatus = systemPreferences.getMediaAccessStatus('screen');
      console.log('[SystemAudioService] Screen recording permission status:', screenStatus);

      if (screenStatus !== 'granted') {
        console.log('[SystemAudioService] Requesting screen recording permission...');
        try {
          // Note: askForMediaAccess('screen') is not available in Electron 38+
          // Permission must be granted manually via System Settings
          // We try to call it anyway in case it works on some versions
          await (systemPreferences as any).askForMediaAccess('screen');
        } catch (requestError: any) {
          console.warn('[SystemAudioService] askForMediaAccess not available or failed:', requestError.message);
        }

        const refreshedStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log('[SystemAudioService] Permission status after request:', refreshedStatus);

        if (refreshedStatus !== 'granted') {
          console.warn('[SystemAudioService] ⚠️  Screen recording permission still not granted.');
          console.warn('[SystemAudioService] Please enable in System Settings → Privacy & Security → Screen Recording');
        }
      } else {
        console.log('[SystemAudioService] ✅ Screen recording permission already granted');
      }
    } catch (permissionError: any) {
      console.warn('[SystemAudioService] Unable to verify/request screen permission:', permissionError.message);
    }
  }

  /**
   * Get the path to SystemAudioDump binary (dev vs production)
   */
  private getSystemAudioPath(): string {
    const systemAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', 'SystemAudioDump')
      : path.join(app.getAppPath(), 'src', 'main', 'assets', 'SystemAudioDump');

    console.log('[SystemAudioService] 🔍 SystemAudioDump path:', systemAudioPath);
    console.log('[SystemAudioService] 🔍 app.getAppPath():', app.getAppPath());
    console.log('[SystemAudioService] 🔍 app.isPackaged:', app.isPackaged);
    
    // Verify binary exists
    const fs = require('fs');
    try {
      const stats = fs.statSync(systemAudioPath);
      console.log('[SystemAudioService] ✅ Binary exists, size:', stats.size, 'bytes');
      console.log('[SystemAudioService] ✅ Binary permissions:', stats.mode.toString(8));
      console.log('[SystemAudioService] ✅ Binary executable:', !!(stats.mode & fs.constants.S_IXUSR));
    } catch (err: any) {
      console.error('[SystemAudioService] ❌ Binary NOT found or not accessible:', err.message);
    }
    
    return systemAudioPath;
  }

  /**
   * Start capturing system audio via SystemAudioDump binary
   * Returns: Promise<{ success: boolean, error?: string }>
   */
  public async start(): Promise<{ success: boolean; error?: string }> {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'System audio capture only available on macOS' };
    }

    if (this.isRunning) {
      return { success: false, error: 'already_running' };
    }

    try {
      // Step 1: Kill any existing processes
      await this.killExistingSystemAudioDump();

      // Step 2: Check/request screen recording permission
      await this.checkAndRequestPermission();

      // Step 3: Spawn SystemAudioDump binary
      const systemAudioPath = this.getSystemAudioPath();
      
      console.log('[SystemAudioService] 🚀 Spawning SystemAudioDump binary...');
      console.log('[SystemAudioService] 🚀 Command:', systemAudioPath);
      console.log('[SystemAudioService] 🚀 Args:', []);
      
      this.systemAudioProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (!this.systemAudioProc.pid) {
        console.error('[SystemAudioService] ❌ Failed to start SystemAudioDump - no PID assigned');
        return { success: false, error: 'Failed to spawn process - no PID' };
      }

      console.log('[SystemAudioService] ✅ SystemAudioDump started with PID:', this.systemAudioProc.pid);
      this.isRunning = true;

      // Step 4: Process audio data from stdout
      this.systemAudioProc.stdout!.on('data', (data: Buffer) => {
        this.audioBuffer = Buffer.concat([this.audioBuffer, data]);

        // Process complete chunks
        while (this.audioBuffer.length >= CHUNK_SIZE) {
          const chunk = this.audioBuffer.slice(0, CHUNK_SIZE);
          this.audioBuffer = this.audioBuffer.slice(CHUNK_SIZE);

          // Convert stereo to mono
          const monoChunk = this.convertStereoToMono(chunk);
          const base64Data = monoChunk.toString('base64');

          // Send to renderer for AEC reference
          this.sendToRenderer('system-audio-data', { data: base64Data });

          // Log chunk transmission (verbose, can be removed in production)
          // console.log('[SystemAudioService] Sent SYSTEM chunk:', monoChunk.length * 2, 'bytes (original stereo:', chunk.length, 'bytes)');
        }
      });

      // Step 5: Error handling
      this.systemAudioProc.stderr!.on('data', (data: Buffer) => {
        const errorMsg = data.toString().trim();
        console.error('[SystemAudioService] 🔴 SystemAudioDump stderr:', errorMsg);
        
        // Check for specific permission error
        if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
          console.error('[SystemAudioService] ❌ PERMISSION ERROR DETECTED');
          console.error('[SystemAudioService] 🔧 DEV MODE FIX: Grant Screen Recording permission to Terminal.app');
          console.error('[SystemAudioService]     1. Open System Settings');
          console.error('[SystemAudioService]     2. Go to Privacy & Security → Screen & System Audio Recording');
          console.error('[SystemAudioService]     3. Add Terminal.app (or iTerm2.app if you use that)');
          console.error('[SystemAudioService]     4. Toggle it ON');
          console.error('[SystemAudioService]     5. Quit and restart EVIA from Terminal');
        }
      });

      this.systemAudioProc.on('close', (code) => {
        console.log('[SystemAudioService] 🔴 SystemAudioDump process closed with code:', code);
        this.systemAudioProc = null;
        this.isRunning = false;
        this.audioBuffer = Buffer.alloc(0);

        if (code === 1) {
          console.error('[SystemAudioService] ❌ Binary exited with code 1 - PERMISSION DENIED');
          console.error('[SystemAudioService] 🔧 FIX: Grant Screen Recording permission to Terminal.app');
          console.error('[SystemAudioService]     System Settings → Privacy & Security → Screen & System Audio Recording → Add Terminal');
          console.error('[SystemAudioService]     Then relaunch EVIA from Terminal (not Cursor)');
        } else if (code !== 0 && code !== null) {
          console.error('[SystemAudioService] ❌ Binary exited with code:', code);
        }
      });

      this.systemAudioProc.on('error', (err: any) => {
        console.error('[SystemAudioService] ❌ SystemAudioDump process error:', err);
        console.error('[SystemAudioService] ❌ Error name:', err.name);
        console.error('[SystemAudioService] ❌ Error message:', err.message);
        console.error('[SystemAudioService] ❌ Error stack:', err.stack);
        this.systemAudioProc = null;
        this.isRunning = false;
        this.audioBuffer = Buffer.alloc(0);
      });

      return { success: true };
    } catch (error: any) {
      console.error('[SystemAudioService] Failed to start system audio capture:', error);
      this.isRunning = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop capturing system audio
   */
  public async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.systemAudioProc) {
        console.log('[SystemAudioService] Stopping SystemAudioDump process...');
        this.systemAudioProc.kill();
        this.systemAudioProc = null;
      }

      this.isRunning = false;
      this.audioBuffer = Buffer.alloc(0);

      // Also kill any orphaned processes
      await this.killExistingSystemAudioDump();

      console.log('[SystemAudioService] ✅ System audio capture stopped');
      return { success: true };
    } catch (error: any) {
      console.error('[SystemAudioService] Failed to stop system audio capture:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if system audio capture is currently running
   */
  public isSystemAudioRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current audio buffer size (for debugging)
   */
  public getBufferSize(): number {
    return this.audioBuffer.length;
  }
}

// Singleton instance
export const systemAudioService = new SystemAudioService();

