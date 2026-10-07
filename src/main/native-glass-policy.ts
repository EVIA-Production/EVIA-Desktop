/**
 * Native window glass is on unless Windows reports software compositing, where
 * it was never verified. TAYLOS_NATIVE_GLASS=1|0 forces it; the app sets 0 for
 * the retry after a setup that ended the app (see native-onboarding.ts).
 *
 * The 1.0.124 crash (exit 0xFFFF7003 during the first onboarding render) was
 * the glass bridge being re-entered from its own resize: SetWindowRgn
 * dispatched window messages, the onboarding's resize handler called update()
 * again while the outer call held the bridge's mutex, and the resulting C++
 * exception escaped into V8. The module now skips nested calls and never lets
 * an exception escape; the onboarding defers updates like the app always has.
 */
export function nativeGlassAllowed(platform: string, gpuCompositing: string, override?: string): boolean {
  if (override === '0') return false
  if (override === '1') return true
  return !(platform === 'win32' && /^disabled/.test(gpuCompositing))
}
