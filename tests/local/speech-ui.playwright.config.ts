import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '..',
  testMatch: /(?:speech|conversation|local-refresh)\.spec\.ts/,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8794',
    headless: process.env.SPEECH_UI_HEADED !== '1',
    launchOptions: { timeout: 30_000 },
  },
  projects: [
    { name: 'Chromium', use: devices['Desktop Chrome'] },
    { name: 'WebKit', use: devices['Desktop Safari'] },
    { name: 'Firefox', use: devices['Desktop Firefox'] },
  ],
  webServer: {
    command: './node_modules/.bin/vite --host 127.0.0.1 --port 8794 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:8794',
    reuseExistingServer: true,
  },
});
