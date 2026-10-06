// Same rule as src/main/native-glass-policy.ts, for the bundled onboarding
// runtime (plain CommonJS, not compiled with the app). Native window glass needs
// GPU compositing on Windows; with software compositing the glass bridge crashed
// the Electron main process during the first onboarding render (exit 0xFFFF7003,
// Windows signing PC, 2026-10-07). An unknown status keeps native glass.
function nativeGlassAllowed(platform, gpuCompositing, override) {
  if (override === '0') return false;
  if (override === '1') return true;
  return !(platform === 'win32' && /^disabled/.test(String(gpuCompositing || '')));
}
module.exports = { nativeGlassAllowed };
