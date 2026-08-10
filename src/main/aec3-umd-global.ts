/**
 * Declare the global the AEC3 package assigns to, before it is loaded.
 *
 * `@ennuicastr/webrtcaec3.js`'s dist file opens with a bare assignment to an
 * undeclared identifier:
 *
 *     WebRtcAec3Wasm="data:application/wasm;base64,AGFzbQAAAAA..."
 *
 * That creates an implicit global, which is legal in sloppy mode. ES modules
 * are strict mode, where assigning to an undeclared identifier is a
 * ReferenceError - so the module throws on its very first statement once vite
 * bundles it, while the same file works perfectly under Node's CommonJS loader.
 *
 * The consequence if this is missing is nasty and specific: every build passes,
 * the Node bench reports 42dB of cancellation, and the app captures raw audio
 * because the canceller threw at import. It was caught by loading the built
 * renderer bundle in a real browser (`tools/aec3-browser-check`), which is the
 * only place it is visible.
 *
 * Assigning the property up front makes the identifier resolve, so the
 * package's own assignment succeeds instead of throwing. Importing this module
 * BEFORE the package is what makes it work - ES modules evaluate dependencies
 * in import order - so the import below must stay above the package's.
 */
const globalScope = globalThis as unknown as { WebRtcAec3Wasm?: string };
if (typeof globalScope.WebRtcAec3Wasm === 'undefined') {
  globalScope.WebRtcAec3Wasm = undefined;
}

/**
 * Exported so the import cannot be mistaken for dead weight and removed. A
 * side-effect-only import would be correct today and one tidy-up away from
 * silently disabling echo cancellation.
 */
export const AEC3_UMD_GLOBAL_DECLARED = true;
