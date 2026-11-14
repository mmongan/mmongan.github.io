// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static meshes under the AR transform render with frozen world matrices.
// A one-off transform change re-syncs them, but continuous motion (tabletop
// grabs, scale easing, tracked floor following) must thaw them instead:
// re-freezing every static mesh on every frame of a gesture costs more than
// live matrices and shows up as a stuttering headset view. The meshes
// re-freeze, synchronized, once the transform has been still for a moment.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');

const engine = new NullEngine(), scene = new Scene(engine);
try {
  scene.activeCamera = new FreeCamera('viewer', new Vector3(0, 0, -5), scene);

  const arPivot = new TransformNode('arPivot', scene);
  const stands = MeshBuilder.CreateBox('standsMerged', { size: 1 }, scene);
  stands.parent = arPivot;
  const sign = MeshBuilder.CreateBox('stadiumMediaSign', { size: 1 }, scene);
  sign.parent = arPivot;
  sign.position.x = 2;
  const marcher = MeshBuilder.CreateBox('marcherBody', { size: 1 }, scene);
  marcher.parent = arPivot;
  const pathRoot = new TransformNode('robotPathRoot', scene);
  pathRoot.parent = arPivot;
  const route = MeshBuilder.CreateBox('routeLine', { size: 1 }, scene);
  route.parent = pathRoot;

  const context = vm.createContext({ scene, Matrix });
  vm.runInContext(compile(read('../src/scene/renderOptimizations.ts')), context);
  context.applyStaticRenderOptimizations();

  const worldX = mesh => mesh.computeWorldMatrix().getTranslation().x;
  assert.equal(stands.isWorldMatrixFrozen, true, 'Static stadium meshes start frozen');
  assert.equal(sign.isWorldMatrixFrozen, true, 'Static signs start frozen');
  assert.equal(marcher.isWorldMatrixFrozen, false, 'Marcher meshes are never frozen');
  assert.equal(route.isWorldMatrixFrozen, false, 'Route meshes under robotPathRoot are never frozen');
  assert.equal(marcher.alwaysSelectAsActiveMesh, true, 'Marchers skip per-mesh frustum tests');
  assert.equal(scene.skipPointerMovePicking, true, 'Hover picking is left to targeted picks');

  // Continuous motion: the first moved frame thaws the static meshes, and
  // they stay thawed (not re-frozen per frame) while tracking the transform.
  for (let frame = 0; frame < 6; frame++) {
    arPivot.position.x += 0.25;
    scene.render();
    assert.equal(stands.isWorldMatrixFrozen, false,
      'Static meshes thaw while the AR transform is moving');
    assert.ok(Math.abs(worldX(stands) - arPivot.position.x) < 1e-6,
      'Thawed meshes track the moving transform every frame');
  }

  // Settling: after the transform has been still long enough, the meshes
  // re-freeze with matrices synchronized to the final transform.
  for (let frame = 0; frame < 30 && !stands.isWorldMatrixFrozen; frame++) scene.render();
  assert.equal(stands.isWorldMatrixFrozen, true, 'Static meshes re-freeze once the transform settles');
  assert.equal(sign.isWorldMatrixFrozen, true, 'All static meshes re-freeze together');
  assert.ok(Math.abs(stands.getWorldMatrix().getTranslation().x - arPivot.position.x) < 1e-6,
    'Re-frozen matrices are synchronized to the settled transform');

  // A discrete one-frame change (e.g. a height preset) still renders
  // correctly on its own frame and settles back to frozen afterwards.
  arPivot.position.y = 0.8;
  scene.render();
  assert.ok(Math.abs(stands.computeWorldMatrix().getTranslation().y - 0.8) < 1e-6,
    'A one-off transform change renders correctly on its own frame');
  for (let frame = 0; frame < 30 && !stands.isWorldMatrixFrozen; frame++) scene.render();
  assert.equal(stands.isWorldMatrixFrozen, true, 'A one-off change re-freezes after settling');
  assert.ok(Math.abs(stands.getWorldMatrix().getTranslation().y - 0.8) < 1e-6,
    'The re-frozen matrix carries the one-off change');

  // Field rebuilds call refreshFrozenWorldMatrices directly; disposed meshes
  // are pruned and survivors re-sync without throwing.
  sign.dispose();
  stands.scaling.x = 2;
  context.refreshFrozenWorldMatrices();
  assert.equal(stands.isWorldMatrixFrozen, true, 'Explicit refresh keeps survivors frozen');
  assert.ok(Math.abs(stands.getWorldMatrix().getRow(0).x - 2) < 1e-6,
    'Explicit refresh recomputes the frozen matrices');

  console.log('Render optimization checks passed: static freeze under the AR transform, marcher ' +
    'exemptions, thaw during continuous motion with live tracking, re-freeze after settling, ' +
    'correct one-off changes, and explicit refresh with disposed-mesh pruning.');
} finally {
  scene.dispose();
  engine.dispose();
}
