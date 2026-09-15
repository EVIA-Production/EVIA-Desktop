/**
 * Which preset notice the Listen window shows, and what it says.
 *
 * Four states, one slot. They come from two sources - the websocket's
 * `context_status` at session start and the insights payload during the call -
 * and more than one can be true at once, so precedence is decided here, once,
 * instead of by whichever response happened to arrive last:
 *
 *   unavailable  the chat's bound preset snapshot is gone (amber: degraded)
 *   mismatch     the call runs on preset A while the user activated B - or on
 *                no preset while B is active. The binding is immutable by
 *                design, so the honest message is which one this call has
 *                and that B applies from the next conversation.
 *   missing      no preset is bound and none is active. Fix: choose one.
 *   blank        the bound preset is the untouched template. Fix: fill it in.
 *
 * Production, 30 days to 2026-09-15: the old single banner fired for 13 chats,
 * 10 of them with NO preset bound. Every one of those reps was told "your
 * preset is still the blank template", which was false, and offered nothing
 * to click. Two of them had toggled a filled preset off by accident seconds
 * before the call.
 *
 * Pure: no React, no i18n import, so it is testable in node.
 */

export type PresetNoticeKind = 'unavailable' | 'mismatch' | 'missing' | 'blank';

export interface PresetNotice {
  kind: PresetNoticeKind;
  /** Preset bound to this chat, when known. */
  boundName?: string | null;
  /** The user's currently active preset, when known (mismatch only). */
  activeName?: string | null;
  /** Backend sentence for builds that predate `preset_status`. */
  legacyText?: string | null;
}

export interface PresetContextStatus {
  available?: boolean;
  preset_id?: number | string | null;
  preset_name?: string | null;
  active_preset_id?: number | string | null;
  active_preset_name?: string | null;
}

export interface PresetInsightFields {
  preset_unusable?: boolean;
  preset_status?: string;
  preset_missing?: boolean;
  preset_name?: string | null;
  preset_warning?: string | null;
}

const idOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized && normalized !== '0' ? normalized : null;
};

/** `context_status` from the websocket: unavailable flag + mismatch notice. */
export function noticeFromContextStatus(
  data: PresetContextStatus | null | undefined,
): { unavailable: boolean; mismatch: PresetNotice | null } {
  const unavailable = data?.available === false;
  // Older backends do not send `active_preset_id` at all. Absent is unknown,
  // and unknown is not a mismatch.
  if (!data || !('active_preset_id' in data)) {
    return { unavailable, mismatch: null };
  }
  const active = idOrNull(data.active_preset_id);
  const bound = idOrNull(data.preset_id);
  // A call bound to A while nothing is active still has A's context; that is
  // not worth a notice. Only an ACTIVE preset this call is not using is.
  if (active === null || active === bound) {
    return { unavailable, mismatch: null };
  }
  return {
    unavailable,
    mismatch: {
      kind: 'mismatch',
      boundName: bound === null ? null : (data.preset_name ?? null),
      activeName: data.active_preset_name ?? null,
    },
  };
}

/** The insights payload during the call: missing / blank, or nothing. */
export function noticeFromInsights(
  payload: PresetInsightFields | null | undefined,
): PresetNotice | null {
  if (!payload?.preset_unusable) return null;
  const status = payload.preset_status ?? (payload.preset_missing ? 'missing' : undefined);
  if (status === 'missing') {
    return { kind: 'missing' };
  }
  if (status === 'blank') {
    return { kind: 'blank', boundName: payload.preset_name ?? null };
  }
  // A backend that predates `preset_status` only sends the sentence. Show it
  // verbatim rather than guessing which of the two states it describes.
  return {
    kind: 'blank',
    boundName: payload.preset_name ?? null,
    legacyText: payload.preset_warning || null,
  };
}

/** One slot. Degraded context beats a wrong binding beats an empty binding. */
export function pickPresetNotice(state: {
  unavailable: boolean;
  mismatch: PresetNotice | null;
  insight: PresetNotice | null;
}): PresetNotice | null {
  if (state.unavailable) return { kind: 'unavailable' };
  if (state.mismatch) return state.mismatch;
  return state.insight;
}

export interface PresetNoticeCopy {
  title: string;
  /** Only the mismatch notice carries a second line; the rest are one header. */
  detail?: string;
  /** Tone drives the glyph and its colour: amber only for a degraded system state. */
  tone: 'caution' | 'guidance';
}

type Translate = (key: string) => string;

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => values[key] ?? '');

/**
 * Identity of a notice for dismissal: the same notice stays hidden once the
 * rep closed it, a different one (other kind, other preset) shows again.
 */
export function presetNoticeKey(notice: PresetNotice): string {
  return [notice.kind, notice.boundName ?? '', notice.activeName ?? '', notice.legacyText ?? ''].join('|');
}

/**
 * Title (and, for a mismatch, detail) for a notice. `t` resolves
 * `overlay.listen.presetNotice.*` keys; names are quoted with the language's
 * own quotation marks, which the i18n strings carry.
 *
 * No actions: a preset cannot be changed during a call, and the notice only
 * exists during one. The header names the state; fixing it is a Settings task
 * for after the call.
 */
export function presetNoticeCopy(notice: PresetNotice, t: Translate): PresetNoticeCopy {
  const k = (leaf: string) => t(`overlay.listen.presetNotice.${leaf}`);
  switch (notice.kind) {
    case 'unavailable':
      return { tone: 'caution', title: k('unavailableTitle') };
    case 'mismatch': {
      const active = notice.activeName || k('unnamedPreset');
      const detail = notice.boundName
        ? fill(k('mismatchDetailBound'), { bound: notice.boundName, active })
        : fill(k('mismatchDetailNone'), { active });
      return { tone: 'guidance', title: k('mismatchTitle'), detail };
    }
    case 'missing':
      return { tone: 'guidance', title: k('missingTitle') };
    case 'blank':
    default:
      return {
        tone: 'guidance',
        title: notice.boundName
          ? fill(k('blankTitleNamed'), { name: notice.boundName })
          : k('blankTitle'),
      };
  }
}
