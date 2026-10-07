/**
 * Native window glass is off on Windows unless TAYLOS_NATIVE_GLASS=1.
 *
 * The glass bridge crashed the Electron main process with software compositing
 * (exit 0xFFFF7003 on the Windows signing PC, 2026-10-07), and the installed
 * 1.0.124 exited with the same code during the first onboarding render on a
 * normal desktop session. It has never been verified on a Windows machine with
 * GPU compositing; the CSS material has. TAYLOS_NATIVE_GLASS=1|0 forces native
 * glass on or off. macOS is unchanged.
 */
export function nativeGlassAllowed(platform: string, _gpuCompositing: string, override?: string): boolean {
  if (override === '0') return false
  if (override === '1') return true
  return platform !== 'win32'
}
