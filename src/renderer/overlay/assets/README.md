Taylos Overlay Assets

Place the Glass symbol SVGs here for the overlay UI.

Expected files (copy from `glass/src/ui/assets/`):
- command.svg
- enter.svg
- Listen.svg
- setting.svg
- Vector.svg

Usage:
- Import in TSX like `import ListenIcon from './assets/Listen.svg';`
- Or reference as `<img src={new URL('./assets/Listen.svg', import.meta.url).href} />` if preferred.

Note: This folder is packaged by Vite with the renderer build. No need to place these under a top-level `public/` for Electron.


