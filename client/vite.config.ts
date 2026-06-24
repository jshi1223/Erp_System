import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built assets live under /react/ (served by express.static('public')); Express serves
// the SPA index.html at the REAL URLs we've cut over (e.g. /user-management). No /app.
export default defineConfig({
  base: '/react/',
  plugins: [react()],
  build: { outDir: '../public/react', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/login': 'http://localhost:3000',
      '/logout': 'http://localhost:3000',
    },
  },
});
