import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// В облачной среде Chromium предустановлен; локально/в CI — браузер Playwright.
const preinstalled = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // небольшой вьюпорт: в CI/облаке рендер программный (SwiftShader)
    viewport: { width: 960, height: 540 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
