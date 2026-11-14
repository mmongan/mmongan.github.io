// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Football line-of-scrimmage stance: the presentation-only body separation
// offsets only the rendered root, while the leg solve stays in the
// authored-route frame. Legs and planted feet must therefore travel with a
// separated body — a lineman pushed off his route point at the snap still
// crouches forward over his own feet instead of leaning sideways off them.

import { expect, openApp, routeSoundfonts, test, waitForShowReady } from './fixtures';

test('separated bodies keep their feet and lean forward over them', async ({ page }) => {
  await routeSoundfonts(page);
  await openApp(page);
  await waitForShowReady(page);
  await page.evaluate(() => document.getElementById('footballLoad')!.click());
  await page.waitForFunction(() => !!window.__openchartxr!.scene().transformNodes
    .some(node => node.name === 'football-player-offense-C'), undefined, { timeout: 60_000 });

  const stances = await page.evaluate(async () => {
    const app = window.__openchartxr!;
    const scene = app.scene();
    // The first snap holds at count 1 with the line crouch applied.
    app.seekToCount(1);
    await new Promise(resolve => setTimeout(resolve, 300));
    return ['offense-C', 'offense-LG', 'offense-RG', 'defense-DT-L', 'defense-DT-R'].map(id => {
      const root = scene.transformNodes.find(node => node.name === `football-player-${id}`)!;
      const point = (name: string) => {
        const mesh = scene.meshes.find(candidate => candidate.name === name)!;
        mesh.computeWorldMatrix(true);
        const p = mesh.getAbsolutePosition();
        return { x: p.x, y: p.y, z: p.z };
      };
      const matrix = root.computeWorldMatrix(true).m;
      return { id,
        root: { x: root.absolutePosition.x, z: root.absolutePosition.z },
        up: { x: matrix[4], y: matrix[5], z: matrix[6] },
        forward: { x: matrix[8], z: matrix[10] },
        helmet: point(`football-helmet-${id}`),
        waist: point(`football-waist-${id}`),
        cleats: [point(`football-cleat-${id}-0`), point(`football-cleat-${id}-1`)] };
    });
  });

  for (const stance of stances) {
    // Feet travel with the (possibly separated) body root.
    const feetX = (stance.cleats[0].x + stance.cleats[1].x) / 2;
    expect(Math.abs(feetX - stance.root.x), `${stance.id}: feet stay under the body`).toBeLessThan(0.2);
    // Any lean tips the head along the body's own facing, never sideways.
    const tilt = Math.hypot(stance.up.x, stance.up.z);
    if (tilt > 0.05) {
      const along = (stance.up.x * stance.forward.x + stance.up.z * stance.forward.z) / tilt /
        Math.hypot(stance.forward.x, stance.forward.z);
      expect(Math.abs(along), `${stance.id}: lean axis follows facing`).toBeGreaterThan(0.9);
    }
    // The crouched head reaches toward the line, past the waist.
    const headReach = (stance.helmet.x - stance.waist.x) * stance.forward.x +
      (stance.helmet.z - stance.waist.z) * stance.forward.z;
    expect(headReach, `${stance.id}: head is not behind the waist`).toBeGreaterThan(-0.05);
  }
});
