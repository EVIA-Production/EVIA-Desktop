/**
 * "System Audio Recording Only" (macOS 14.4+), opt-in.
 *
 * The SystemAudioDump helper can capture through a Core Audio process tap
 * from macOS 14.4, which runs under the narrower System Audio Recording
 * permission instead of Screen & System Audio Recording. It shipped as the
 * default in 1.0.115 and produced no usable audio on the founder's machine,
 * so 1.0.116 returned to ScreenCaptureKit and the screen permission; the tap
 * stays behind TAYLOS_SYSTEM_AUDIO_BACKEND=tap until it is proven on
 * hardware. The helper answers the two permission questions here, because
 * Electron has no API for this TCC service.
 */
import { execFile } from 'child_process';
import os from 'os';

export type AudioCaptureState = 'authorized' | 'denied' | 'unknown';
export type AudioCaptureProbe = { tap: boolean; state: AudioCaptureState };

/** True only when the tap is opted in and the machine can run it (Darwin 23.4 is macOS 14.4). */
export function macSupportsAudioTap(release: string = os.release()): boolean {
  if (process.platform !== 'darwin') return false;
  if (process.env.TAYLOS_SYSTEM_AUDIO_BACKEND !== 'tap') return false;
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
