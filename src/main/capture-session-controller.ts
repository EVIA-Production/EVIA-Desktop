export type CaptureSessionState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'review'
  | 'error'

export type CaptureTransitionReason =
  | 'user_start'
  | 'capture_started'
  | 'capture_start_failed'
  | 'user_stop'
  | 'capture_stopped'
  | 'capture_stop_failed'
  | 'user_done'
  | 'backend_review_recovered'
  | 'capture_context_lost'
  | 'language_changed'
  | 'logout'
  | 'app_shutdown'
  | 'test_reset'

export type CaptureSessionSnapshot = {
  state: CaptureSessionState
  generation: number
  changedAt: number
  reason: CaptureTransitionReason | 'initialized'
  errorCode: string | null
}

export type CaptureTransitionResult = {
  accepted: boolean
  changed: boolean
  reason: string
  snapshot: CaptureSessionSnapshot
}

type TransitionListener = (
  current: CaptureSessionSnapshot,
  previous: CaptureSessionSnapshot,
) => void

/**
 * Process-local source of truth for capture lifecycle.
 *
 * Browser storage and backend meeting state cannot resurrect active capture.
 * A renderer may restore only the non-capturing review state after confirming
 * the authenticated backend session is paused.
 */
export class CaptureSessionController {
  private snapshot: CaptureSessionSnapshot
  private listeners = new Set<TransitionListener>()

  constructor(private readonly now: () => number = Date.now) {
    this.snapshot = {
      state: 'idle',
      generation: 0,
      changedAt: this.now(),
      reason: 'initialized',
      errorCode: null,
    }
  }

  getSnapshot(): CaptureSessionSnapshot {
    return { ...this.snapshot }
  }

  subscribe(listener: TransitionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  beginStart(): CaptureTransitionResult {
    if (this.snapshot.state === 'starting' || this.snapshot.state === 'recording') {
      return this.noop(true, 'start_already_in_progress')
    }
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'error') {
      return this.noop(false, `cannot_start_from_${this.snapshot.state}`)
    }

    return this.transition('starting', 'user_start', {
      generation: this.snapshot.generation + 1,
      errorCode: null,
    })
  }

  confirmStarted(generation: number): CaptureTransitionResult {
    if (!this.matches('starting', generation)) {
      return this.noop(false, 'stale_or_invalid_start_confirmation')
    }
    return this.transition('recording', 'capture_started')
  }

  failStart(generation: number, errorCode = 'capture_start_failed'): CaptureTransitionResult {
    if (!this.matches('starting', generation)) {
      return this.noop(false, 'stale_or_invalid_start_failure')
    }
    this.transition('error', 'capture_start_failed', { errorCode })
    return this.transition('idle', 'capture_start_failed', { errorCode })
  }

  beginStop(): CaptureTransitionResult {
    if (this.snapshot.state === 'stopping') {
      return this.noop(true, 'stop_already_in_progress')
    }
    if (this.snapshot.state !== 'recording') {
      return this.noop(false, `cannot_stop_from_${this.snapshot.state}`)
    }
    return this.transition('stopping', 'user_stop')
  }

  confirmStopped(generation: number): CaptureTransitionResult {
    if (!this.matches('stopping', generation)) {
      return this.noop(false, 'stale_or_invalid_stop_confirmation')
    }
    return this.transition('review', 'capture_stopped')
  }

  failStop(generation: number, errorCode = 'capture_stop_failed'): CaptureTransitionResult {
    if (!this.matches('stopping', generation)) {
      return this.noop(false, 'stale_or_invalid_stop_failure')
    }
    // Capture is still physically active when stopping fails. Keep the public
    // state truthful instead of briefly broadcasting Listen from `error`.
    return this.transition('recording', 'capture_stop_failed', { errorCode })
  }

  complete(generation: number): CaptureTransitionResult {
    if (!this.matches('review', generation)) {
      return this.noop(false, 'stale_or_invalid_completion')
    }
    return this.transition('idle', 'user_done', { errorCode: null })
  }

  restoreReview(): CaptureTransitionResult {
    if (this.snapshot.state === 'review') {
      return this.noop(true, 'review_already_restored')
    }
    if (this.snapshot.state !== 'idle') {
      return this.noop(false, `cannot_restore_review_from_${this.snapshot.state}`)
    }
    return this.transition('review', 'backend_review_recovered', {
      generation: this.snapshot.generation + 1,
      errorCode: null,
    })
  }

  reconcileNoCapture(reason: CaptureTransitionReason = 'capture_context_lost'): CaptureTransitionResult {
    if (this.snapshot.state === 'idle') {
      return this.noop(true, 'already_idle')
    }
    return this.transition('idle', reason, { errorCode: null })
  }

  reset(reason: CaptureTransitionReason = 'test_reset'): CaptureTransitionResult {
    return this.transition('idle', reason, { errorCode: null })
  }

  private matches(expectedState: CaptureSessionState, generation: number): boolean {
    return this.snapshot.state === expectedState && this.snapshot.generation === generation
  }

  private noop(accepted: boolean, reason: string): CaptureTransitionResult {
    return { accepted, changed: false, reason, snapshot: this.getSnapshot() }
  }

  private transition(
    state: CaptureSessionState,
    reason: CaptureTransitionReason,
    patch: Partial<Pick<CaptureSessionSnapshot, 'generation' | 'errorCode'>> = {},
  ): CaptureTransitionResult {
    const previous = this.getSnapshot()
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      state,
      reason,
      changedAt: this.now(),
    }
    const current = this.getSnapshot()
    this.listeners.forEach((listener) => listener(current, previous))
    return { accepted: true, changed: true, reason, snapshot: current }
  }
}

export const captureSessionController = new CaptureSessionController()
