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
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

const load = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine(), scene = new Scene(engine);
const controls = Object.fromEntries(['sittingModeToggle', 'fieldGridToggle', 'gridSnapToggle']
  .map(name => [name, { checked: false }]));
const context = vm.createContext({
  scene, MeshBuilder, TransformNode, StandardMaterial, Color3, Vector3, Ray, ...controls,
  document: { createElement() {
    const ctx = new Proxy({ labels: [] }, {
      get: (target, key) => key in target ? target[key] : () => {},
      set: (target, key, value) => { target[key] = value; return true; },
    });
    ctx.fillText = text => ctx.labels.push(text);
    return { getContext: () => ctx };
  } },
  DynamicTexture: class {
    updates = 0;
    constructor(_, canvas) { this.ctx = canvas.getContext('2d'); }
    update() { this.updates++; }
    dispose() {}
  },
  addInstrumentButtonModel(button, _, size) {
    const root = new TransformNode('instrumentIconRoot', scene);
    root.parent = button;
    const mesh = MeshBuilder.CreateBox('instrumentIconModel', { size: size * .78 }, scene);
    mesh.parent = root;
    return { root, meshes: [mesh] };
  },
});
try {
  for (const file of ['menu/handMenu', 'menu/panelStyle', 'menu/settingsPanelControls',
    'menu/settingsButtonIcons', 'field/videoBoardSettings']) {
    vm.runInContext(load(`../src/${file}.ts`), context);
  }
  context.createVideoBoardSettings(20.9, 67.4);
  const root = new TransformNode('videoBoardRoot', scene);
  root.position.set(0, -.5, 68);
  for (const mesh of [...scene.meshes]) if (!mesh.parent) mesh.setParent(root);
  const buttons = scene.meshes.filter(mesh => mesh.name.startsWith('videoBoardSetting-'));
  const definitions = [...vm.runInContext('SETTINGS_PANEL_ROWS.flat()', context),
    ['Settings panel', { action: 'xrSettings' }]];
  assert.equal(buttons.length, definitions.length, 'The board exposes every setting and launcher, plus Settings');
  for (const [label, action] of definitions) {
    const button = scene.getMeshByName(`videoBoardSetting-${label}`);
    assert.equal(JSON.stringify(context.getHandMenuHit({ pickedMesh: button })), JSON.stringify(action));
    const bank = button.parent;
    const half = bank.getBoundingInfo().boundingBox.extendSize;
    assert.ok(Math.abs(button.position.x) + 1.8 <= half.x && Math.abs(button.position.y) + 1.8 <= half.y);
    const parts = button.getChildMeshes();
    assert.ok(parts.length > 0, 'Every control has a raised icon');
    const inverse = button.computeWorldMatrix(true).clone().invert();
    for (const part of parts) {
      assert.equal(JSON.stringify(context.getHandMenuHit({ pickedMesh: part })), JSON.stringify(action));
      part.computeWorldMatrix(true);
      const bounds = part.getBoundingInfo().boundingBox.vectorsWorld.map(point => Vector3.TransformCoordinates(point, inverse));
      assert.ok(bounds.every(point => Math.abs(point.x) <= 1.8 && point.y > -.5 && point.y <= 1.8),
        `${label}: icons stay above their labels and inside their buttons`);
    }
  }
  for (const scale of [.5, 1, 1.75]) {
    root.scaling.setAll(scale);
    root.computeWorldMatrix(true);
    for (const bank of root.getChildMeshes(true)) {
      bank.computeWorldMatrix(true);
      const bounds = bank.getBoundingInfo().boundingBox;
      assert.ok(bounds.minimumWorld.y > -.5, 'Both settings banks stay above the turf');
      assert.ok(bounds.maximumWorld.x < -12.4 * scale || bounds.minimumWorld.x > 12.4 * scale,
        'Settings banks do not cover the live field or media controls');
    }
    for (const button of buttons) {
      const expected = context.getHandMenuHit({ pickedMesh: button });
      const target = button.computeWorldMatrix(true).getTranslation();
      for (const x of [-26.6665, 0, 26.6665]) for (const z of [-60, 0, 60]) {
        const origin = new Vector3(x, 1.8, z);
        const ray = new Ray(origin, target.subtract(origin).normalize(), 3);
        const pick = context.pickMenuControl(ray);
        assert.equal(JSON.stringify(context.getHandMenuHit(pick)), JSON.stringify(expected),
          `${button.name} remains reachable from (${x}, ${z}) at scale ${scale}`);
        assert.equal(ray.length, 3, 'Settings use the shared long-range menu ray without extending grab rays');
      }
    }
  }
  root.position.set(2, .7, -3);
  root.rotation.y = .7;
  root.scaling.setAll(.01);
  const tabletopOrigin = Vector3.TransformCoordinates(new Vector3(0, 1.8, -60), root.computeWorldMatrix(true));
  for (const button of buttons) {
    const target = button.computeWorldMatrix(true).getTranslation();
    const pick = context.pickMenuControl(new Ray(tabletopOrigin, target.subtract(tabletopOrigin).normalize(), .1));
    assert.equal(JSON.stringify(context.getHandMenuHit(pick)),
      JSON.stringify(context.getHandMenuHit({ pickedMesh: button })), 'Translated/rotated tabletop controls retain their actions');
  }
  for (const [label, control] of [['Seated', 'sittingModeToggle'], ['Field grid', 'fieldGridToggle'],
    ['Grid snap', 'gridSnapToggle']]) {
    const texture = scene.getMeshByName(`videoBoardSetting-${label}`).material.diffuseTexture;
    const updates = texture.updates;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(texture.updates, updates, 'Unchanged settings do not redraw textures');
    controls[control].checked = true;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(texture.ctx.labels.at(-1), 'ON', 'The board reflects changes from shared settings');
    assert.equal(texture.updates, updates + 1);
  }
  const part = buttons[0].getChildMeshes()[0];
  root.setEnabled(false);
  assert.equal(context.getHandMenuHitNearPoint(part.getAbsolutePosition()), null);
  root.dispose();
  assert.ok(buttons.every(button => button.isDisposed() && !context.isMenuControl(button)));
  assert.ok(scene.materials.every(material => !material.name.startsWith('settingsIcon-') &&
    !material.name.startsWith('videoBoardSetting')), 'Bank disposal releases icon and face materials');
  const source = readFileSync(new URL('../src/field/videoBoard.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('  createVideoBoardSettings(') < source.indexOf('  const boardRoot ='),
    'The existing board root captures both banks before AR parenting and scaling');
  console.log('Video-board settings passed: all 22 shared actions, styled 3D icons, clear labels, nonoverlapping banks, 50/100/175% scaling, field-wide picking, live toggles, and cleanup.');
} finally {
  scene.dispose(); engine.dispose();
}
