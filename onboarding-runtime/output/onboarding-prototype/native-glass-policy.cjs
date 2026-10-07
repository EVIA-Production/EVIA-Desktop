// Same rule as src/main/native-glass-policy.ts, for the bundled onboarding
// runtime (plain CommonJS, not compiled with the app).
//
// Windows: off unless TAYLOS_NATIVE_GLASS=1. The glass bridge crashed the
// Electron main process with software compositing (exit 0xFFFF7003, Windows
// signing PC, 2026-10-07), and the installed 1.0.124 exited with the same code
// during the first onboarding render on a normal desktop session. It has never
// been verified on a Windows machine with GPU compositing; the CSS material has.
function nativeGlassAllowed(platform, gpuCompositing, override) {
  if (override === '0') return false;
  if (override === '1') return true;
  return platform !== 'win32';
}
module.exports = { nativeGlassAllowed };
