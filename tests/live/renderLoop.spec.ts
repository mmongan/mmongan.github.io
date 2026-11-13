// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// A thrown error in per-frame work used to stop Babylon's render loop for good
// (in a headset: a frozen band while music plays on). The loop must survive.

import { beat, diagnostics, expect, openApp, routeSoundfonts, test, waitForShowReady } from './fixtures';

test.use({ allowedConsoleErrors: [/Render frame stage "render" failed; continuing\./] });

test('an error inside scene rendering is logged once and the loop keeps running', async ({ page }) => {
  const frameErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('Render frame stage')) frameErrors.push(message.text());
  });
  await routeSoundfonts(page);
  await openApp(page);
  await waitForShowReady(page);
  await diagnostics(page, app => app.playAll());
  await expect.poll(() => beat(page)).toBeGreaterThan(0.5);

  // Registered after the transport observer, so playback still advances
  // while every scene render aborts at this point.
  await page.evaluate(() => {
    const scene = (window as unknown as { __scene: { onBeforeRenderObservable: { add(fn: () => void): unknown } } }).__scene;
    (window as unknown as { __failingObserver: unknown }).__failingObserver =
      scene.onBeforeRenderObservable.add(() => { throw new Error('injected frame failure'); });
  });
  const presented = await diagnostics(page, app => app.enginePresentedFrames());
  const beatDuringFailure = await beat(page);
  await expect.poll(() => diagnostics(page, app => app.enginePresentedFrames()),
    { message: 'Engine frames keep running despite the failing stage' }).toBeGreaterThan(presented + 20);
  await expect.poll(() => beat(page), { message: 'The drill clock keeps advancing' })
    .toBeGreaterThan(beatDuringFailure + 0.5);
  expect(frameErrors, 'Each distinct failure is logged once').toHaveLength(1);

  await page.evaluate(() => {
    const scene = (window as unknown as { __scene: { onBeforeRenderObservable: { remove(o: unknown): void } } }).__scene;
    scene.onBeforeRenderObservable.remove((window as unknown as { __failingObserver: unknown }).__failingObserver);
  });
  const rendered = await diagnostics(page, app => app.sceneRenderedFrames());
  await expect.poll(() => diagnostics(page, app => app.sceneRenderedFrames()),
    { message: 'Scene rendering resumes once the failure stops' }).toBeGreaterThan(rendered + 10);
});
