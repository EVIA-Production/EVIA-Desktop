import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import fs from 'fs'
import path from 'path'

export type MaterialSurface = 'modal' | 'overlay' | 'content' | 'popover' | 'utility'
export type MaterialMode = 'auto' | 'native' | 'custom'

type MaterialPolicy = {
  radius: number
  vibrancy: string
  windowsBlurAmount: number
  windowsTintOpacity: number
  nativeInteractive: boolean
}

type NativeApplyResult = {
  supported: boolean
  applied: boolean
  reason?: string
}

type NativeGlassBridge = {
  isSupported: () => boolean
  isKeyPressed?: (keyCode: number) => boolean
  isMouseButtonPressed?: (button: number) => boolean
  isCharacterChordPressed?: (character: string, control: boolean) => boolean
  apply: (
    handle: Buffer,
    configuration: {
      surface: MaterialSurface
      radius: number
      active: boolean
      interactive: boolean
      blurAmount?: number
      tintOpacity?: number
      materialWidth?: number
      materialHeight?: number
      visible?: boolean
    },
  ) => NativeApplyResult
  update: (
    handle: Buffer,
    configuration: {
      surface: MaterialSurface
      radius: number
      active: boolean
      interactive: boolean
      blurAmount?: number
      tintOpacity?: number
      materialWidth?: number
      materialHeight?: number
    },
  ) => NativeApplyResult
  setVisible?: (handle: Buffer, visible: boolean) => NativeApplyResult
  detach: (handle: Buffer) => NativeApplyResult
}

export function isPhysicalKeyPressed(keyCode: number): boolean | null {
  if (
    (process.platform !== 'darwin' && process.platform !== 'win32') ||
    !Number.isInteger(keyCode)
  ) return null
  const bridge = loadNativeBridge()
  if (!bridge?.isKeyPressed) return null
  try {
    return bridge.isKeyPressed(keyCode)
  } catch (error) {
    console.warn('[window-material] Failed to read physical key state:', error)
    return null
  }
}

export function isPhysicalMouseButtonPressed(button: number): boolean | null {
  if (
    (process.platform !== 'darwin' && process.platform !== 'win32') ||
    !Number.isInteger(button) ||
    button < 0 ||
    button > 2
  ) return null
  const bridge = loadNativeBridge()
  if (!bridge?.isMouseButtonPressed) return null
  try {
    return bridge.isMouseButtonPressed(button)
  } catch (error) {
    console.warn('[window-material] Failed to read physical mouse-button state:', error)
    return null
  }
}

export function isWindowsCharacterChordPressed(character: string): boolean | null {
  if (process.platform !== 'win32' || character.length !== 1) return null
  const bridge = loadNativeBridge()
  if (!bridge?.isCharacterChordPressed) return null
  try {
    return bridge.isCharacterChordPressed(character, true)
  } catch (error) {
    console.warn('[window-material] Failed to read Windows character chord:', error)
    return null
  }
}

const POLICIES: Record<MaterialSurface, MaterialPolicy> = {
  modal: {
    radius: 22,
    vibrancy: 'popover',
    windowsBlurAmount: 30,
    windowsTintOpacity: 0,
    nativeInteractive: false,
  },
  overlay: {
    // NSGlassEffectView expects a physical corner radius. Unlike CSS, an
    // arbitrarily large capsule radius can clip the hosted Chromium view.
    // The Taylos bar is 49px high, so 24px produces the intended capsule.
    radius: 24,
    // `under-window`, not `hud`, purely for consistency with `content`.
    //
    // This does NOT fix the washout reported on 2026-08-22, and the earlier
    // comment here claiming it did was wrong. Two things rule it out: when the
    // native bridge attaches, `clearElectronVibrancy()` removes the Electron
    // vibrancy entirely, so this value is dead on exactly the machines that
    // show the bug; and the Ask window washed out too while already sharing
    // `content` with the Listen window that looked correct.
    //
    // The real cause is compositing, not material - see the note beside
    // `.evia-main-header` in liquid-glass.css. What remains true is that on the
    // FALLBACK path (no NSGlassEffectView) matching `content` is the better
    // default: hudWindow is a self-contained dark HUD material, while
    // underWindowBackground samples the desktop like every other surface.
    vibrancy: 'under-window',
    windowsBlurAmount: 24,
    windowsTintOpacity: 0,
    nativeInteractive: false,
  },
  content: {
    radius: 18,
    vibrancy: 'under-window',
    windowsBlurAmount: 28,
    windowsTintOpacity: 0,
    nativeInteractive: false,
  },
  popover: {
    radius: 14,
    vibrancy: 'popover',
    windowsBlurAmount: 28,
    windowsTintOpacity: 0,
    nativeInteractive: false,
  },
  utility: {
    radius: 18,
    vibrancy: 'sidebar',
    windowsBlurAmount: 30,
    windowsTintOpacity: 0,
    nativeInteractive: false,
  },
}

const configuredWindows = new WeakMap<BrowserWindow, { surface: MaterialSurface; mode: MaterialMode }>()
const materialActiveStateUpdaters = new WeakMap<BrowserWindow, (active: boolean) => void>()
let nativeBridge: NativeGlassBridge | null | undefined

export function setWindowMaterialActive(win: BrowserWindow, active: boolean): void {
  materialActiveStateUpdaters.get(win)?.(active)
}

export function setWindowMaterialVisible(win: BrowserWindow, visible: boolean): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return
  const bridge = loadNativeBridge()
  if (!bridge?.setVisible) return
  try {
    bridge.setVisible(win.getNativeWindowHandle(), visible)
  } catch (error) {
    console.warn('[window-material] Failed to update native material visibility:', error)
  }
}

function bridgeCandidates(): string[] {
  const relative = process.platform === 'darwin'
    ? path.join('native', 'macos-liquid-glass', 'build', 'Release', 'taylos_liquid_glass.node')
    : process.platform === 'win32'
      ? path.join(
          'native',
          'windows-liquid-glass',
          'prebuilds',
          `win32-${process.arch}`,
          'taylos_windows_glass.node',
        )
      : null
  if (!relative) return []

  return [
    path.join(app.getAppPath(), relative),
    path.join(process.resourcesPath, 'app.asar.unpacked', relative),
    path.join(process.resourcesPath, relative),
  ]
}

function loadNativeBridge(): NativeGlassBridge | null {
  if (nativeBridge !== undefined) return nativeBridge
  nativeBridge = null

  for (const candidate of bridgeCandidates()) {
    if (!fs.existsSync(candidate)) continue
    try {
      // N-API keeps this binary ABI-stable between Node and Electron.
      nativeBridge = require(candidate) as NativeGlassBridge
      console.log('[window-material] Loaded native glass bridge:', candidate)
      return nativeBridge
    } catch (error) {
      console.warn('[window-material] Native bridge failed to load:', candidate, error)
    }
  }

  return null
}

function parseMaterialMode(value: string | undefined): MaterialMode | null {
  const requested = value?.toLowerCase()
  return requested === 'auto' || requested === 'native' || requested === 'custom'
    ? requested
    : null
}

export function getRequestedMaterialMode(surface?: MaterialSurface): MaterialMode {
  // Per-surface overrides are internal release switches. They allow one shell
  // to fall back without reverting product behavior or another approved shell.
  if (surface) {
    const override = parseMaterialMode(
      process.env[`TAYLOS_GLASS_${surface.toUpperCase()}_MODE`],
    )
    if (override) return override
  }

  // The global selector is intentionally development-only. Production uses
  // automatic native capability detection unless a surface override is set.
  if (process.env.NODE_ENV !== 'development') return 'auto'
  return parseMaterialMode(process.env.TAYLOS_GLASS_MODE) ?? 'auto'
}

export function resolveMaterialMode(mode: MaterialMode = getRequestedMaterialMode()): Exclude<MaterialMode, 'auto'> {
  if (mode === 'custom') return 'custom'
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'custom'

  const bridge = loadNativeBridge()
  return bridge?.isSupported() ? 'native' : 'custom'
}

export function materialQuery(surface: MaterialSurface, mode = getRequestedMaterialMode(surface)) {
  return { material: resolveMaterialMode(mode), surface, platform: process.platform }
}

export function materialWindowOptions(
  surface: MaterialSurface,
): Pick<
  BrowserWindowConstructorOptions,
  'transparent' | 'backgroundColor' | 'hasShadow' | 'roundedCorners' | 'thickFrame'
> {
  void surface
  return {
    transparent: true,
    backgroundColor: '#00000000',
    // AppKit and DWM both calculate their shadow from the final native window
    // shape. Windows receives an explicit rounded HWND region before reveal,
    // so its shadow follows the glass instead of the compositor's rectangular
    // backing surface.
    hasShadow: true,
    ...(process.platform === 'win32'
      ? { roundedCorners: false, thickFrame: false }
      : {}),
  }
}

function setElectronFallback(win: BrowserWindow, surface: MaterialSurface) {
  const policy = POLICIES[surface]

  if (process.platform === 'darwin') {
    try {
      ;(win as any).setVibrancy(policy.vibrancy)
    } catch (error) {
      console.warn('[window-material] Electron vibrancy fallback unavailable:', error)
    }
  } else if (process.platform === 'win32') {
    // Do not call setBackgroundMaterial, including with "none". Electron's
    // setter reconfigures the full HWND and can restore the exact rectangular
    // backing this module exists to avoid. CSS supplies the dark fallback.
    win.setHasShadow(true)
  }
}

function clearElectronMaterial(win: BrowserWindow) {
  try {
    if (process.platform === 'darwin') {
      ;(win as any).setVibrancy(null)
    }
  } catch {
    // The native host is already active; lack of this optional API is harmless.
  }
}

function applyNativeBridge(
  win: BrowserWindow,
  surface: MaterialSurface,
  active: boolean,
): NativeApplyResult {
  const bridge = loadNativeBridge()
  const policy = POLICIES[surface]
  if (!bridge || !bridge.isSupported()) {
    return { supported: false, applied: false, reason: 'native_glass_unavailable' }
  }

  try {
    const materialBounds = win.getBounds()
    return bridge.apply(win.getNativeWindowHandle(), {
      surface,
      radius: policy.radius,
      active,
      interactive: policy.nativeInteractive,
      ...(process.platform === 'win32'
        ? {
            blurAmount: policy.windowsBlurAmount,
            tintOpacity: policy.windowsTintOpacity,
            materialWidth: materialBounds.width,
            materialHeight: materialBounds.height,
            // Chromium and the independent DesktopWindowTarget must reveal as
            // one frame. The overlay controller turns this on only after the
            // hidden renderer has produced two presentation frames.
            visible: false,
          }
        : {}),
    })
  } catch (error) {
    return { supported: true, applied: false, reason: String(error) }
  }
}

function nativeMaterialActiveState(surface: MaterialSurface, windowIsActive: boolean): boolean {
  void surface
  // Tahoe deliberately lets glass recede when its window loses focus. Keep the
  // focus signal intact on every surface so Windows and AppKit share the same
  // active/inactive contract.
  return windowIsActive
}

export function applyWindowMaterial(
  win: BrowserWindow,
  surface: MaterialSurface,
  mode: MaterialMode = getRequestedMaterialMode(surface),
  applicationActive = false,
) {
  const resolvedMode = resolveMaterialMode(mode)
  configuredWindows.set(win, { surface, mode: resolvedMode })

  const tryNative =
    (process.platform === 'darwin' || process.platform === 'win32') &&
    resolvedMode === 'native'
  // Electron may invalidate the HWND/NSView before `closed` fires. Retain the
  // opaque handle while the window is alive so the native host always detaches.
  const nativeHandle = tryNative ? Buffer.from(win.getNativeWindowHandle()) : null
  if (!tryNative) setElectronFallback(win, surface)
  const attach = (): boolean => {
    if (win.isDestroyed() || !tryNative) return false
    const result = applyNativeBridge(
      win,
      surface,
      nativeMaterialActiveState(surface, applicationActive),
    )
    if (result.applied) {
      clearElectronMaterial(win)
      win.setHasShadow(true)
      console.log(`[window-material] Native ${surface} glass attached`)
      return true
    } else {
      setElectronFallback(win, surface)
      console.warn(`[window-material] Native ${surface} glass rejected; fallback active:`, result.reason)
      return false
    }
  }

  // The HWND/NSWindow exists as soon as BrowserWindow returns. Attach now,
  // while `show:false` still guarantees that no rectangular backing surface
  // can reach the screen. A delayed retry remains for the rare platform case
  // where the native host is not ready until navigation completes.
  const attachedBeforeNavigation = attach()
  if (!attachedBeforeNavigation && tryNative && win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) attach()
    })
  }

  let currentApplicationActive = applicationActive
  const updateActiveState = (active: boolean) => {
    currentApplicationActive = active
    const configured = configuredWindows.get(win)
    if (!configured || configured.mode === 'custom' || win.isDestroyed()) return
    // A minimized Windows HWND temporarily reports the compact system icon
    // bounds. Never let those dimensions replace the restored glass clip.
    if (process.platform === 'win32' && win.isMinimized()) return
    const bridge = loadNativeBridge()
    if (!bridge?.isSupported()) return
    const policy = POLICIES[configured.surface]
    try {
      const materialBounds = win.getBounds()
      bridge.update(win.getNativeWindowHandle(), {
        surface: configured.surface,
        radius: policy.radius,
        active: nativeMaterialActiveState(configured.surface, active),
        interactive: policy.nativeInteractive,
        ...(process.platform === 'win32'
          ? {
              blurAmount: policy.windowsBlurAmount,
              tintOpacity: policy.windowsTintOpacity,
              materialWidth: materialBounds.width,
              materialHeight: materialBounds.height,
            }
          : {}),
      })
    } catch (error) {
      console.warn('[window-material] Failed to update native active state:', error)
    }
  }

  materialActiveStateUpdaters.set(win, updateActiveState)

  const scheduleGeometryRefresh = () => {
    // Focus/show/restore can settle one task after Electron emits the event.
    // Refresh twice so both the immediate HWND and its final DWM geometry are
    // repaired without changing the shared application-level focus state.
    setImmediate(() => updateActiveState(currentApplicationActive))
    const timer = setTimeout(() => updateActiveState(currentApplicationActive), 50)
    timer.unref()
  }

  win.on('resize', scheduleGeometryRefresh)
  win.on('show', scheduleGeometryRefresh)
  win.on('restore', scheduleGeometryRefresh)
  win.once('closed', () => {
    const bridge = loadNativeBridge()
    if (!bridge || !nativeHandle) return
    try {
      bridge.detach(nativeHandle)
    } catch {
      // BrowserWindow teardown may invalidate the NSView before this event.
    }
  })
}

export function nativeGlassAvailability() {
  const bridge = loadNativeBridge()
  return {
    bridgeLoaded: Boolean(bridge),
    supported: Boolean(bridge?.isSupported()),
  }
}
