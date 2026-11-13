// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beat, diagnostics, expect, openApp, routeSoundfonts, test, waitForShowReady } from './fixtures';

test.beforeEach(async ({ page }) => {
  await routeSoundfonts(page);
  await openApp(page);
  await waitForShowReady(page);
});

test('Play advances the shared drill clock past the first beat', async ({ page }) => {
  await diagnostics(page, app => app.playAll());
  expect(await diagnostics(page, app => app.transport().playing)).toBe(true);
  await expect.poll(() => beat(page), { message: 'Marchers move beyond the opening count' })
    .toBeGreaterThan(1.5);
});

test('Pause holds the current count', async ({ page }) => {
  await diagnostics(page, app => app.playAll());
  await expect.poll(() => beat(page)).toBeGreaterThan(0.5);
  await diagnostics(page, app => app.pauseAll());
  const held = await beat(page);
  await page.waitForTimeout(750);
  expect(await beat(page)).toBe(held);
  expect(await diagnostics(page, app => app.transport().playing)).toBe(false);
});

test('Seek moves to an exact count and pauses', async ({ page }) => {
  await diagnostics(page, app => app.playAll());
  await diagnostics(page, app => app.seekToCount(4));
  const transport = await diagnostics(page, app => app.transport());
  expect(transport.beat).toBe(4);
  expect(transport.playing).toBe(false);
  await diagnostics(page, app => app.playAll());
  await expect.poll(() => beat(page)).toBeGreaterThan(4.5);
});
