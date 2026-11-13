// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// The floating Settings panel's "Marcher POV" button must start POV without a
// prior marcher pick, report its state on the button, and show the viewer's
// own robot body (only the head is hidden around the eye point).

import type { Page } from '@playwright/test';
import { diagnostics, expect, openApp, routeSoundfonts, test, waitForShowReady } from './fixtures';

const POV_HIDDEN_LAYER = 0x20000000;

// Screen position of a named mesh's bounding-box centre.
async function meshScreenPoint(page: Page, name: string) {
  return page.evaluate(meshName => {
    type V3 = { x: number; y: number; z: number };
    const scene = (window as unknown as { __scene: {
      getMeshByName(n: string): { isEnabled(): boolean; computeWorldMatrix(force: boolean): unknown;
        getBoundingInfo(): { boundingBox: { centerWorld: V3 & { constructor: unknown } } } } | null;
      getTransformMatrix(): { constructor: { Identity(): unknown } };
      activeCamera: { viewport: { toGlobal(w: number, h: number): unknown } };
      getEngine(): { getRenderWidth(): number; getRenderHeight(): number };
    } }).__scene;
    const mesh = scene.getMeshByName(meshName);
    if (!mesh || !mesh.isEnabled()) return null;
    mesh.computeWorldMatrix(true);
    const center = mesh.getBoundingInfo().boundingBox.centerWorld;
    const Vector3 = center.constructor as { Project(v: V3, world: unknown, transform: unknown, viewport: unknown): V3 };
    const engine = scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const projected = Vector3.Project(center, scene.getTransformMatrix().constructor.Identity(),
      scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(width, height));
    const canvas = document.getElementById('renderCanvas')!.getBoundingClientRect();
    return { x: canvas.left + projected.x * canvas.width / width, y: canvas.top + projected.y * canvas.height / height };
  }, name);
}

// Layer masks of the followed marcher's head and body meshes.
async function ownBodyLayers(page: Page) {
  return page.evaluate(hidden => {
    type MeshLike = { name: string; layerMask: number; parent: MeshLike | null };
    const scene = (window as unknown as { __scene: { meshes: MeshLike[] } }).__scene;
    const hiddenHead = scene.meshes.find(mesh => mesh.name === 'marcherTrim' && mesh.layerMask === hidden);
    if (!hiddenHead?.parent) return null;
    const siblings = scene.meshes.filter(mesh => mesh.parent === hiddenHead.parent);
    return {
      hiddenHeads: scene.meshes.filter(mesh => mesh.name === 'marcherTrim' && mesh.layerMask === hidden).length,
      eyesHidden: siblings.some(mesh => mesh.name === 'robotEyes' && mesh.layerMask === hidden),
      jacketVisible: siblings.some(mesh => mesh.name === 'marcherJacket' && mesh.layerMask !== hidden),
    };
  }, POV_HIDDEN_LAYER);
}

test('Settings panel Marcher POV button starts POV and shows your own robot body', async ({ page }) => {
  await routeSoundfonts(page);
  await openApp(page);
  await waitForShowReady(page);
  expect(await diagnostics(page, app => app.marcherPOVActive())).toBe(false);

  await page.evaluate(() => document.getElementById('xrSettingsPanelButton')?.click());
  await expect.poll(() => meshScreenPoint(page, 'xrSettingsButton-Marcher POV'),
    { message: 'The floating Settings panel shows the Marcher POV button' }).not.toBeNull();
  const button = (await meshScreenPoint(page, 'xrSettingsButton-Marcher POV'))!;
  await page.mouse.click(button.x, button.y);

  await expect.poll(() => diagnostics(page, app => app.marcherPOVActive()),
    { message: 'POV starts from the panel with no marcher selected first' }).toBe(true);
  expect((await diagnostics(page, app => app.marcherPOVPanelLabel())).text).toBe('Marcher POV: on');

  const layers = await ownBodyLayers(page);
  expect(layers, 'The followed marcher is found').not.toBeNull();
  expect(layers!.hiddenHeads, 'Only the followed marcher’s head is hidden').toBe(1);
  expect(layers!.eyesHidden).toBe(true);
  expect(layers!.jacketVisible, 'Your own robot body stays visible in POV').toBe(true);
});
