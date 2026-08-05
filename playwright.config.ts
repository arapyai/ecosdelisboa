import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined
  },
  webServer: [
    { command: 'npm run dev --workspace @ecosdelisboa/webapp -- --port 5273', url: 'http://127.0.0.1:5273', reuseExistingServer: false },
    { command: 'npm run dev --workspace @ecosdelisboa/admin -- --port 5274', url: 'http://127.0.0.1:5274', reuseExistingServer: false }
  ],
  projects: [
    { name: 'webapp', testMatch: /visitor-route\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5273' } },
    { name: 'admin', testMatch: /admin-route\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5274' } }
  ]
});
