/**
 * Whether the recording the rep is watching has actually dropped.
 *
 * Capture runs two sockets, mic and system, and losing either loses half the
 * call. But the two do not have equal standing at any given moment: a system
 * socket that never opens on a mic-only setup is normal, while a mic socket
 * that WAS carrying audio and stops is a real failure the rep has to know
 * about. Judging both against one global flag conflates those.
 *
 * So each source is judged only against itself. A source that was never live
 * cannot have dropped, and is ignored. This is the property that matters:
 *
 *   A false alarm about lost recording is worse than no banner, because it
 *   trains the rep to ignore the real one.
 *
 * Measured 2026-08-20: the banner sat on screen through a call that was
 * transcribing perfectly (mic partial at 1095 ms). The subscriber had attached
 * to a socket nothing ever connects, so "not live" was true and permanent.
 */

export type CaptureLiveVerdict = boolean | null;

export class CaptureLiveTracker {
  private readonly everLive = new Set<string>();
  private readonly liveNow = new Map<string, boolean>();

  /** Record what one source last reported. `key` identifies chat and source. */
  observe(key: string, live: boolean): void {
    if (live) this.everLive.add(key);
    this.liveNow.set(key, live);
  }

  /** Forget everything. A new chat is a new recording; carrying "was live"
   *  across would let a socket report a drop it is no longer part of. */
  reset(): void {
    this.everLive.clear();
    this.liveNow.clear();
  }

  /**
   * `null`  nothing has ever been live, so nothing can have been lost — say nothing.
   * `true`  every source that was ever live still is.
   * `false` a source that was carrying audio has stopped.
   */
  verdict(): CaptureLiveVerdict {
    if (this.everLive.size === 0) return null;
    for (const key of this.everLive) {
      if (!this.liveNow.get(key)) return false;
    }
    return true;
  }
}
