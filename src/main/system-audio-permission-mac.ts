/**
 * "System Audio Recording Only" (macOS 14.4+).
 *
 * The SystemAudioDump helper captures through a Core Audio process tap from
 * macOS 14.4, which runs under the narrower System Audio Recording permission
 * instead of Screen & System Audio Recording: a normal prompt, no System
 * Settings detour, and none of Sequoia's recurring screen-recording
 * re-approval. Below 14.4 the helper keeps ScreenCaptureKit and the screen
 * permission still applies. The helper answers two questions for us here,
 * because Electron has no API for this TCC service.
 */
import { execFile } from 'child_process';
import os from 'os';

export type AudioCaptureState = 'authorized' | 'denied' | 'unknown';
export type AudioCaptureProbe = { tap: boolean; state: AudioCaptureState };

/** Darwin 23.4 is macOS 14.4. */
export function macSupportsAudioTap(release: string = os.release()): boolean {
  if (process.platform !== 'darwin') return false;
  if (process.env.TAYLOS_SYSTEM_AUDIO_BACKEND === 'screencapturekit' || process.env.TAYLOS_SYSTEM_AUDIO_BACKEND === 'sck') return false;
  const [major = 0, minor = 0] = release.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 4);
}

function runHelper(helperPath: string, flag: string, timeoutMs: number): Promise<AudioCaptureProbe | null> {
  return new Promise((resolve) => {
    execFile(helperPath, [flag], { timeout: timeoutMs, env: process.env }, (_error, _stdout, stderr) => {
      const lines = String(stderr || '').split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          const status = JSON.parse(line);
          if (status?.status === 'audio_capture_permission') {
            const state: AudioCaptureState = status.state === 'authorized' ? 'authorized' : status.state === 'denied' ? 'denied' : 'unknown';
            resolve({ tap: status.tap !== false, state });
            return;
          }
        } catch { /* not a status line */ }
      }
      resolve(null);
    });
  });
}

/** Current state without prompting. `null` when the helper cannot answer. */
export async function probeAudioCapturePermission(helperPath: string): Promise<AudioCaptureProbe | null> {
  if (!macSupportsAudioTap()) return null;
  return runHelper(helperPath, '--audio-permission-status', 5000);
}

/** Shows the system prompt when the decision is still open; resolves with the outcome. */
export async function requestAudioCapturePermission(helperPath: string): Promise<AudioCaptureProbe | null> {
  if (!macSupportsAudioTap()) return null;
  // The prompt waits for the user; give them time.
  return runHelper(helperPath, '--request-audio-permission', 5 * 60 * 1000);
}
