import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: /(?:speech|conversation)-inference\.spec\.ts/,
  timeout: 10 * 60 * 1000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8791',
    channel: 'chrome',
    headless: process.env.SPEECH_HEADED !== '1',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--use-angle=metal',
      ],
    },
  },
  webServer: {
    command:
      process.env.SPEECH_QA_PRODUCTION === '1'
        ? './node_modules/.bin/vite preview --mode qa --host 127.0.0.1 --port 8791 --strictPort'
        : './node_modules/.bin/vite --host 127.0.0.1 --port 8791 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:8791',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
