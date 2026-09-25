import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { chromiumExecutable } from '../scripts/chromium-path.mjs';

const API_PORT = 3101;
const WEB_PORT = 4173;
const root = resolve(import.meta.dirname, '..');
const dbFile = resolve(root, 'artifacts/e2e/e2e.db');

// Every run starts from an empty database.
rmSync(resolve(root, 'artifacts/e2e'), { recursive: true, force: true });

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: './tests',
  outputDir: '../artifacts/e2e/test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: '../artifacts/e2e/report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  // Runs the *built* apps (like production), so run `pnpm build` first — `pnpm verify` does.
  webServer: [
    {
      command: 'pnpm --filter @web-loop/api start',
      cwd: root,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DATABASE_URL: dbFile, LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @web-loop/web preview',
      cwd: root,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { WEB_PORT: String(WEB_PORT), API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
