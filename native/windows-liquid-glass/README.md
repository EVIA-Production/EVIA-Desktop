# Taylos Windows glass host

This N-API module places a clipped Windows Composition visual behind Electron's
transparent Chromium content. It uses `CreateHostBackdropBrush`, a D2D Gaussian
blur effect, and `CompositionRoundedRectangleGeometry`; it does not use private
DWM ordinals, API hooks, screen capture, or browser screenshots.

Runtime support starts at Windows 11. If the bridge is unavailable, Taylos keeps
the renderer's dark transparent fallback and never enables Electron's full-HWND
Mica/Acrylic material, which is known to leak a rectangular backing around
frameless transparent windows.

`node scripts/build-windows-glass.js` builds and verifies both x64 and ARM64
prebuild locations. The Microsoft effect-description header in
`third_party/microsoft` is pinned to commit
`ee50e2ea137dcef7b82ba504eff7435e5ebf5294` of
`microsoft/Windows.UI.Composition-Win32-Samples`; its MIT license is adjacent.
