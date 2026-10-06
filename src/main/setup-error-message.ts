/**
 * The message a person sees when onboarding cannot save their setup.
 *
 * 2026-09-21: eighteen "Could not save your context (400)" failures in a row
 * for one new user, then 429s. The server had said exactly why (for example
 * "This website could not be read. Remove it or use a document instead."),
 * and the app replaced that with a bare status code. Show the server's reason.
 */
export async function setupErrorMessage(response: { status: number; json: () => Promise<any> }): Promise<string> {
  if (response.status === 429) return 'Too many attempts. Please wait a minute, then try again.';
  if (response.status === 401 || response.status === 403) return 'Please sign in again to finish setup.';
  try {
    const body = await response.json();
    const detail = typeof body?.detail === 'string' ? body.detail.trim() : '';
    if (detail) return detail;
  } catch { /* not JSON */ }
  return `Setup could not be saved (${response.status}). Please try again.`;
}
