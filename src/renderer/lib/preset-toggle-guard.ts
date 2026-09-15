/**
 * One control, two states - and a second click turns the preset back off.
 *
 * The preset row toggles: click to activate, click the active one to
 * deactivate. That is the right affordance (a user looking for "off" needs
 * something to click), but the state flips the moment the request returns,
 * so a double-click - or an impatient second click while the row still looks
 * unchanged - activates and then silently deactivates.
 *
 * PostHog, 2026-09: activate -> deactivate pairs 543 ms apart (Desktop, 8 Sep)
 * and 711 ms apart (web, 14 Sep, a customer's 5.4k-character preset). Both
 * reps then ran their next call on no preset at all and were shown the
 * "blank template" banner for it.
 *
 * The guard: a deactivate click on a preset activated less than
 * ACCIDENTAL_DEACTIVATE_WINDOW_MS ago is ignored. Deliberate deactivation is
 * still one click - just not within two seconds of turning it on.
 */

export const ACCIDENTAL_DEACTIVATE_WINDOW_MS = 2000;

export interface RecentActivation {
  presetId: string;
  at: number;
}

export function recordActivation(presetId: string | number, at: number): RecentActivation {
  return { presetId: String(presetId), at };
}

export function isAccidentalDeactivate(
  recent: RecentActivation | null | undefined,
  presetId: string | number,
  now: number,
  windowMs: number = ACCIDENTAL_DEACTIVATE_WINDOW_MS,
): boolean {
  if (!recent) return false;
  if (recent.presetId !== String(presetId)) return false;
  const elapsed = now - recent.at;
  return elapsed >= 0 && elapsed < windowMs;
}
