import { defineConfig } from 'vite';

// Для GitHub Pages base задаётся через VITE_BASE=/<repo>/ (см. .github/workflows/deploy.yml).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
