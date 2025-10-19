// Shared renderer helpers

/**
 * Append a line to a textarea-like log element and autoscroll.
 * Defaults to an element with id "log".
 */
export function log(line: string, targetId = "log"): void {
  try {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!el) return;
    el.value += line + "\n";
    el.scrollTop = el.scrollHeight;
  } catch {
    // ignore DOM errors in non-DOM contexts
  }
}
