import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // (Mantine removed) Aliases cleaned; ensure no stale '@mantine/*' imports remain.
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4387',
        changeOrigin: false
      }
    }
  }
});
