import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true },
  root: 'src/renderer',
  build: {
    target: 'es2022',
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'src/renderer/index.html',
        overlay: 'src/renderer/overlay.html',
        welcome: 'src/renderer/welcome.html',
        permission: 'src/renderer/permission.html',
        subscription: 'src/renderer/subscription.html',
      },
    },
  },
})
