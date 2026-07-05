import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173'
const basePort = new URL(baseURL).port || '5173'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.js',
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    viewport: { width: 1120, height: 640 },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${basePort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1120, height: 640 },
      },
    },
  ],
})
