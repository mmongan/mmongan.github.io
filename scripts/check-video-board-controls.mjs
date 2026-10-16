import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Axis } from '@babylonjs/core/Maths/math.axis.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const context = vm.createContext({
  scene, MeshBuilder, TransformNode, StandardMaterial, Color3, Axis, Vector3, Ray,
  __APP_VERSION__: 'test',
  document: { createElement: () => ({ getContext: () => ({
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, fillText() {},
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
});
const menu = read('../src/menu/handMenu.ts');
vm.runInContext(`const buttonActions = new Map(); const progressBar = null;
  ${transform(menu.slice(menu.indexOf('export function registerMenuButton'),
    menu.indexOf('export function isHandMenuVisible')))}`, context);
const board = read('../src/field/videoBoard.ts');
vm.runInContext(transform(board.slice(board.indexOf('function roundedRect('),
  board.indexOf('export interface VideoBoardResult'))), context);
vm.runInContext(transform(board.slice(board.indexOf('function createVideoBoardButtons('))), context);
try {
  context.createVideoBoardButtons(4.7, 67.4);
  const root = new TransformNode('videoBoardRoot', scene);
  root.position.set(0, -0.5, 68);
  for (const mesh of [...scene.meshes]) if (!mesh.parent) mesh.setParent(root);
  const actions = ['rewind', 'stepBack', 'playPause', 'stepForward', 'fastForward'];
  for (const size of [0.5, 1, 1.75]) {
    root.scaling.setAll(size);
    root.computeWorldMatrix(true);
    const panel = scene.getMeshByName('videoBoardButtonPanel');
    panel.computeWorldMatrix(true);
    const bounds = panel.getBoundingInfo().boundingBox;
    assert.ok(bounds.maximumWorld.y < -0.5 + (14 - 13 / 2 + 0.5 - 0.4) * size,
      'Larger controls stay below the screen frame');
    assert.ok(bounds.minimumWorld.y > -0.5, 'Controls stay above the turf');
    for (const action of actions) {
      const button = scene.getMeshByName(`videoBoardButton-${action}`);
      button.computeWorldMatrix(true);
      for (const x of [-26.6665, 0, 26.6665]) {
        for (const z of [-60, 0, 60]) {
          const origin = new Vector3(x, 1.8, z);
          const target = button.getAbsolutePosition();
          const ray = new Ray(origin, target.subtract(origin).normalize(), 3);
          const pick = context.pickMenuControl(ray);
          assert.equal(pick.pickedMesh, button, `${action}: reachable from (${x}, ${z}) at ${size * 100}% size`);
          assert.equal(context.isMenuControl(button), true);
          assert.equal(vm.runInContext('buttonActions', context).get(pick.pickedMesh).action, action);
          assert.ok(2 * Math.atan2(3.6 * size / 2, Vector3.Distance(origin, target)) >
            (size < 1 ? 0.75 : 1.5) * Math.PI / 180,
          'Buttons span at least 1.5 degrees across the field at default size, or 0.75 degrees at minimum size');
          assert.equal(ray.length, 3, 'Long menu pointing does not change short grab rays');
        }
      }
    }
  }

  root.scaling.setAll(1);
  const target = scene.getMeshByName('videoBoardButton-playPause');
  target.computeWorldMatrix(true);
  const origin = new Vector3(0, 1.8, -60);
  const pointer = {
    getAbsolutePosition: () => origin,
    getDirection: () => target.getAbsolutePosition().subtract(origin).normalize(),
  };
  const pinches = new Map();
  const consumed = new Set();
  const held = new Map();
  const activated = [];
  Object.assign(context, {
    handTracking: { getHandByHandedness: side => side === 'left' ? { xrController: { pointer } } : null },
    pinchedPoints: pinches, padHands: consumed, handPinches: held,
    isFloatingPanelGrabbed: () => false, pickFloatingPanel: () => null,
    getFloatingPanelNear: () => null, getFloatingPanelButtonNearPoint: () => null,
    getHandMenuHit: pick => vm.runInContext('buttonActions', context).get(pick.pickedMesh),
    activateChartButton: action => activated.push(action),
    beginFloatingPanelGrab: () => assert.fail('Distant controls must not start a panel grab'),
  });
  const hand = read('../src/interaction/handInteraction.ts');
  const start = hand.indexOf('    for (const handedness', hand.indexOf('// Pinches that start on a floating panel'));
  const end = hand.indexOf("    const left = pinchedPoints.get('left');", start);
  vm.runInContext(`function pinch() { ${transform(hand.slice(start, end))} }`, context);
  pinches.set('left', origin);
  context.pinch();
  assert.equal(activated.length, 1, 'Tracked pinch activates a video button beyond the old 3-yard range');
  assert.equal(activated[0].action, 'playPause');
  assert.ok(consumed.has('left') && !pinches.has('left'), 'Media pinch is consumed before field interaction');
  pinches.set('left', origin);
  context.pinch();
  assert.equal(activated.length, 1, 'Holding a pinch never toggles playback repeatedly');
  pinches.clear();
  context.pinch();
  assert.equal(consumed.has('left'), false, 'Releasing a pinch frees the hand');
  assert.match(read('../src/interaction/pathInteraction.ts'), /const menuPick = pickMenuControl\(ray\)/,
    'Controllers use the same field-wide menu ray instead of their 100-yard field ray');
  console.log('Video-board checks passed: all five actions, 50/100/175% screen sizes, nine field positions, minimum 1.5-degree targets at default size, screen clearance, long-range tracked pinch, and held/released input ownership.');
} finally {
  scene.dispose();
  engine.dispose();
}
