import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'

function copyAudioWorkletAsset() {
  return {
    name: 'copy-audio-worklet-asset',
    writeBundle() {
      const source = resolve(__dirname, 'src/renderer/audio-worklet.js')
      const destinations = [
        resolve(__dirname, 'dist/renderer/audio-worklet.js'),
        resolve(__dirname, 'dist/renderer/assets/audio-worklet.js'),
      ]

      for (const destination of destinations) {
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(source, destination)
      }
    },
  }
}

export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true },
  root: 'src/renderer',
  plugins: [copyAudioWorkletAsset()],
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
