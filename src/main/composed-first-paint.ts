type FirstPaintWebContents = {
  once: (event: 'did-finish-load', listener: () => void) => void
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
}

type FirstPaintWindow = {
  setOpacity: (opacity: number) => void
  webContents: FirstPaintWebContents
}

type FirstPaintOptions = {
  platform?: NodeJS.Platform
  timeoutMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  warn?: (message: string) => void
}

export const WINDOWS_FIRST_PAINT_FAIL_OPEN_MS = 1_500

const WINDOWS_FIRST_PAINT_SCRIPT =
  'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'

/**
 * Synchronizes Chromium's first frame with the native Windows composition host.
 * Other platforms do not have that independent DWM surface and must never wait
 * on animation frames from a hidden renderer before becoming visible.
 */
export function armComposedFirstPaintBarrier(
  win: FirstPaintWindow,
  label: string,
  complete: () => void,
  options: FirstPaintOptions = {},
): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    complete()
    return
  }

  const timeoutMs = options.timeoutMs ?? WINDOWS_FIRST_PAINT_FAIL_OPEN_MS
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const warn = options.warn ?? console.warn

  win.setOpacity(0)

  let finished = false
  let failOpenTimer: ReturnType<typeof setTimeout> | undefined
  const finish = (reason: 'renderer-frames' | 'timeout' | 'renderer-error') => {
    if (finished) return
    finished = true
    if (failOpenTimer !== undefined) clearTimeoutFn(failOpenTimer)
    if (reason !== 'renderer-frames') {
      warn(`[overlay-windows] First-paint barrier opened via ${reason}: ${label}`)
    }
    complete()
  }

  // This watchdog starts before navigation. It covers a renderer that never
  // emits did-finish-load as well as a hidden renderer whose rAF never settles.
  failOpenTimer = setTimeoutFn(() => finish('timeout'), timeoutMs)

  win.webContents.once('did-finish-load', () => {
    try {
      void win.webContents
        .executeJavaScript(WINDOWS_FIRST_PAINT_SCRIPT, true)
        .then(
          () => finish('renderer-frames'),
          () => finish('renderer-error'),
        )
    } catch {
      finish('renderer-error')
    }
  })
}
