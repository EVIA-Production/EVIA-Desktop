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
import { existsSync } from 'node:fs'
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
  // light and dark menu bars when the name carries that suffix. Electron finds
  // the @2x/@3x siblings itself by looking next to this file - and @2x is the
  // one a Retina menu bar actually draws.
  const file = 'trayTemplate.png'
  const inAsar = path.join(__dirname, '..', '..', 'src', 'main', 'assets', file)
  if (!app.isPackaged) return inAsar
  // Prefer the unpacked copy, but fall back into the asar rather than losing
  // the only visible way back if asarUnpack ever stops matching this glob.
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'main', 'assets', file)
  return existsSync(unpacked) ? unpacked : inAsar
}

function createWindowsContrastIcon(source: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = source.getSize()
  const input = source.toBitmap()
  if (width <= 0 || height <= 0 || input.length !== width * height * 4) return source

  const output = Buffer.alloc(input.length)
  const alphaAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    return input[(y * width + x) * 4 + 3]
  }

  // Windows does not honor macOS template-image inversion. First dilate the
  // source alpha by one physical pixel to form a black contour, then draw the
  // original silhouette in white. The result remains visible on both light and
  // dark taskbars without changing the established Taylos glyph.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      let outlineAlpha = 0
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          outlineAlpha = Math.max(outlineAlpha, alphaAt(x + ox, y + oy))
        }
      }
      output[offset] = 0
      output[offset + 1] = 0
      output[offset + 2] = 0
      output[offset + 3] = outlineAlpha

      const sourceAlpha = input[offset + 3]
      if (sourceAlpha > 0) {
        output[offset] = 255
        output[offset + 1] = 255
        output[offset + 2] = 255
        output[offset + 3] = sourceAlpha
      }
    }
  }

  return nativeImage.createFromBitmap(output, { width, height, scaleFactor: 1 })
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
  let image = nativeImage.createFromPath(trayIconPath())
  if (image.isEmpty()) {
    // Loud, because this is a recovery path: if it is missing in a packaged
    // build, the hotkey is once again the only way back and the user has no
    // way to discover that.
    console.error('[tray] ❌ icon missing at', trayIconPath(), '- no menu-bar restore available')
    return
  }
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  } else if (process.platform === 'win32') {
    image = createWindowsContrastIcon(image)
  }
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
