import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1,
  timeout: 90000, expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4200', browserName: 'chromium',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: [
    { command: 'npm run start -- --port 4200', url: 'http://127.0.0.1:4200', reuseExistingServer: !process.env['CI'], timeout: 120000 },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4201', url: 'http://127.0.0.1:4201/tests/browser/audio.html', reuseExistingServer: !process.env['CI'] }
  ]
});
