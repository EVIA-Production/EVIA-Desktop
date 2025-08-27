import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5174, strictPort: true },
  root: 'src/renderer',
  build: {
    target: 'es2022',
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
})
