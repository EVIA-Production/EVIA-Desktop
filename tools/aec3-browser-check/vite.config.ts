import { defineConfig } from 'vite'

// Standalone build of the renderer-environment check. `base: './'` so the
// output opens straight off the filesystem, which is the point - a packaged
// Electron renderer loads over file:// and that is where the failure modes
// this page tests actually appear.
export default defineConfig({
  root: __dirname,
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // One file, no dynamic chunks: matches how the real renderer inlines AEC3.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
