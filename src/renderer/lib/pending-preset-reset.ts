/**
 * A preset change arms a session reset. It does not perform one.
 *
 * The first version cleared the session the moment a preset was activated. That
 * is safe but destructive: toggling a preset to look at it, or activating the
 * wrong one by accident, threw away the Ask content with no way back. It is the
 * same mistake as the settings page discarding typed text on "set active" -
 * punishing a reversible action with an irreversible one.
 *
 * The guarantee that actually matters is narrower: no suggestion generated
 * under preset A may end up in a session bound to preset B. That is preserved
 * exactly by resetting immediately BEFORE the next interaction rather than
 * immediately after the toggle. So:
 *
 *   activate/deactivate  ->  arm()          nothing is cleared, nothing is lost
 *   next question asked  ->  consume()      reset first, then the question
 *   listening started    ->  consume()      reset first, then the session
 *
 * After the reset the old responses are gone from history on purpose: being
 * able to page back to an answer that was generated under a different preset is
 * exactly the confusion this exists to prevent.
 *
 * Stored in BOTH localStorage and the shared prefs store, mirroring how
 * `current_chat_id` is handled - the overlay windows are separate renderers,
 * and a flag that lives in one of them is not a flag at all.
 */

const KEY = 'pending_preset_session_reset'

/** Record that the active preset changed. Clears nothing. */
export function armPresetSessionReset(presetId: string | number | null): void {
  const value = JSON.stringify({ presetId: presetId == null ? null : String(presetId), at: Date.now() })
  try {
    localStorage.setItem(KEY, value)
  } catch {}
  try {
    ;(window as any).evia?.prefs?.set?.({ [KEY]: value })
  } catch {}
}

/** True exactly once per preset change, for whichever interaction comes first. */
export function consumePresetSessionReset(): boolean {
  let armed = false
  try {
    armed = Boolean(localStorage.getItem(KEY))
  } catch {}
  if (!armed) {
    // The Ask and Listen windows are separate renderers; if one of them cannot
    // see localStorage the shared store is the fallback, not a second source of
    // truth.
    try {
      const shared = (window as any).evia?.prefs?.getSync?.(KEY)
      armed = Boolean(shared)
    } catch {}
  }
  if (!armed) return false
  try {
    localStorage.removeItem(KEY)
  } catch {}
  try {
    ;(window as any).evia?.prefs?.set?.({ [KEY]: null })
  } catch {}
  return true
}

/** Drop the chat binding so the next interaction opens a new session. */
export function clearSessionBinding(): void {
  try {
    localStorage.removeItem('current_chat_id')
  } catch {}
  try {
    ;(window as any).evia?.prefs?.set?.({ current_chat_id: null })
  } catch {}
  try {
    ;(window as any).evia?.liveTranscript?.clear?.()
  } catch {}
}
