import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import fs from 'fs'
import path from 'path'

export type MaterialSurface = 'modal' | 'overlay' | 'content' | 'popover' | 'utility'
export type MaterialMode = 'auto' | 'native' | 'custom'

type MaterialPolicy = {
  radius: number
  vibrancy: string
  windowsMaterial: 'mica' | 'acrylic'
  nativeInteractive: boolean
}

type NativeApplyResult = {
  supported: boolean
  applied: boolean
  reason?: string
}

type NativeGlassBridge = {
  isSupported: () => boolean
  apply: (
    handle: Buffer,
    configuration: {
      surface: MaterialSurface
      radius: number
      active: boolean
      interactive: boolean
    },
  ) => NativeApplyResult
  update: (
    handle: Buffer,
    configuration: {
      surface: MaterialSurface
      radius: number
      active: boolean
      interactive: boolean
    },
  ) => NativeApplyResult
  detach: (handle: Buffer) => NativeApplyResult
}

const POLICIES: Record<MaterialSurface, MaterialPolicy> = {
  modal: {
    radius: 22,
    vibrancy: 'popover',
    windowsMaterial: 'mica',
    nativeInteractive: false,
  },
  overlay: {
    // NSGlassEffectView expects a physical corner radius. Unlike CSS, an
    // arbitrarily large capsule radius can clip the hosted Chromium view.
    // The Taylos bar is 49px high, so 24px produces the intended capsule.
    radius: 24,
    vibrancy: 'hud',
    windowsMaterial: 'acrylic',
    nativeInteractive: false,
  },
  content: {
    radius: 18,
    vibrancy: 'under-window',
    windowsMaterial: 'acrylic',
    nativeInteractive: false,
  },
  popover: {
    radius: 14,
    vibrancy: 'popover',
    windowsMaterial: 'acrylic',
    nativeInteractive: false,
  },
  utility: {
    radius: 18,
    vibrancy: 'sidebar',
    windowsMaterial: 'mica',
    nativeInteractive: false,
  },
}

const configuredWindows = new WeakMap<BrowserWindow, { surface: MaterialSurface; mode: MaterialMode }>()
let nativeBridge: NativeGlassBridge | null | undefined

function bridgeCandidates(): string[] {
  if (process.platform !== 'darwin') return []

  const relative = path.join('native', 'macos-liquid-glass', 'build', 'Release', 'taylos_liquid_glass.node')
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
  if (process.platform !== 'darwin') return 'custom'

  const bridge = loadNativeBridge()
  return bridge?.isSupported() ? 'native' : 'custom'
}

export function materialQuery(surface: MaterialSurface, mode = getRequestedMaterialMode(surface)) {
  return { material: resolveMaterialMode(mode), surface }
}

export function materialWindowOptions(
  surface: MaterialSurface,
): Pick<BrowserWindowConstructorOptions, 'transparent' | 'backgroundColor' | 'hasShadow'> {
  void surface
  return {
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
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
    try {
      ;(win as any).setBackgroundMaterial(policy.windowsMaterial)
    } catch (error) {
      console.warn('[window-material] Windows background material unavailable:', error)
    }
  }
}

function clearElectronVibrancy(win: BrowserWindow) {
  if (process.platform !== 'darwin') return
  try {
    ;(win as any).setVibrancy(null)
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
    return bridge.apply(win.getNativeWindowHandle(), {
      surface,
      radius: policy.radius,
      active,
      interactive: policy.nativeInteractive,
    })
  } catch (error) {
    return { supported: true, applied: false, reason: String(error) }
  }
}

export function applyWindowMaterial(
  win: BrowserWindow,
  surface: MaterialSurface,
  mode: MaterialMode = getRequestedMaterialMode(surface),
) {
  const resolvedMode = resolveMaterialMode(mode)
  configuredWindows.set(win, { surface, mode: resolvedMode })
  setElectronFallback(win, surface)

  const tryNative = process.platform === 'darwin' && resolvedMode === 'native'
  const attach = () => {
    if (win.isDestroyed() || !tryNative) return
    const result = applyNativeBridge(win, surface, win.isFocused())
    if (result.applied) {
      clearElectronVibrancy(win)
      win.setHasShadow(true)
      console.log(`[window-material] Native ${surface} glass attached`)
    } else {
      setElectronFallback(win, surface)
      console.warn(`[window-material] Native ${surface} glass rejected; fallback active:`, result.reason)
    }
  }

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', attach)
  } else {
    attach()
  }

  const updateActiveState = (active: boolean) => {
    const configured = configuredWindows.get(win)
    if (!configured || configured.mode === 'custom' || win.isDestroyed()) return
    const bridge = loadNativeBridge()
    if (!bridge?.isSupported()) return
    const policy = POLICIES[configured.surface]
    try {
      bridge.update(win.getNativeWindowHandle(), {
        surface: configured.surface,
        radius: policy.radius,
        active,
        interactive: policy.nativeInteractive,
      })
    } catch (error) {
      console.warn('[window-material] Failed to update native active state:', error)
    }
  }

  win.on('focus', () => updateActiveState(true))
  // The Taylos overlay is ONE visual unit. Do not dim on blur when focus moves between
  // Taylos windows (bar / Listen / Ask) - otherwise button and panel styling flips per
  // window. An always-on-top overlay reads better staying consistently active.
  win.on('blur', () => updateActiveState(true))
  win.on('resize', () => {
    // Electron can resize a BrowserWindow after the native NSGlassEffectView is
    // attached. Refresh on the next main-loop turn so AppKit sees final bounds.
    setImmediate(() => updateActiveState(win.isFocused()))
  })
  win.once('closed', () => {
    const bridge = loadNativeBridge()
    if (!bridge || process.platform !== 'darwin') return
    try {
      bridge.detach(win.getNativeWindowHandle())
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
