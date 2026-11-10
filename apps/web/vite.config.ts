import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { patchNotesPlugin } from './patch-notes';

export default defineConfig({
  plugins: [react(), patchNotesPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/local-blob': 'http://localhost:3001',
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 2000 },
});
