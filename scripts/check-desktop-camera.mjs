import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Culling/ray.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const source = readFileSync(new URL('../src/camera/desktopCamera.ts', import.meta.url), 'utf8');
const context = vm.createContext({
  UniversalCamera, Vector3, scene, engine, canvas: null,
  FIELD_SURFACE_Y: -0.48, window: { addEventListener() {} },
});
try {
  vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.camera = camera;`, context);
  const camera = context.camera;
  assert.equal(camera.position.x, -28.5, 'Start above the sideline');
  assert.ok(Math.abs(camera.position.z) <= 0.001, 'Center on the fifty-yard line');
  assert.ok(Math.abs(camera.position.y - 21.52) < 1e-6);
  const direction = camera.getForwardRay().direction;
  assert.ok(direction.x > 0 && direction.y < -0.5, 'Look down and inward toward the field');
  const distance = (-0.48 - camera.position.y) / direction.y;
  const fieldTarget = camera.position.add(direction.scale(distance));
  assert.ok(Math.hypot(fieldTarget.x, fieldTarget.z) < 1e-4, 'Aim at field center');
  assert.ok(!source.includes('introObserver'), 'No scoreboard intro delays browser control');
  camera.position.y = 5;
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(camera.position.y, 5, 'Starting altitude must not become the minimum flying height');
  camera.position.set(-100, -10, 100);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(camera.position.x, -29);
  assert.equal(camera.position.z, 65);
  assert.ok(Math.abs(camera.position.y - 1.32) < 1e-6, 'Preserve original floor clamp');
  console.log('Desktop camera checks passed: elevated sideline startup, downward field-center aim, immediate control, lower flight, and preserved stadium bounds.');
} finally {
  scene.dispose();
  engine.dispose();
}