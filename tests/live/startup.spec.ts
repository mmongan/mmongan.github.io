// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { diagnostics, expect, openApp, routeSoundfonts, test, waitForShowReady } from './fixtures';

test.beforeEach(async ({ page }) => {
  await routeSoundfonts(page);
  await openApp(page);
});

test('boots the stadium, loads the example show, and keeps rendering', async ({ page }) => {
  await waitForShowReady(page);
  await expect(page.locator('#renderCanvas, canvas').first()).toBeVisible();
  await expect(page.locator('#startupOverlay')).toBeHidden();
  expect(await diagnostics(page, app => app.marcherCount())).toBeGreaterThan(0);

  const before = await diagnostics(page, app => app.sceneRenderedFrames());
  await expect.poll(() => diagnostics(page, app => app.sceneRenderedFrames()),
    { message: 'The render loop keeps drawing frames' }).toBeGreaterThan(before + 10);
});

test('starts paused at the opening count', async ({ page }) => {
  await waitForShowReady(page);
  const transport = await diagnostics(page, app => app.transport());
  expect(transport.playing).toBe(false);
  expect(transport.beat).toBe(0);
  expect(transport.lastBeat).toBeGreaterThan(0);
  expect(await diagnostics(page, app => app.isPlaybackRequested())).toBe(false);
});

test('desktop is a playback-only viewer', async ({ page }) => {
  await waitForShowReady(page);
  // The notice lives in the (closed) Settings overlay; check its own state.
  const notice = page.locator('#playbackModeNotice');
  expect(await notice.evaluate(element => (element as HTMLElement).hidden)).toBe(false);
  await expect(notice).toContainText('playback-only');
  const editingControls = page.locator('[data-xr-editing]');
  expect(await editingControls.count()).toBeGreaterThan(0);
  expect(await editingControls.evaluateAll(elements =>
    elements.every(element => (element as HTMLElement).hidden && (element as HTMLElement).inert)),
  'Editing controls are hidden and inert outside immersive sessions').toBe(true);
});
