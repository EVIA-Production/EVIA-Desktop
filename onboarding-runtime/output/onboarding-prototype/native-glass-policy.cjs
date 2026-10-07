// Same rule as src/main/native-glass-policy.ts, for the bundled onboarding
// runtime (plain CommonJS, not compiled with the app). Native window glass is
// on unless Windows reports software compositing (unverified there).
// TAYLOS_NATIVE_GLASS=1|0 forces it; the app sets 0 for the retry after a
// setup that ended the app. The 1.0.124 crash was the bridge being re-entered
// from its own resize, fixed in the module and in native-windows.cjs.
function nativeGlassAllowed(platform, gpuCompositing, override) {
  if (override === '0') return false;
  if (override === '1') return true;
  return !(platform === 'win32' && /^disabled/.test(String(gpuCompositing || '')));
}
module.exports = { nativeGlassAllowed };
