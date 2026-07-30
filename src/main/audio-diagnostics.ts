import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const LOG_NAME = 'audio-diagnostics.log';

function diagnosticPath(): string {
  return path.join(app.getPath('logs'), LOG_NAME);
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (fs.statSync(filePath).size < MAX_LOG_BYTES) return;
    const rotatedPath = `${filePath}.1`;
    if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
    fs.renameSync(filePath, rotatedPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[AudioDiagnostics] Rotation failed:', error?.message || error);
    }
  }
}

export function appendAudioDiagnostic(
  event: string,
  details: Record<string, unknown> = {},
): void {
  try {
    const filePath = diagnosticPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath);
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        event,
        ...details,
      })}\n`,
      'utf8',
    );
  } catch (error: any) {
    console.warn('[AudioDiagnostics] Write failed:', error?.message || error);
  }
}

export function getAudioDiagnosticPath(): string {
  return diagnosticPath();
}
