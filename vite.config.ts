import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://backend',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://backend',
        ws: true
      }
    },
    watch: {
      usePolling: true,
    },
    open: false,
    cors: true,
    hmr: {
      clientPort: 5173,
      host: 'localhost',
      overlay: true
    },
    fs: {
      strict: true,
    }
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: true,
    cors: true
  },
  build: {
    rollupOptions: {},
    minify: true
  }
}));
