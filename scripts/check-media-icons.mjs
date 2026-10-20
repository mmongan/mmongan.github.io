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
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const robotSource = read('../src/robot/robot.ts');
const seekStart = robotSource.indexOf('export function seekToCount(');
const seekEnd = robotSource.indexOf('// Nudges the shared clock', seekStart);
let applied = 0;
const transport = vm.createContext({
  prebakingLegAnimation: true, transportRevision: 4, repeatElapsed: 8,
  globalPlayback: { playing: true, countIndex: 8, stepAccumulatorSeconds: .3 },
  getMaxCountIndex: () => 16,
  setDrillBeatPosition: beat => {
    transport.globalPlayback.countIndex = beat;
    transport.globalPlayback.stepAccumulatorSeconds = 0;
  },
  applyGlobalCountToAllRobots: () => { applied++; },
});
vm.runInContext(compile(robotSource.slice(seekStart, seekEnd)), transport);
transport.seekToCount(0);
assert.equal(transport.globalPlayback.countIndex, 0);
assert.equal(transport.globalPlayback.playing, false);
assert.equal(transport.globalPlayback.stepAccumulatorSeconds, 0);
assert.equal(transport.repeatElapsed, 0, 'Restart resets the active repeat position');
assert.equal(transport.transportRevision, 5, 'Restart marks a discontinuity for synchronized audio');
assert.equal(transport.prebakingLegAnimation, false);
assert.equal(applied, 1, 'Restart applies opening poses and notifies transport subscribers');
transport.globalPlayback.playing = true;
transport.seekToCount(16);
assert.equal(transport.globalPlayback.countIndex, 16);
assert.equal(transport.globalPlayback.playing, false, 'Go to end pauses at the final count');
assert.equal(transport.repeatElapsed, 16);
assert.equal(transport.transportRevision, 6);
assert.equal(applied, 2, 'Go to end applies final poses and notifies transport subscribers');
const engine = new NullEngine(), scene = new Scene(engine);
const desk = new TransformNode('scoreDesk', scene);
let playing = false;
const context = vm.createContext({
  scene, desk, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3, Vector3, Observable,
  getDrillTransportState: () => ({ playing, beatsPerSecond: 2 }),
  document: { createElement: () => {
    const ctx = {};
    return { getContext: () => ctx };
  } },
  DynamicTexture: class {
    constructor(_, canvas) { this.ctx = canvas.getContext('2d'); }
    update() {}
    dispose() {}
  },
  drawPanelButton(ctx, _width, _height, label) { ctx.label = label; },
});
try {
  for (const file of ['interaction/editingMode', 'menu/handMenu', 'menu/settingsButtonIcons']) {
    vm.runInContext(compile(read(`../src/${file}.ts`)), context);
  }
  const source = read('../src/menu/musicStand.ts');
  const start = source.indexOf('  const buttons = new Map');
  const end = source.indexOf('  const topBarTextures:', start);
  const updateStart = source.indexOf('  function updateMediaButtons()');
  const updateEnd = source.indexOf('  const mediaObserver', updateStart);
  vm.runInContext(compile(`${source.slice(start, end)}
    let buttonSignature = '';
    ${source.slice(updateStart, updateEnd)}`), context);
  const buttons = desk.getChildMeshes(true);
  assert.equal(buttons.length, 7, 'Music stand includes Restart and Go to end alongside the five existing media buttons');
  // Match FloatingPanel registration of existing child icons.
  for (const button of buttons) {
    const hit = context.getHandMenuHit({ pickedMesh: button });
    for (const mesh of button.getChildMeshes()) context.registerMenuButton(mesh, hit, { source: button });
  }
  for (const state of [false, true, false]) {
    playing = state;
    context.updateMediaButtons();
    scene.onBeforeRenderObservable.notifyObservers(scene);
    for (const button of buttons) {
      assert.equal(button.material.diffuseTexture.ctx.label, '', 'No duplicate 2D media glyph or label');
      const icons = button.getChildMeshes();
      const visible = icons.filter(mesh => mesh.isEnabled());
      assert.equal(visible.length, 1, 'Exactly one centered 3D icon is visible per media button');
      const icon = visible[0];
      const hit = context.getHandMenuHit({ pickedMesh: button });
      assert.equal(context.getHandMenuHit({ pickedMesh: icon }), hit);
      assert.ok(icon.parent.position.x === 0 && icon.parent.position.y === 0, 'Icon is centered');
      const bounds = icon.getBoundingInfo().boundingBox;
      assert.ok(bounds.extendSize.z > 0 && icon.getTotalIndices() > 0, 'Icon is solid 3D geometry');
      assert.ok(Math.abs(bounds.center.x) < .1 && Math.abs(bounds.center.y) < .001);
      assert.equal(icon.material.disableLighting, true, 'Icons remain readable independent of lighting angle');
      if (hit.action === 'playPause') assert.ok(icon.name.endsWith(state ? '-pause' : '-symbol'));
    }
  }
  const iconMaterials = buttons.flatMap(button => button.getChildMeshes().map(mesh => mesh.material));
  const observerCount = scene.onBeforeRenderObservable.observers.length;
  desk.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scene.onBeforeRenderObservable.observers.length, observerCount - 1,
    'Disposal removes play/pause synchronization');
  assert.ok(iconMaterials.every(material => !scene.materials.includes(material)), 'Disposal releases icon materials');
  console.log('Media icon checks passed: music-stand actions, blank button faces, single centered solid icons, live play/pause, readable materials, and disposal.');
} finally {
  scene.dispose(); engine.dispose();
}
