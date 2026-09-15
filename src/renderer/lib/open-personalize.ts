/**
 * Open the web app's preset editor (/personalize) from any overlay window.
 *
 * Presets are edited in the web app, not in the overlay. The Settings window
 * already opened it for "create your first preset"; the Listen window's
 * "Fill In Preset" action needs the same door, so the routine lives here.
 * Prefers the authenticated bridge (`evia.shell.navigate`), which carries the
 * Desktop token across; falls back to a plain external open.
 */
export const WEB_APP_URL = 'https://app.taylos.ai';

export async function openPersonalizePage(): Promise<void> {
  const evia = (window as any).evia;
  const shell = evia?.shell;
  const auth = evia?.auth;

  if (!shell?.navigate) {
    console.warn('[Personalize] Shell navigation API not available; opening externally');
    evia?.windows?.openExternal?.(`${WEB_APP_URL}/personalize`);
    return;
  }

  try {
    const token = await auth?.getToken?.();
    const url = token
      ? `${WEB_APP_URL}/personalize?desktop_token=${encodeURIComponent(token)}`
      : `${WEB_APP_URL}/personalize`;
    await shell.navigate(url);
  } catch (error) {
    console.error('[Personalize] Navigation request failed:', error);
  }
}
