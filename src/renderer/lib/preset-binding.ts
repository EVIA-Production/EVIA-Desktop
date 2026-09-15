/**
 * Does the chat this window would reuse still match the preset the user has
 * active? If not, drop the binding so the next interaction mints a fresh chat.
 *
 * A chat is bound to a preset once, at creation (`POST /chat/`), and the
 * binding is immutable by design. The Desktop covers its OWN activations by
 * arming a session reset (lib/pending-preset-reset). What it could not see
 * until now:
 *
 *   - a preset activated or deactivated in the web app (app.taylos.ai)
 *   - a chat id that survived an app restart in the shared prefs store, bound
 *     to whatever was active days ago
 *
 * Both leave the rep talking on a preset they did not choose, or on none,
 * with the only clue being generic suggestions. `getOrCreateChatId` now stores
 * the preset a chat was bound to next to the chat id, so the comparison costs
 * one presets list - and it fails OPEN: no answer within the budget means keep
 * the chat, never block the Listen click on a slow connection.
 *
 * Pure decision + injectable effects, so the rule is testable in node.
 */

export type PresetBindingVerdict = 'reset' | 'match' | 'unknown' | 'skipped';

const idOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized && normalized !== '0' ? normalized : null;
};

/**
 * `bound` undefined means the chat predates this build and its binding is not
 * recorded; that is "no information", not a mismatch.
 */
export function presetBindingMismatch(
  bound: string | number | null | undefined,
  active: string | number | null | undefined,
): boolean {
  if (bound === undefined) return false;
  return idOrNull(bound) !== idOrNull(active);
}

export interface PresetBindingDeps {
  /** Shared main-process prefs (`{ ok, data }` envelope or the data itself). */
  readPrefs: () => Promise<unknown>;
  /** `evia.presets.list()` result: `{ ok, prompts: [{ id, is_active }] }`. */
  listPresets: () => Promise<unknown>;
  /** Drop chat id + binding everywhere (lib/pending-preset-reset). */
  clearBinding: () => void;
  /** Never touch a live call. */
  isIdle: () => boolean;
  now?: () => number;
  log?: (message: string) => void;
}

function prefsData(raw: unknown): Record<string, unknown> {
  const envelope = raw as { data?: unknown } | null | undefined;
  const data = envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : raw;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function activePresetId(raw: unknown): string | null | undefined {
  const result = raw as { ok?: boolean; prompts?: unknown } | null | undefined;
  if (!result?.ok || !Array.isArray(result.prompts)) return undefined;
  const active = result.prompts.find(
    (p) => p && typeof p === 'object' && (p as { is_active?: boolean }).is_active === true,
  ) as { id?: unknown } | undefined;
  return active ? idOrNull(active.id) : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
}

/**
 * Compare the reusable chat's binding with the active preset; on a mismatch
 * clear the binding so the next chat is minted against the right preset.
 */
export async function ensureSessionMatchesActivePreset(
  deps: PresetBindingDeps,
  { timeoutMs = 700 }: { timeoutMs?: number } = {},
): Promise<PresetBindingVerdict> {
  const log = deps.log ?? (() => {});
  if (!deps.isIdle()) return 'skipped';

  let prefs: Record<string, unknown>;
  try {
    prefs = prefsData(await withTimeout(deps.readPrefs(), timeoutMs));
  } catch {
    return 'unknown';
  }
  const chatId = idOrNull(prefs.current_chat_id);
  // No reusable chat: the next one is created against the active preset.
  if (chatId === null) return 'match';
  if (!('current_chat_preset_id' in prefs)) {
    log(`[PresetBinding] chat ${chatId} predates binding records; leaving it`);
    return 'unknown';
  }
  const bound = prefs.current_chat_preset_id as string | number | null;

  const active = activePresetId(await withTimeout(deps.listPresets(), timeoutMs));
  if (active === undefined) {
    log(`[PresetBinding] preset list unavailable within ${timeoutMs}ms; keeping chat ${chatId}`);
    return 'unknown';
  }
  if (!presetBindingMismatch(bound, active)) return 'match';
  // The answer arrived asynchronously; if a call started meanwhile, the chat
  // it pinned must not be pulled out from under it.
  if (!deps.isIdle()) return 'skipped';

  log(
    `[PresetBinding] chat ${chatId} is bound to preset ${idOrNull(bound) ?? 'none'} ` +
      `but ${active ?? 'none'} is active - starting a new session`,
  );
  deps.clearBinding();
  return 'reset';
}
