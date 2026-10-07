import fs from 'fs'
import path from 'path'

export interface OnboardingLaunchMarker {
  version: string
  pid: number
  startedAt: number
  attempts: number
}

/**
 * Setup runs inside the main process, so a native crash there ends the whole
 * app before any handler can show anything: the installed 1.0.124 exited with
 * 0xFFFF7003 during the first onboarding render on Windows and left nothing on
 * screen. The marker is written before setup starts and removed whenever setup
 * ends normally or the app quits cleanly. A marker left by another process
 * means that run died during setup, so the next launch can offer a visible way
 * out instead of repeating the same crash.
 */
export function createOnboardingLaunchMarker(directory: string, now = () => Date.now(), pid = process.pid) {
  const file = path.join(directory, 'onboarding-launch.json')
  const read = (): OnboardingLaunchMarker | null => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'))
      return value && typeof value.startedAt === 'number' && typeof value.pid === 'number' ? value : null
    } catch {
      return null
    }
  }
  return {
    file,
    /** The run that wrote this marker started setup and never ended it. */
    previousUnfinished(): OnboardingLaunchMarker | null {
      const marker = read()
      return marker && marker.pid !== pid ? marker : null
    },
    begin(version: string, attempts: number) {
      try {
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ version, pid, startedAt: now(), attempts }), { mode: 0o600 })
      } catch (error) {
        console.warn('[Onboarding] Could not write the launch marker:', (error as Error).message)
      }
    },
    clear() {
      try { fs.unlinkSync(file) } catch { /* already gone */ }
    },
  }
}

/** Minidumps written after `since`, by name only (they stay on this machine). */
export function crashDumpsSince(directory: string, since: number): string[] {
  try {
    const reports = path.join(directory, 'reports')
    return fs.readdirSync(reports)
      .filter(name => name.endsWith('.dmp'))
      .filter(name => fs.statSync(path.join(reports, name)).mtimeMs >= since)
      .slice(0, 5)
  } catch {
    return []
  }
}
