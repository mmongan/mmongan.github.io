// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression for "paused waiting for music that does not start" on Quest:
// browser audio starts suspended, the first unlock attempt's resume() never
// settles (no user activation), and a later real gesture must still unlock
// audio and release the armed Play.

import { beat, diagnostics, expect, openApp, routeSoundfonts, test } from './fixtures';

test.use({ allowedConsoleErrors: [] });

test('a stalled audio resume does not block the next gesture from starting Play', async ({ page }) => {
  // Every AudioContext starts suspended; the first resume() hangs forever, as
  // Chrome does without user activation. Later resumes behave normally.
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    let resumeCalls = 0;
    class StalledFirstResumeAudioContext extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        void this.suspend();
      }
      resume(): Promise<void> {
        resumeCalls++;
        (window as unknown as { __resumeCalls: number }).__resumeCalls = resumeCalls;
        return resumeCalls === 1 ? new Promise<void>(() => {}) : super.resume();
      }
    }
    window.AudioContext = StalledFirstResumeAudioContext;
  });
  await routeSoundfonts(page);
  await openApp(page);
  await page.waitForFunction(() => {
    const app = window.__openchartxr;
    return !!app && app.startupFinished() && app.marcherCount() > 0;
  }, undefined, { timeout: 90_000 });
  await expect.poll(() => diagnostics(page, app => app.midiWaitReason()),
    { message: 'Samples loaded but browser audio is still blocked' }).toBe('audio');

  await diagnostics(page, app => app.playAll());
  expect(await diagnostics(page, app => app.isPlaybackStartPending())).toBe(true);

  // First trusted gesture: its resume() stalls.
  await page.mouse.click(640, 120);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __resumeCalls?: number }).__resumeCalls ?? 0))
    .toBe(1);
  await page.waitForTimeout(400);
  expect(await diagnostics(page, app => app.transport().playing)).toBe(false);

  // After the bounded wait, the next gesture retries and succeeds.
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 120);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __resumeCalls?: number }).__resumeCalls ?? 0),
    { message: 'The next gesture issues a fresh resume()' }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => diagnostics(page, app => app.transport().playing),
    { message: 'Unlocked audio releases the armed Play' }).toBe(true);
  expect(await diagnostics(page, app => app.midiWaitReason())).toBe(null);
  await expect.poll(() => beat(page)).toBeGreaterThan(1);
});
