import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const engine = new NullEngine(), scene = new Scene(engine);
const context = vm.createContext({ scene, Vector3, Ray, Observable });
try {
  vm.runInContext(stripTypeScriptTypes(read('../src/interaction/editingMode.ts'), { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
  const source = read('../src/menu/handMenu.ts');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
  assert.equal(scene.meshes.length, 0, 'Shared control registry creates no hand/wrist/menu meshes');
  assert.equal(context.updateHandMenu, undefined);
  assert.equal(context.toggleControllerHandMenu, undefined);
  assert.ok(!read('../src/scene/index.ts').includes('updateHandMenu'), 'Render loop has no attached menu update');
  assert.ok(!read('../src/interaction/pathInteraction.ts').includes('toggleControllerHandMenu'));
  const buttons = [0, 1].map(index => {
    const mesh = MeshBuilder.CreatePlane(`standaloneButton${index}`, { width: .1, height: .05 }, scene);
    mesh.position.set(index * .12, 0, 1);
    const action = { action: index ? 'stepForward' : 'playPause' };
    context.registerMenuButton(mesh, action);
    return { mesh, action };
  });
  for (const { mesh, action } of buttons) {
    mesh.computeWorldMatrix(true);
    assert.equal(context.getHandMenuHitNearPoint(mesh.getAbsolutePosition()), action);
    const pick = context.pickMenuControl(new Ray(Vector3.Zero(), mesh.getAbsolutePosition().normalizeToNew(), 3));
    assert.equal(context.getHandMenuHit(pick), action, 'Standalone ray actions remain operational');
  }
  buttons[0].mesh.setEnabled(false);
  assert.equal(context.getHandMenuHitNearPoint(new Vector3(0, 0, 1)), null, 'Hidden controls do not activate');
  buttons[1].mesh.dispose();
  assert.equal(context.isMenuControl(buttons[1].mesh), false, 'Disposal unregisters controls');
  console.log('Hand-menu removal checks passed: no attached menus, retained standalone picking/touch, hidden controls, and disposal.');
} finally {
  scene.dispose(); engine.dispose();
}
