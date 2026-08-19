/**
 * The menu-bar way back into Taylos.
 *
 * Reported by a customer on 2026-08-06: "Taylos als Icon oben verfügbar machen
 * damit man es wieder aufrufen kann wenn es minimiert wurde / der
 * unsichtbarkeitsmodus aktiv ist". Until now the only way back was the global
 * hotkey, which is invisible and therefore only works for someone who already
 * knows it exists. Hiding the app was reversible in principle and unrecoverable
 * in practice.
 *
 * The icon exists only while the UI is hidden, and removes itself the moment
 * the UI is back, so the menu bar stays clean during normal use and the icon
 * means exactly one thing: "your overlay is hidden, click to get it back".
 *
 * ── One thing this deliberately does NOT do ──────────────────────────────────
 * It cannot hide itself from a screen share. Electron's Tray wraps an
 * NSStatusItem and exposes no content-protection control; setContentProtection
 * is a BrowserWindow method and there is no status-item equivalent. So the
 * requested "invisible to screenshare while incognito is on" is not
 * implementable here, and pretending otherwise would be worse than not
 * shipping it - someone would rely on it during a real customer call.
 *
 * The mitigation is in the artwork instead: a template image renders as a plain
 * monochrome glyph, indistinguishable at a glance from the dozen other menu-bar
 * items, rather than as a branded colour badge that reads as "this person is
 * running a sales assistant".
 */

import { app, nativeImage, Tray } from 'electron'
import path from 'node:path'

type TrayLanguage = 'de' | 'en'

/** Hover text. The rep sees this in the language they picked in the app. */
const TOOLTIP: Record<TrayLanguage, string> = {
  de: 'Taylos einblenden',
  en: 'Show Taylos',
}

let tray: Tray | null = null
let language: TrayLanguage | null = null
let restore: (() => void) | null = null

/**
 * The renderer owns the language (i18n lives there) and broadcasts changes on
 * `language-changed`. Before the first broadcast, fall back to the system
 * locale rather than to English - a German user should not get one English
 * tooltip on the first hide of every launch.
 */
function currentLanguage(): TrayLanguage {
  if (language) return language
  return app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en'
}

function trayIconPath(): string {
  // `...Template` is not decoration: macOS only auto-inverts the glyph for
  // light and dark menu bars when the name carries that suffix.
  const file = 'trayTemplate.png'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', file)
    : path.join(__dirname, '..', '..', 'src', 'main', 'assets', file)
}

export function setTrayLanguage(next: string | null | undefined): void {
  const normalized: TrayLanguage = String(next || '').toLowerCase().startsWith('de') ? 'de' : 'en'
  if (normalized === language) return
  language = normalized
  if (tray && !tray.isDestroyed()) tray.setToolTip(TOOLTIP[normalized])
}

/** Called once at startup with the action that brings the overlay back. */
export function initTray(onRestore: () => void): void {
  restore = onRestore
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return
  const image = nativeImage.createFromPath(trayIconPath())
  if (image.isEmpty()) {
    // Loud, because this is a recovery path: if it is missing in a packaged
    // build, the hotkey is once again the only way back and the user has no
    // way to discover that.
    console.error('[tray] ❌ icon missing at', trayIconPath(), '- no menu-bar restore available')
    return
  }
  image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip(TOOLTIP[currentLanguage()])
  // No context menu on purpose. The icon has exactly one job, and a menu would
  // turn a single click into two plus a decision.
  tray.on('click', () => restore?.())
  console.log('[tray] menu-bar restore icon shown')
}

function destroyTray(): void {
  if (!tray) return
  if (!tray.isDestroyed()) tray.destroy()
  tray = null
  console.log('[tray] menu-bar restore icon removed')
}

/**
 * Single entry point: the icon is a pure function of whether the UI is hidden.
 * Call it after anything that hides or shows the overlay, and it converges -
 * calling it twice with the same state does nothing.
 */
export function syncTray(uiHidden: boolean): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  if (uiHidden) createTray()
  else destroyTray()
}

export function disposeTray(): void {
  destroyTray()
  restore = null
}
