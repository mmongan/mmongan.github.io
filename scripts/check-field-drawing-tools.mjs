import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import '@babylonjs/core/Culling/ray.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('drawingTestFieldRoot', scene);
const calibration = { checked: false };
const messages = [];
const conversions = [];
const actions = new Map();
const pointerListeners = new Map();
const context = vm.createContext({
  scene, MeshBuilder, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3, Plane,
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, FIELD_SURFACE_Y: -0.48,
  floorCalibrationToggle: calibration, drawingToolsButton: null, stencilTrayButton: null,
  cookieCutterTrayButton: null,
  registerMenuButton: (mesh, hit) => actions.set(mesh, hit),
  document: { createElement: () => ({ getContext: () => ({
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  drawPanelButton() {},
  window: {
    addEventListener: (type, listener) => pointerListeners.set(type, listener),
    removeEventListener: type => pointerListeners.delete(type),
  },
});
vm.runInContext(transform(read('../src/menu/floatingPanel.ts')), context);
vm.runInContext(transform(read('../src/interaction/fieldDrawingGeometry.ts')), context);
vm.runInContext(transform(read('../src/interaction/memoryWire.ts')), context);
vm.runInContext(transform(read('../src/interaction/fieldDrawingTools.ts')), context);
const point = (x, z) => new Vector3(x, -0.455, z);
const guideCount = () => scene.meshes.filter(mesh => mesh.name === 'drawingGuide').length;
const act = tool => context.executeDrawingToolAction({ action: 'drawingTool', tool });
const stroke = (tool, a, b) => {
  act(tool);
  assert.equal(context.handleDrawingPointer('down', a), true);
  context.handleDrawingPointer('move', b);
  context.handleDrawingPointer('up', b);
};
try {
  const camera = new FreeCamera('drawingCamera', new Vector3(0, 2, -3), scene);
  let cameraControlsAttached = true;
  camera.detachControl = () => { cameraControlsAttached = false; };
  camera.attachControl = () => { cameraControlsAttached = true; };
  scene.activeCamera = camera;
  context.initFieldDrawingTools({
    root, notify: message => messages.push(message), prepare() {},
    createFormation: points => { conversions.push(['formation', points]); return true; },
    createPath: points => { conversions.push(['path', points]); return true; },
  });
  act('show');
  assert.equal(scene.getTransformNodeByName('drawingToolTray').isEnabled(), true);
  act('stencils');
  assert.equal(scene.getTransformNodeByName('fieldStencilTray').isEnabled(), true);
  act('cutters');
  assert.equal(scene.getTransformNodeByName('fieldCookieCutterTray').isEnabled(), true);
  const kinds = ['pencil', 'eraser', 'ruler', 'protractor', 'compass',
    'circleStencil', 'squareStencil', 'triangleStencil', 'pentagonStencil', 'hexagonStencil', 'starStencil'];
  assert.ok(kinds.every(kind => scene.getTransformNodeByName(`fieldTool-${kind}`)),
    'Trays contain every requested physical tool and stencil');
  assert.ok(![...actions.values()].some(hit => kinds.includes(hit.tool)),
    'Tools are physical objects rather than selection buttons');
  assert.equal(scene.getTransformNodeByName('fieldTool-pencil').parent.name, 'drawingToolTray');
  assert.equal(scene.getTransformNodeByName('fieldTool-squareStencil').parent.name, 'fieldStencilTray');
  assert.equal(scene.getTransformNodeByName('fieldTool-starCutter').parent.name, 'fieldCookieCutterTray');
  const dockedPencil = scene.getTransformNodeByName('fieldTool-pencil');
  const beforePickup = dockedPencil.computeWorldMatrix(true).clone();
  context.beginFloatingPanelGrab('right', Matrix.Identity(), scene.getMeshByName('fieldPencilShaft'), undefined, 0.03, true);
  assert.equal(dockedPencil.parent, null, 'Grabbing the actual pencil removes it from the tray');
  assert.ok(dockedPencil.computeWorldMatrix(true).asArray().every((value, index) =>
    Math.abs(value - beforePickup.asArray()[index]) < 1e-6), 'Picking up a physical tool preserves its complete pose');
  context.endFloatingPanelGrab('right');
  assert.equal(context.isFieldDrawingToolActive(), true);
  assert.ok(scene.getMeshByName('fieldPencilWood') && scene.getMeshByName('fieldPencilFerrule') &&
    scene.getMeshByName('fieldRulerBody') && scene.getMeshByName('fieldProtractorBody') &&
    scene.getMeshByName('fieldStencilPlate-squareStencil') && scene.getMeshByName('fieldCutterWall-starCutter'),
  'Implements have solid working bodies rather than icon-only meshes');
  const wireRoot = scene.getTransformNodeByName('fieldTool-wire');
  assert.equal(wireRoot.parent.name, 'drawingToolTray');
  const wireGrip = scene.getMeshByName('memoryWireGrip');
  context.beginFloatingPanelGrab('left', Matrix.Identity(), wireGrip, undefined, 0.03, true);
  assert.equal(wireRoot.parent, null, 'Copper grip lifts the physical wire from its dock');
  const bead = scene.getMeshByName('memoryWireBead-4');
  const beadStart = bead.computeWorldMatrix(true).getTranslation();
  context.beginFloatingPanelGrab('right', Matrix.Translation(...beadStart.asArray()), bead, undefined, 0.03, true);
  const bendDelta = Vector3.TransformNormal(new Vector3(0, 0, 0.08), wireRoot.computeWorldMatrix(true));
  context.updateFloatingPanelGrab('right', Matrix.Translation(...beadStart.add(bendDelta).asArray()));
  scene.onBeforeRenderObservable.notifyObservers(scene);
  context.endFloatingPanelGrab('right');
  context.endFloatingPanelGrab('left');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  const remembered = scene.getTransformNodeByName('memoryWireBend-4').position.clone();
  assert.ok(Math.abs(remembered.z) > 0.01, 'Pulling a control bead bends the wire');
  act('stop');
  assert.equal(wireRoot.parent.name, 'drawingToolTray');
  assert.ok(scene.getTransformNodeByName('memoryWireBend-4').position.equalsWithEpsilon(remembered),
    'Putting away remembers bends instead of resetting them');
  act('wire');
  context.handleDrawingPointer('down', point(-4, 0));
  context.handleDrawingPointer('move', point(4, 0));
  context.handleDrawingPointer('up', point(4, 0));
  act('path');
  assert.ok(conversions.at(-1)[1].some(p => Math.abs(p.z) > 0.1), 'Wire stamps its remembered bent shape');
  act('clear');
  act('wireReset');
  assert.equal(scene.getTransformNodeByName('memoryWireBend-4').position.z, 0);
  wireRoot.rotationQuaternion.copyFrom(Quaternion.Identity());
  wireRoot.position.set(0, -0.48 + 0.12 * wireRoot.scaling.y, 0);
  context.beginFloatingPanelGrab('left', Matrix.Identity(), wireGrip, undefined, 0.03, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  context.endFloatingPanelGrab('left');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(guideCount(), 1, 'Held memory wire pressed flat on turf stamps a guide on release');
  act('clear');
  act('pencil');
  assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('toolMark-')).length, 12,
    'Ruler and protractor have numbered graduations');
  context.handleDrawingPointer('down', point(0, 0));
  assert.equal(cameraControlsAttached, false, 'Drawing suspends mouse camera rotation');
  context.handleDrawingPointer('move', point(4, 0));
  pointerListeners.get('pointerup')();
  assert.equal(cameraControlsAttached, true, 'Releasing outside the canvas restores camera controls');
  assert.equal(guideCount(), 1, 'Window release completes an active stroke');
  act('clear');
  context.handleDrawingPointer('down', point(0, 0));
  context.handleDrawingPointer('move', point(4, 0));
  pointerListeners.get('blur')();
  assert.equal(cameraControlsAttached, true, 'Focus loss restores camera controls');
  assert.equal(guideCount(), 0, 'Focus loss cancels an unfinished stroke');
  for (const kind of kinds.filter(kind => kind !== 'eraser')) {
    act('clear');
    stroke(kind, point(0, 0), point(4, 0));
    assert.equal(guideCount(), 1, `${kind} creates an editable field guide`);
    act('formation');
    assert.equal(conversions.at(-1)[0], 'formation');
    const points = conversions.at(-1)[1];
    assert.ok(context.isGuideOnField(points));
    if (kind.includes('Stencil') || kind === 'compass') {
      assert.ok(Vector3.Distance(points[0], points.at(-1)) < 1e-6, `${kind} closes exactly`);
    }
    act('path');
    assert.equal(conversions.at(-1)[0], 'path');
  }
  for (const shape of ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'star']) {
    act('clear');
    const before = conversions.length;
    stroke(`${shape}Cutter`, point(0, 0), point(4, 0));
    assert.equal(conversions.length, before + 1, 'Cookie cutters directly stamp a formation on release');
    assert.equal(conversions.at(-1)[0], 'formation');
    assert.equal(guideCount(), 0, 'Cookie cutter stamp is distinct from an editable stencil guide');
    const points = conversions.at(-1)[1];
    assert.ok(Vector3.Distance(points[0], points.at(-1)) < 1e-6);
    assert.ok(scene.getMeshByName(`fieldCutterRim-${shape}Cutter`), 'Cookie cutters have raised physical rims');
  }
  act('clear');
  stroke('compass', point(0, 0), point(3, 0));
  context.handleDrawingPointer('down', point(0, 0));
  context.handleDrawingPointer('move', point(2, 0));
  context.handleDrawingPointer('move', point(4, 0));
  context.handleDrawingPointer('up', point(4, 0));
  act('path');
  assert.ok(Math.abs(conversions.at(-1)[1][0].x - 4) < 1e-9,
    'Circle resize keeps the original center rather than drifting to its circumference');
  act('undo');
  assert.equal(guideCount(), 1);
  stroke('eraser', point(-5, 0), point(5, 0));
  assert.equal(guideCount(), 0, 'Swept eraser deletes a crossed guide even with sparse input frames');
  stroke('ruler', point(26, 0), point(30, 0));
  assert.equal(guideCount(), 0, 'Out-of-field guide is rejected rather than clipped silently');
  assert.ok(messages.at(-1).includes('rejected'));
  act('formation');
  assert.ok(messages.at(-1).includes('Draw a guide'));
  act('pencil');
  const pencil = scene.getTransformNodeByName('fieldTool-pencil');
  const mesh = scene.getMeshByName('fieldPencilShaft');
  pencil.rotationQuaternion.copyFrom(Quaternion.Identity());
  pencil.position.set(0, -0.48 + 0.12 * pencil.scaling.y, 0);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(guideCount(), 0, 'Unheld tools never draw');
  context.beginFloatingPanelGrab('right', Matrix.Identity(), mesh, undefined, 0.03, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  pencil.position.x = 3;
  scene.onBeforeRenderObservable.notifyObservers(scene);
  context.endFloatingPanelGrab('right');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(guideCount(), 1, 'Physical pencil draws only when held and touching the field');
  act('clear');
  root.position.set(3, 1, -2);
  root.rotation.y = 0.7;
  root.scaling.setAll(0.05);
  root.computeWorldMatrix(true);
  act('squareStencil');
  const stencil = scene.getTransformNodeByName('fieldTool-squareStencil');
  stencil.rotationQuaternion.copyFrom(Quaternion.Identity());
  const worldContact = Vector3.TransformCoordinates(new Vector3(0, -0.48, 0), root.getWorldMatrix());
  stencil.position.copyFrom(worldContact.add(new Vector3(0, 0.12 * stencil.scaling.y, 0)));
  const frame = scene.getMeshByName('fieldStencil-squareStencil');
  context.beginFloatingPanelGrab('left', Matrix.Identity(), frame, undefined, 0.03, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  stencil.position.y += 0.1;
  scene.onBeforeRenderObservable.notifyObservers(scene);
  context.endFloatingPanelGrab('left');
  assert.equal(guideCount(), 1, 'Physical stencil stamps a rotated/scaled tabletop field on lift');
  act('path');
  const square = conversions.at(-1)[1];
  assert.equal(square.length, 5);
  assert.ok(Math.abs(Vector3.Distance(square[0], square[1]) - Math.sqrt(2) * 0.12 * stencil.scaling.x / 0.05) < 1e-5,
    'Physical span transforms to the correct field-local radius');
  act('clear');
  calibration.checked = true;
  act('pencil');
  assert.ok(messages.at(-1).includes('calibration'));
  assert.equal(context.handleDrawingPointer('down', point(0, 0)), false);
  calibration.checked = false;
  act('stop');
  assert.equal(context.isFieldDrawingToolActive(), false);
  assert.equal(pencil.parent.name, 'drawingToolTray', 'Put away returns physical implements to their trays');
  assert.equal(context.handleDrawingPointer('down', point(0, 0)), false);
  assert.equal(context.guideTouchesSweep([point(0, 0), point(0, 3)], point(2, 0), point(2, 3), 0.5), false,
    'Parallel, separated eraser motion does not delete a guide');
  console.log('Drawing tools/stencils/cutters passed: all 18 implements, remembered wire bends/stamps, three trays, freehand/line/arc/circle/polygon geometry, explicit conversions, direct cutter stamps, eraser sweeps, undo/clear, bounds, physical contact/release, rotated/scaled tabletop transforms, and calibration gating.');
} finally {
  scene.dispose();
  engine.dispose();
}
