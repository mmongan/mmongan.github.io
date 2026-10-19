import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const load = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
class Control extends EventTarget {
  checked = false; clicks = 0;
  click() { this.clicks++; this.checked = !this.checked; this.dispatchEvent(new Event('change')); }
}
const controls = Object.fromEntries(['xrSettingsPanelButton', 'xrSettingsPanelToggle', 'fullScaleVRButton',
  'tabletopScaleButton', 'giantModeButton', 'sittingModeToggle', 'fieldGridToggle', 'gridSnapToggle']
  .map(name => [name, new Control()]));
const engine = new NullEngine(), scene = new Scene(engine);
const labels = [];
const context = vm.createContext({
  scene, Mesh, MeshBuilder, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Plane, Color3, Ray, Observable, ...controls,
  document: { createElement: () => ({ getContext: () => ({ fillText: label => labels.push(label) }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  drawPanelButton: (_, __, ___, label) => labels.push(label), PANEL_FRAME_COLOR: '#18263b',
  addInstrumentButtonModel(button) {
    const root = new TransformNode('instrumentIconRoot', scene);
    root.parent = button;
    const mesh = MeshBuilder.CreateBox('instrumentIconModel', { size: .04 }, scene);
    mesh.parent = root;
    return { root, meshes: [mesh] };
  },
});
try {
  vm.runInContext(load('../src/interaction/editingMode.ts'), context);
  context.setDrillEditingEnabled(true);
  context.setDraftingToolsEnabled(true);
  scene.activeCamera = new FreeCamera('settingsCamera', Vector3.Zero(), scene);
  vm.runInContext(load('../src/menu/handMenu.ts'), context);
  vm.runInContext(load('../src/menu/settingsButtonIcons.ts'), context);
  vm.runInContext(load('../src/menu/floatingPanel.ts'), context);
  vm.runInContext(load('../src/menu/settingsPanelControls.ts'), context);
  vm.runInContext(load('../src/menu/xrSettingsPanel.ts'), context);
  context.initXRSettingsPanel();
  const root = scene.getTransformNodeByName('xrSettingsPanel');
  assert.equal(root.isEnabled(), false);
  context.summonXRSettingsPanel();
  assert.ok(root.isEnabled() && controls.xrSettingsPanelToggle.checked);
  assert.equal(root.parent, null, 'Settings remains independent of the field and hands');
  const firstPosition = root.position.clone();
  const backing = scene.getMeshByName('xrSettingsBacking');
  assert.equal(backing.material.alpha, .45, 'Settings background is semi-transparent');
  assert.equal(backing.material.disableDepthWrite, true);
  for (const mesh of root.getChildMeshes().filter(mesh => mesh.name.startsWith('xrSettingsButton-'))) {
    assert.equal(mesh.material.alpha, 1, 'Settings labels and buttons remain opaque');
  }
  assert.ok(context.beginFloatingPanelGrab('left', Matrix.Identity(), backing, undefined, .03, true));
  context.updateFloatingPanelGrab('left', Matrix.Translation(.3, .1, .2));
  context.endFloatingPanelGrab('left');
  const placed = root.computeWorldMatrix(true).clone();
  context.setXRSettingsPanelVisible(false);
  scene.activeCamera.position.x += 4;
  context.setXRSettingsPanelVisible(true);
  assert.ok(root.computeWorldMatrix(true).asArray().every((value, i) => Math.abs(value - placed.asArray()[i]) < 1e-6));
  context.summonXRSettingsPanel();
  assert.ok(Vector3.Distance(root.position, firstPosition.add(new Vector3(4, 0, 0))) < 1e-6);
  for (const [setting, name] of [['fullScale', 'fullScaleVRButton'], ['tabletop', 'tabletopScaleButton'],
    ['giant', 'giantModeButton'], ['seated', 'sittingModeToggle'], ['grid', 'fieldGridToggle'], ['snap', 'gridSnapToggle']]) {
    context.executeXRSetting(setting);
    assert.equal(controls[name].clicks, 1, `${setting} uses the existing DOM control and its listeners`);
  }
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.ok(labels.includes('Seated: on') && labels.includes('Grid snap: on'), 'Panel reflects current checkbox states');
  backing.computeWorldMatrix(true);
  const bounds = backing.getBoundingInfo().boundingBox;
  const actions = new Set();
  for (const mesh of root.getChildMeshes().filter(mesh => mesh.name.startsWith('xrSettingsButton-'))) {
    mesh.computeWorldMatrix(true);
    const local = mesh.position;
    assert.ok(Math.abs(local.x) + mesh.getBoundingInfo().boundingBox.extendSize.x <= bounds.extendSize.x + 1e-6);
    assert.ok(Math.abs(local.y - backing.position.y) + .0375 <= bounds.extendSize.y + 1e-6, 'Every button fits the backing');
    actions.add(context.getHandMenuHit({ pickedMesh: mesh }).action);
    const parts = mesh.getChildMeshes();
    assert.ok(parts.length > 0, `${mesh.name} has an actual mesh icon`);
    for (const part of parts) {
      assert.ok(part.getTotalVertices() > 0 && part.getBoundingInfo().boundingBox.extendSize.z > 0,
        'Icons have geometry and real depth, not image planes');
      assert.deepEqual(context.getHandMenuHit({ pickedMesh: part }), context.getHandMenuHit({ pickedMesh: mesh }),
        'Every icon part uses the parent button action');
      assert.ok(context.isFloatingPanelMesh(part), 'Icons participate in whole-panel grabbing');
    }
  }
  for (const action of ['drillChartPad', 'musicStandSummon', 'instrumentPanelSummon', 'drawingTool',
    'marcherPaint', 'fieldProjector', 'marcherPOV', 'recallPanels', 'xrSettingsHide', 'commitFormation',
    'undoErase', 'redoErase']) assert.ok(actions.has(action));
  context.setXRSettingsPanelVisible(false);
  assert.equal(context.beginFloatingPanelGrab('left', Matrix.Identity(), backing), false);
  const iconParts = root.getChildMeshes().filter(mesh => mesh.name.startsWith('settingsIcon-'));
  assert.ok(iconParts.every(mesh => context.getHandMenuHitNearPoint(mesh.getAbsolutePosition()) === null),
    'Hidden icons do not activate buttons');
  root.dispose();
  assert.ok(iconParts.every(mesh => mesh.isDisposed()), 'Disposing the panel removes its icon geometry');
  assert.ok(scene.materials.every(material => !material.name.startsWith('settingsIcon-')),
    'Disposing the panel releases all icon materials');
  console.log('XR settings checks passed: raised 3D icons, icon dispatch/grabbing, launchers, shared settings actions, live labels, bounds, retained placement, summon, and hide.');
} finally {
  scene.dispose(); engine.dispose();
}
