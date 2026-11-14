// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// The band rehearsal room surrounds reduced-scale immersive-VR sessions only:
// hidden on desktop, at full 1:1 scale, and in AR passthrough. It is built
// outside the AR tabletop transform, purely decorative (non-pickable, no
// collisions), merged to a handful of frozen static meshes, and toggled by a
// cheap per-frame visibility stage.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);
let arScale = 1;
let arTabletop = false;
class FakeDynamicTexture {
  constructor() { /* NullEngine has no 2D canvas; the board texture is stubbed. */ }
  getContext() {
    return new Proxy({}, { get: () => () => {} });
  }
  update() {}
  dispose() {}
}
const bandRoomToggle = { checked: true };
const context = vm.createContext({
  scene, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3, Vector3,
  DynamicTexture: FakeDynamicTexture, bandRoomToggle,
  getARScale: () => arScale,
  getARScaleRange: () => ({ min: 1 / 120, max: 1 }),
  isARTabletopModeActive: () => arTabletop,
});
const source = readFileSync(new URL('../src/environment/bandRoom.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);

vm.runInContext('initBandRoom()', context);
const root = scene.getTransformNodeByName('bandRoom');
assert.ok(root, 'Band room root exists after init');
assert.equal(root.parent, null, 'Band room stays outside the AR tabletop transform');
assert.equal(root.isEnabled(), false, 'Band room starts hidden');

const meshes = root.getChildMeshes();
assert.ok(meshes.length >= 6 && meshes.length <= 16,
  `Band room merges to a handful of meshes per material (got ${meshes.length})`);
for (const mesh of meshes) {
  assert.equal(mesh.isPickable, false, `${mesh.name} is not pickable`);
  assert.equal(mesh.checkCollisions, false, `${mesh.name} has no collisions`);
  assert.ok(mesh.isWorldMatrixFrozen, `${mesh.name} has a frozen world matrix`);
}
assert.ok(meshes.some(mesh => mesh.name.includes('Light')), 'Ceiling light fixtures exist');
assert.ok(meshes.some(mesh => mesh.name.includes('Black')), 'Chairs and music stands exist');

// Desktop camera: hidden regardless of scale.
scene.activeCamera = { getClassName: () => 'FreeCamera' };
arScale = 0.05;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), false, 'Hidden outside immersive sessions');

// Immersive VR at reduced scale: shown, centered on the player's tracked
// floor position and facing the way they look (the XR camera inherits the
// desktop camera's arbitrary world position, so origin placement is wrong).
scene.activeCamera = {
  getClassName: () => 'WebXRCamera',
  globalPosition: new Vector3(-28.5, 2.1, 7),
  realWorldHeight: 1.7,
  getDirection: () => new Vector3(1, 0, 0),
};
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), true, 'Shown in reduced-scale immersive VR');
assert.ok(Math.abs(root.position.x - -28.5) < 1e-6 && Math.abs(root.position.z - 7) < 1e-6,
  'Room centers on the player, not the world origin');
assert.ok(Math.abs(root.position.y - 0.4) < 1e-6, 'Room floor sits on the tracked floor');
assert.ok(Math.abs(root.rotation.y - (Math.PI / 2 + Math.PI)) < 1e-6,
  'Podium wall faces the direction the player is looking');
assert.ok(root.getChildMeshes().every(mesh => mesh.isWorldMatrixFrozen),
  'Child matrices are re-frozen after placement');
assert.ok(root.getChildMeshes().some(mesh =>
  Math.abs(mesh.getBoundingInfo().boundingBox.centerWorld.x - -28.5) < 10),
  'Frozen world matrices re-synced to the new placement');

// Full 1:1 VR scale: hidden (the stadium itself is the environment).
arScale = 1;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), false, 'Hidden at full 1:1 VR scale');

// AR passthrough tabletop: hidden (the real room shows instead).
arScale = 0.05;
arTabletop = true;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), false, 'Hidden in AR passthrough');
arTabletop = false;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), true, 'Returns when AR passthrough ends at tabletop scale');

// The Settings toggle gates everything and defaults to off in the HTML.
bandRoomToggle.checked = false;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), false, 'Hidden while the band room toggle is off');
bandRoomToggle.checked = true;
vm.runInContext('updateBandRoomVisibility()', context);
assert.equal(root.isEnabled(), true, 'Toggle re-enables the room');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(html, /<input id="bandRoomToggle" type="checkbox" \/>/,
  'Band room toggle exists and defaults to unchecked');

scene.activeCamera = null;
scene.dispose();
engine.dispose();
console.log('Band room checks passed: outside the AR transform, hidden by default, ' +
  'shown only in reduced-scale immersive VR, decorative frozen merged meshes.');
