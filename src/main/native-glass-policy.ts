/**
 * Native window glass needs GPU compositing on Windows. With software
 * compositing (no active GPU driver), the glass bridge crashed the Electron
 * main process as soon as glass windows were laid out: exit 0xFFFF7003 on the
 * Windows signing PC, 2026-10-07 (A/B: forced glass crashed, CSS material
 * presented in 0.6 s). Those machines use the CSS material instead.
 * TAYLOS_NATIVE_GLASS=1|0 forces native glass on or off. An unknown status
 * keeps native glass, so machines with a GPU behave exactly as before.
 */
export function nativeGlassAllowed(platform: string, gpuCompositing: string, override?: string): boolean {
  if (override === '0') return false
  if (override === '1') return true
  return !(platform === 'win32' && /^disabled/.test(gpuCompositing))
}
