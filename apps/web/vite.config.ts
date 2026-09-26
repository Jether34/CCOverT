import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ccovert/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } }
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } }
  }
});
