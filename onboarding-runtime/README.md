# Bundled native onboarding runtime

This directory is included by the regular electron-builder configuration at `Resources/onboarding-preview`. It contains the reviewed onboarding renderer, practice product bundle and native shell. Authentication, real permissions, profile persistence and checkout are owned by `src/main/native-onboarding.ts`.

`node scripts/stage-onboarding.cjs` synchronizes the reviewed workspace output into this directory. The bundled files are checked in so packaging a clean desktop checkout does not depend on a sibling output folder. Regenerate the practice bundle from the workspace native-source Vite config before staging changes to production React components.

The optional native-controls.node helper in this snapshot contains macOS arm64 and x86_64 slices. Other architectures fall back when it cannot load; they require target-platform visual verification before release. The primary product material bridge is loaded from the normal application native module path.
