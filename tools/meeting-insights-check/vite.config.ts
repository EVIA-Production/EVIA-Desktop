import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: __dirname,
  resolve: { alias: [{ find: /\.\.\/demo-scenario$/, replacement: resolve(__dirname, 'model.ts') }] },
  server: { host: '127.0.0.1', port: 4393, strictPort: true, fs: { allow: [resolve(__dirname, '../..'), '/Users/benekroetz/EVIA/EVIA-Desktop/node_modules'] } },
});
