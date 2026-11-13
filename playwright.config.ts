// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Live browser suite: drives the real app (Vite dev server by default) in
// headless Chrome. Run with `npm run test:live`.
//
// Environment overrides:
//   LIVE_TEST_URL  test an already-running or deployed build instead of
//                  starting Vite (pages open with `?diagnostics`).
//   LIVE_TEST_PORT port for the Vite server Playwright starts (default 5179).
//   PW_CHANNEL     browser channel: 'chrome' (default, uses installed Chrome),
//                  'msedge', or 'chromium' (Playwright's bundled build).

import { defineConfig } from '@playwright/test';

const port = Number(process.env.LIVE_TEST_PORT ?? 5179);
const externalUrl = process.env.LIVE_TEST_URL;
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'tests/live',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // One WebGL scene at a time keeps software rendering responsive.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/live-report' }]],
  outputDir: 'test-results/live',
  use: {
    baseURL: externalUrl ?? `http://localhost:${port}/`,
    channel: channel === 'chromium' ? undefined : channel,
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: [
        // AudioContext starts running, so tests control readiness through
        // sample loading rather than browser gesture policy.
        '--autoplay-policy=no-user-gesture-required',
        // Headless WebGL falls back to SwiftShader.
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalUrl ? undefined : {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
