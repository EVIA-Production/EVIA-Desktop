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

export class SystemAudioMacService {
  private systemAudioProc: ChildProcess | null = null;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private isRunning: boolean = false;

  constructor() {
    console.log('[SystemAudioMacService] Initialized');
  }

  /**
   * Kill any existing SystemAudioDump processes before starting a new one
   */
  private async killExistingSystemAudioDump(): Promise<void> {
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
  private getSystemAudioPath(): string {
    const systemAudioPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', 'SystemAudioDump')
      : path.join(app.getAppPath(), 'src', 'main', 'assets', 'SystemAudioDump');

    console.log('[SystemAudioMacService] 🔍 SystemAudioDump path:', systemAudioPath);
    console.log('[SystemAudioMacService] 🔍 app.getAppPath():', app.getAppPath());
    console.log('[SystemAudioMacService] 🔍 app.isPackaged:', app.isPackaged);
    
    // Verify binary exists
    const fs = require('fs');
    try {
      const stats = fs.statSync(systemAudioPath);
      console.log('[SystemAudioMacService] ✅ Binary exists, size:', stats.size, 'bytes');
      console.log('[SystemAudioMacService] ✅ Binary permissions:', stats.mode.toString(8));
      console.log('[SystemAudioMacService] ✅ Binary executable:', !!(stats.mode & fs.constants.S_IXUSR));
    } catch (err: any) {
      console.error('[SystemAudioMacService] ❌ Binary NOT found or not accessible:', err.message);
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
      
      console.log('[SystemAudioMacService] 🚀 Spawning SystemAudioDump binary...');
      console.log('[SystemAudioMacService] 🚀 Command:', systemAudioPath);
      console.log('[SystemAudioMacService] 🚀 Args:', []);
      
      this.systemAudioProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (!this.systemAudioProc.pid) {
        console.error('[SystemAudioMacService] ❌ Failed to start SystemAudioDump - no PID assigned');
        return { success: false, error: 'Failed to spawn process - no PID' };
      }

      console.log('[SystemAudioMacService] ✅ SystemAudioDump started with PID:', this.systemAudioProc.pid);
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
          // console.log('[SystemAudioMacService] Sent SYSTEM chunk:', monoChunk.length * 2, 'bytes (original stereo:', chunk.length, 'bytes)');
        }
      });

      // Step 5: Error handling
      this.systemAudioProc.stderr!.on('data', (data: Buffer) => {
        const errorMsg = data.toString().trim();
        console.error('[SystemAudioMacService] 🔴 SystemAudioDump stderr:', errorMsg);
        
        // Check for specific permission error
        if (errorMsg.includes('permission') || errorMsg.includes('Permission')) {
          console.error('[SystemAudioMacService] ❌ PERMISSION ERROR DETECTED');
          console.error('[SystemAudioMacService] 🔧 DEV MODE FIX: Grant Screen Recording permission to Terminal.app');
          console.error('[SystemAudioMacService]     1. Open System Settings');
          console.error('[SystemAudioMacService]     2. Go to Privacy & Security → Screen & System Audio Recording');
          console.error('[SystemAudioMacService]     3. Add Terminal.app (or iTerm2.app if you use that)');
          console.error('[SystemAudioMacService]     4. Toggle it ON');
          console.error('[SystemAudioMacService]     5. Quit and restart EVIA from Terminal');
        }
      });

      this.systemAudioProc.on('close', (code) => {
        console.log('[SystemAudioMacService] 🔴 SystemAudioDump process closed with code:', code);
        this.systemAudioProc = null;
        this.isRunning = false;
        this.audioBuffer = Buffer.alloc(0);

        if (code === 1) {
          console.error('[SystemAudioMacService] ❌ Binary exited with code 1 - PERMISSION DENIED');
          console.error('[SystemAudioMacService] 🔧 FIX: Grant Screen Recording permission to Terminal.app');
          console.error('[SystemAudioMacService]     System Settings → Privacy & Security → Screen & System Audio Recording → Add Terminal');
          console.error('[SystemAudioMacService]     Then relaunch EVIA from Terminal (not Cursor)');
        } else if (code !== 0 && code !== null) {
          console.error('[SystemAudioMacService] ❌ Binary exited with code:', code);
        }
      });

      this.systemAudioProc.on('error', (err: any) => {
        console.error('[SystemAudioMacService] ❌ SystemAudioDump process error:', err);
        console.error('[SystemAudioMacService] ❌ Error name:', err.name);
        console.error('[SystemAudioMacService] ❌ Error message:', err.message);
        console.error('[SystemAudioMacService] ❌ Error stack:', err.stack);
        this.systemAudioProc = null;
        this.isRunning = false;
        this.audioBuffer = Buffer.alloc(0);
      });

      return { success: true };
    } catch (error: any) {
      console.error('[SystemAudioMacService] Failed to start system audio capture:', error);
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
        console.log('[SystemAudioMacService] Stopping SystemAudioDump process...');
        this.systemAudioProc.kill();
        this.systemAudioProc = null;
      }

      this.isRunning = false;
      this.audioBuffer = Buffer.alloc(0);

      // Also kill any orphaned processes
      await this.killExistingSystemAudioDump();

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

  /**
   * Get current audio buffer size (for debugging)
   */
  public getBufferSize(): number {
    return this.audioBuffer.length;
  }
}

// Singleton instance
export const systemAudioMacService = new SystemAudioMacService();

