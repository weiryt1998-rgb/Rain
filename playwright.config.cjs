'use strict';

const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;

// Set PW_CHANNEL=msedge (or chrome) to run with a browser already installed on
// the machine instead of downloading Playwright's Chromium.
const channel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};

module.exports = defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.cjs/,
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    ...channel
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 }, ...channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...channel } }
  ],
  webServer: {
    command: 'node scripts/serve.cjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 15000
  }
});
