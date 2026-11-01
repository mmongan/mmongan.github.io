// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const source = stripTypeScriptTypes(readFileSync(new URL('../src/robot/collisionMarkers.ts', import.meta.url),
  'utf8'), { mode: 'transform' }).replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const { createCollisionMarkerManager } = vm.runInNewContext(`${source}\n({ createCollisionMarkerManager })`,
  { Vector3, performance });
try {
  let seeks = 0;
  const manager = createCollisionMarkerManager(() => seeks++);
  const root = new TransformNode('field', scene);
  manager.setParent(root);
  const paths = ['a', 'b'].map(name => ({
    robot: new TransformNode(name, scene),
    counts: [{ position: Vector3.Zero() }, { position: Vector3.Zero() }],
  }));
  for (const visible of [true, false, true]) {
    manager.setVisible(visible);
    manager.refresh(scene, paths);
    for (let frame = 0; frame < 10; frame++) scene.onAfterRenderObservable.notifyObservers(scene);
    assert.equal(scene.meshes.length, 0, 'Colliding paths never drop cones');
    assert.equal(scene.onAfterRenderObservable.observers.length, 0, 'Disabled cones do not scan paths each frame');
  }
  assert.equal(manager.seekToMarker(root), false);
  assert.equal(seeks, 0);
  console.log('Collision cones disabled: no meshes, scan observers, or marker seeks.');
} finally {
  scene.dispose();
  engine.dispose();
}
