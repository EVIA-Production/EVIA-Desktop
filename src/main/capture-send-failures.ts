import type { CaptureSource } from './capture-timeline';

/**
 * Decides what a capture source says out loud when it cannot send a chunk.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-12 a failing call produced hundreds of
 *
 *     [Renderer] [AudioCapture] ❌ SEND FAILED: mic WebSocket unavailable
 *
 * and nothing at all about system audio, which was read as "the microphone
 * socket is broken but system audio works fine". That reading was wrong, and it
 * cost two sessions.
 *
 * Both sources send through one function, resolve their chat id the same way,
 * and share one socket registry. What differed was only the REPORTING: the mic
 * catch forwarded its error over the `debug-log` IPC channel, which the main
 * process prints to the terminal, while both system catches wrote to
 * `console.error`, which in this renderer reaches no terminal at all. A missing
 * chat id strands both sockets identically; only one of them said so.
 *
 * So the asymmetry in the logs was an artifact of the logging, not evidence
 * about the transport. Routing every source through one reporter is what makes
 * "system audio was fine" a claim the terminal can actually support or refute.
 *
 * It is pure on purpose - the caller supplies the clock and performs the I/O -
 * so the throttle is testable without a renderer, a socket, or a real timer.
 */
export class CaptureSendFailureReporter {
  private readonly throttleMs: number;
  private readonly state = new Map<CaptureSource, { count: number; lastReportAtMs: number }>();

  constructor(throttleMs = 1000) {
    this.throttleMs = throttleMs;
  }

  /**
   * Record one failed chunk. Returns the line to emit, or null when this
   * failure falls inside the throttle window.
   *
   * These fire once per audio chunk - about ten times a second per source - so
   * an unthrottled report is a wall of identical lines that buries the cause
   * along with every other diagnostic. The first failure for a source is always
   * reported immediately, because the moment a source STARTS failing is the
   * only timestamp that locates the trigger. After that, at most one line per
   * window, carrying the running count so the volume stays visible.
   */
  record(source: CaptureSource, error: unknown, nowMs: number): string | null {
    const entry = this.state.get(source) ?? { count: 0, lastReportAtMs: 0 };
    entry.count += 1;
    this.state.set(source, entry);

    const isFirst = entry.count === 1;
    if (!isFirst && nowMs - entry.lastReportAtMs < this.throttleMs) return null;
    entry.lastReportAtMs = nowMs;

    const tally = entry.count > 1 ? ` (x${entry.count})` : '';
    return `❌ ${source.toUpperCase()} SEND FAILED${tally}: ${describeError(error)}`;
  }

  /** How many chunks this source has failed to send in the current session. */
  failureCount(source: CaptureSource): number {
    return this.state.get(source)?.count ?? 0;
  }

  /** Per capture session: last call's tally must never colour this one's. */
  reset(): void {
    this.state.clear();
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
