// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression coverage for the "band frozen at the first beat" report: Play
// pressed while music is still loading must stay armed, be visible on the 3D
// transport controls, survive the startup warm-up, and start on its own.

import type { Page } from '@playwright/test';
import { beat, diagnostics, expect, holdStartupShow, openApp, routeSoundfonts, test } from './fixtures';

// Samples the 3D Play/Pause icons' pause-bar visibility over time.
async function samplePauseIcons(page: Page, samples = 14, intervalMs = 100) {
  const seen = new Set<boolean>();
  for (let index = 0; index < samples; index++) {
    const states = await page.evaluate(() => {
      const scene = (window as unknown as { __scene?: { meshes: { name: string; isEnabled(): boolean }[] } }).__scene;
      return (scene?.meshes ?? [])
        .filter(mesh => mesh.name.startsWith('mediaIcon-') && mesh.name.endsWith('-pause'))
        .map(mesh => mesh.isEnabled());
    });
    expect(states.length, '3D Play/Pause controls exist').toBeGreaterThan(0);
    states.forEach(state => seen.add(state));
    await page.waitForTimeout(intervalMs);
  }
  return seen;
}

test('Play while samples load stays armed, blinks, then starts automatically', async ({ page }) => {
  const soundfonts = await routeSoundfonts(page, { hold: true });
  await openApp(page);
  await page.waitForFunction(() => (window.__openchartxr?.marcherCount() ?? 0) > 0, undefined, { timeout: 90_000 });
  await expect.poll(soundfonts.count, { message: 'Sample downloads were requested and held' }).toBeGreaterThan(0);
  expect(await diagnostics(page, app => app.isMidiPlaybackReady())).toBe(false);

  await diagnostics(page, app => app.playAll());
  expect(await diagnostics(page, app => app.isPlaybackStartPending())).toBe(true);
  expect(await diagnostics(page, app => app.isPlaybackRequested())).toBe(true);
  expect(await diagnostics(page, app => app.transport().playing)).toBe(false);

  const iconStates = await samplePauseIcons(page);
  expect([...iconStates].sort(), 'Pause bars blink while Play is pending').toEqual([false, true]);
  expect(await beat(page), 'The band waits at the opening while music loads').toBe(0);

  soundfonts.release();
  await expect.poll(() => diagnostics(page, app => app.transport().playing),
    { message: 'Ready samples release the armed Play' }).toBe(true);
  expect(await diagnostics(page, app => app.isPlaybackStartPending())).toBe(false);
  await expect.poll(() => beat(page)).toBeGreaterThan(1);
});

test('startup warm-up does not cancel a Play pressed before the show loads', async ({ page }) => {
  const soundfonts = await routeSoundfonts(page, { hold: true });
  const show = await holdStartupShow(page);
  await openApp(page);
  await expect.poll(show.count, { message: 'Startup show request is held' }).toBeGreaterThan(0);
  expect(await diagnostics(page, app => app.marcherCount())).toBe(0);

  await diagnostics(page, app => app.playAll());
  expect(await diagnostics(page, app => app.isPlaybackStartPending())).toBe(true);

  show.release();
  await page.waitForFunction(() => (window.__openchartxr?.marcherCount() ?? 0) > 0, undefined, { timeout: 90_000 });
  // The warm-up seeks a few frames after marchers appear; give it time to run.
  const frames = await diagnostics(page, app => app.sceneRenderedFrames());
  await expect.poll(() => diagnostics(page, app => app.sceneRenderedFrames())).toBeGreaterThan(frames + 10);
  expect(await diagnostics(page, app => app.isPlaybackStartPending()),
    'Warm-up seeks leave the pending Play armed').toBe(true);

  soundfonts.release();
  await expect.poll(() => diagnostics(page, app => app.transport().playing)).toBe(true);
  await expect.poll(() => beat(page)).toBeGreaterThan(1);
});

test('pressing Play/Pause again cancels a pending start', async ({ page }) => {
  const soundfonts = await routeSoundfonts(page, { hold: true });
  await openApp(page);
  await page.waitForFunction(() => (window.__openchartxr?.marcherCount() ?? 0) > 0, undefined, { timeout: 90_000 });
  await diagnostics(page, app => app.toggleAllPlayback());
  expect(await diagnostics(page, app => app.isPlaybackStartPending())).toBe(true);
  await diagnostics(page, app => app.toggleAllPlayback());
  expect(await diagnostics(page, app => app.isPlaybackRequested())).toBe(false);

  soundfonts.release();
  await page.waitForFunction(() => window.__openchartxr?.isMidiPlaybackReady(), undefined, { timeout: 90_000 });
  await page.waitForTimeout(500);
  expect(await diagnostics(page, app => app.transport().playing), 'A cancelled request never starts').toBe(false);
  expect(await beat(page)).toBe(0);
});
