import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const context = vm.createContext({ scene, Matrix, Quaternion, Vector3, Plane });
const source = readFileSync(new URL('../src/menu/floatingPanel.ts', import.meta.url), 'utf8');
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.api = { FloatingPanel, getFloatingPanelButtonNearPoint, beginFloatingPanelGrab, updateFloatingPanelGrab,
endFloatingPanelGrab, isFloatingPanelGrabbed, getFloatingPanelNear,
pickFloatingPanel, beginFloatingPanelPointerDrag, updateFloatingPanelPointerDrag,
nudgeFloatingPanelDistance };`, context);
const api = context.api;
function create(name, z) {
  const root = new TransformNode(name, scene);
  root.position.z = z;
  const desk = new TransformNode(`${name}Desk`, scene);
  desk.parent = root;
  desk.rotation.x = Math.PI / 10;
  const mesh = MeshBuilder.CreatePlane(`${name}Sheet`, { width: 0.7, height: 0.6 }, scene);
  mesh.parent = desk;
  mesh.material = new StandardMaterial(`${name}Material`, scene);
  const panel = new api.FloatingPanel(root, new Set([mesh]), desk, new Vector3(0.35, 0.3, 0.02));
  mesh.computeWorldMatrix(true);
  return { root, desk, mesh, panel };
}
try {
  const score = create('score', 1);
  const chart = create('chart', 2);
  const buttonRoot = new TransformNode('buttonPanelRoot', scene);
  const button = MeshBuilder.CreatePlane('mediaButton', { width: 0.115, height: 0.0575 }, scene);
  button.parent = buttonRoot;
  button.position.set(0.2, -0.2, -0.007);
  button.material = score.mesh.material;
  const hit = { action: 'playPause' };
  new api.FloatingPanel(buttonRoot, new Set([button]), buttonRoot,
    new Vector3(0.35, 0.3, 0.02), new Map([[button, hit]]));
  button.computeWorldMatrix(true);
  assert.equal(api.getFloatingPanelButtonNearPoint(button.getAbsolutePosition()), hit);
  buttonRoot.setEnabled(false);
  assert.equal(api.getFloatingPanelButtonNearPoint(button.getAbsolutePosition()), null);
  buttonRoot.dispose();
  const ray = new Ray(Vector3.Zero(), Vector3.Forward(), 3);
  assert.equal(api.pickFloatingPanel(ray).pickedMesh, score.mesh);
  assert.ok(api.pickFloatingPanel(ray).pickedPoint, 'Panel ray pick must have a grab point');
  assert.equal(score.panel.grabbed(), false);
  assert.ok(score.panel.pick(ray)?.pickedPoint, 'Panel-specific pick must have a grab point');
  assert.equal(api.getFloatingPanelNear(new Vector3(0, 0, 1)), score.panel);
  assert.equal(api.getFloatingPanelNear(new Vector3(0, 0.2, 1.06)), score.panel, 'Near test follows tilted desk');
  const start = Matrix.Translation(0, 0, 0);
  assert.ok(api.beginFloatingPanelGrab('left', start, score.mesh));
  api.updateFloatingPanelGrab('left', Matrix.Translation(0.1, 0.2, 0.3));
  assert.ok(Vector3.Distance(score.root.position, new Vector3(0.1, 0.2, 1.3)) < 1e-6);
  assert.ok(score.panel.userPlaced);
  api.beginFloatingPanelGrab('right', start, score.mesh);
  assert.equal(api.isFloatingPanelGrabbed('left'), false, 'Second hand takes over');
  api.endFloatingPanelGrab('right');
  const released = score.root.position.clone();
  api.updateFloatingPanelGrab('right', Matrix.Translation(10, 0, 0));
  assert.ok(score.root.position.equals(released), 'Release preserves placement');
  api.beginFloatingPanelGrab('left', start, score.mesh);
  api.beginFloatingPanelGrab('left', start, chart.mesh);
  assert.equal(score.panel.grabbed(), false, 'One hand owns at most one panel');
  api.endFloatingPanelGrab('left');
  score.root.position.set(0, 0, 1);
  score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
  assert.equal(api.pickFloatingPanel(ray).pickedMesh, score.mesh);
  assert.ok(api.beginFloatingPanelPointerDrag(ray));
  api.updateFloatingPanelPointerDrag(new Ray(new Vector3(0.1, 0, 0), Vector3.Forward(), 3));
  assert.ok(Math.abs(score.root.position.x - 0.1) < 1e-6);
  api.endFloatingPanelGrab('pointer');
  score.root.position.set(0, 0, 1);
  score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
  assert.ok(api.nudgeFloatingPanelDistance(ray, 10000));
  assert.ok(Math.abs(score.root.position.length() - 3) < 1e-6);
  chart.root.setEnabled(false);
  assert.ok(api.nudgeFloatingPanelDistance(new Ray(Vector3.Zero(), Vector3.Forward(), 4), -10000));
  assert.ok(Math.abs(score.root.position.length() - 0.3) < 1e-6);
  score.panel.release();
  score.root.setEnabled(false);
  assert.equal(api.getFloatingPanelNear(score.root.position), undefined);
  assert.equal(api.pickFloatingPanel(ray)?.hit, false);
  console.log('Floating panel checks passed: closest picking, tilted near contact, pose tracking, hand takeover, release, single-panel ownership, pointer drag, distance bounds, and hidden panels.');
} finally {
  scene.dispose();
  engine.dispose();
}
