import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import '@babylonjs/core/Culling/ray.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('drawingTestFieldRoot', scene);
const calibration = { checked: false };
const messages = [];
const conversions = [];
const actions = new Map();
const pointerListeners = new Map();
const draftSpacingInput = {
  value: '1.25', get valueAsNumber() { return Number(this.value); },
  addEventListener() {}, removeEventListener() {},
};
const draftAngleInput = { value: '45', addEventListener() {}, removeEventListener() {} };
const draftTextInput = { value: 'Test note' };
const savedWorkspaceData = new Map();
let storageFailure = false;
let captureFailure = false;
let captureTimeout = false;
let capturedRenderList = [];
let capturedView;
let encodedPixels;
let downloadedPhoto;
let downloadedBlob;
let revokedDownload;
const testPng = 'data:image/png;base64,iVBORw0KGgo=';
const gridToggle = { checked: false, dispatchEvent() {} };
const gridInterval = { value: '5', get valueAsNumber() { return Number(this.value); } };
let testARScale = 1 / 120;
const arScaleChanged = new Observable();
const context = vm.createContext({
  Observable,
  PANEL_FRAME_COLOR: '#18263b',
  performance,
  getARPosition: () => Vector3.Zero(), getARRotation: () => 0,
  isARTabletopModeActive: () => false,
  getFieldHeightMode: () => 'floor', getFieldHeightSetting: () => 0,
  setARPosition() {}, setARRotation() {}, setFieldHeightMode() {}, setARSurfaceHeight() {},
  placeTabletopInFrontOfCamera() {}, setARScale: scale => { testARScale = scale; },
  tabletopScaleButton: null,
  setMarcherPOVEnabled() {},
  getARScale: () => testARScale, getARScaleRange: () => ({ min: 0.002, max: 1, default: 1 / 120 }),
  onARScaleChangedObservable: arScaleChanged,
  scene, Mesh, MeshBuilder, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3, Plane, Ray, FreeCamera, Camera,
  CreateScreenshotUsingRenderTarget: (...args) => {
    if (captureFailure) throw new Error('Image capture failed');
    if (captureTimeout) { args[15](); return; }
    const texture = {};
    args[12](texture);
    capturedRenderList = texture.renderList;
    capturedView = {
      position: args[1].position.clone(), width: args[1].orthoRight - args[1].orthoLeft,
      up: args[1].upVector.clone(), size: args[2],
    };
    args[13](1, 2, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), args[3], 'image/png', undefined, true);
  },
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, FIELD_SURFACE_Y: -0.48,
  floorCalibrationToggle: calibration, drawingToolsButton: null, stencilTrayButton: null,
  cookieCutterTrayButton: null,
  draftingToolsButton: null, draftingSpacing: draftSpacingInput, draftingAngle: draftAngleInput,
  draftingModeToggle: null, draftingTableControls: null, draftingTableStatus: null,
  draftingText: draftTextInput,
  draftingSaveButton: null, draftingRestoreButton: null, draftingDeleteButton: null, draftingSaveStatus: null,
  draftingCameraButton: null, draftingPhotoRestoreButton: null, draftingPhotoDownloadButton: null, draftingPhotoPreview: null,
  fieldGridToggle: gridToggle, fieldGridInterval: gridInterval, Event,
  localStorage: {
    getItem: key => { if (storageFailure) throw new Error('Storage blocked'); return savedWorkspaceData.get(key) ?? null; },
    setItem: (key, value) => { if (storageFailure) throw new Error('Storage quota exceeded'); savedWorkspaceData.set(key, value); },
    removeItem: key => savedWorkspaceData.delete(key),
  },
  atob, Blob,
  URL: {
    createObjectURL: blob => { downloadedBlob = blob; return 'blob:field-photo'; },
    revokeObjectURL: url => { revokedDownload = url; },
  },
  setTimeout: callback => { callback(); },
  registerMenuButton: (mesh, hit) => actions.set(mesh, hit),
  document: { body: { appendChild() {} }, createElement: type => type === 'a' ? {
    click() { downloadedPhoto = { href: this.href, filename: this.download }; }, remove() {},
  } : ({ toDataURL: () => testPng, getContext: () => ({
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, fillRect() {},
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: image => { encodedPixels = [...image.data]; },
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  drawPanelButton() {},
  window: {
    addEventListener: (type, listener) => pointerListeners.set(type, listener),
    removeEventListener: type => pointerListeners.delete(type),
  },
});
vm.runInContext(transform(read('../src/interaction/editingMode.ts')), context);
context.setDrillEditingEnabled(true);
vm.runInContext(transform(read('../src/menu/settingsButtonIcons.ts')), context);
vm.runInContext(transform(read('../src/menu/floatingPanel.ts')), context);
vm.runInContext(transform(read('../src/interaction/draftingToolbox.ts')), context);
vm.runInContext(transform(read('../src/interaction/draftingTablePanel.ts')), context);
vm.runInContext(transform(read('../src/field/draftingFieldPreview.ts')), context);
vm.runInContext(transform(read('../src/interaction/fieldDrawingGeometry.ts')), context);
vm.runInContext(transform(read('../src/interaction/draftingGeometry.ts')), context);
vm.runInContext(transform(read('../src/interaction/guideMarcherLayout.ts')), context);
vm.runInContext(transform(read('../src/interaction/draftingWorkspace.ts')), context);
vm.runInContext(transform(read('../src/interaction/draftingCamera.ts')), context);
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
    createFormation: (points, settings) => { conversions.push(['formation', points, settings]); return true; },
    createPath: points => { conversions.push(['path', points]); return true; },
  });
  const toolbox = scene.getTransformNodeByName('draftingToolbox');
  const toolboxBody = scene.getMeshByName('draftingToolboxBody');
  const toolboxBounds = toolboxBody.getBoundingInfo().boundingBox;
  assert.ok(Math.abs(toolboxBounds.extendSize.z * 2 - .08) < 1e-7,
    'Toolbox body is eight centimeters deep rather than thirty-two');
  const toolboxFront = toolboxBody.position.z + toolboxBounds.minimum.z;
  assert.ok(Math.abs(toolboxFront + .08) < 1e-7, 'Thinning the toolbox preserves its front face');
  assert.ok(scene.getMeshByName('toolboxDrawer-0').position.z < toolboxFront,
    'Toolbox buttons remain in front of the thinner body');
  assert.equal(scene.getMeshByName('draftingToolboxCarryHandle').position.z, toolboxBody.position.z,
    'Carry handle stays aligned with the thinner body');
  for (const name of ['drawingToolTrayBacking', 'stencilTrayBacking', 'cookieCutterTrayBacking',
    'draftingTableBacking', 'draftingToolboxBody']) {
    const background = scene.getMeshByName(name);
    assert.equal(background.material.alpha, .45, `${name} is semi-transparent`);
    assert.equal(background.material.disableDepthWrite, true, `${name} does not hide content behind it`);
  }
  assert.equal(scene.getMaterialByName('drawingTrayFelt').alpha, 1, 'Physical tool felt remains opaque');
  assert.equal(scene.getMaterialByName('draftingToolboxMetal').alpha, 1, 'Grab handles remain opaque');
  assert.equal(toolbox?.isEnabled(), false, 'Toolbox defaults closed even in immersive editing');
  for (const name of ['drawingToolTray', 'advancedDraftingTray', 'fieldStencilTray', 'fieldCookieCutterTray']) {
    assert.equal(scene.getTransformNodeByName(name).parent, toolbox, 'Tool drawers begin inside the box');
    assert.equal(scene.getTransformNodeByName(name).isEnabled(), false, 'Stored drawers stay closed');
  }
  act('show');
  assert.equal(scene.getTransformNodeByName('drawingToolTray').isEnabled(), true);
  act('stencils');
  assert.equal(scene.getTransformNodeByName('fieldStencilTray').isEnabled(), true);
  act('cutters');
  assert.equal(scene.getTransformNodeByName('fieldCookieCutterTray').isEnabled(), true);
  for (const [command, name, backingName] of [
    ['show', 'drawingToolTray', 'drawingToolTrayBacking'],
    ['stencils', 'fieldStencilTray', 'stencilTrayBacking'],
    ['cutters', 'fieldCookieCutterTray', 'cookieCutterTrayBacking'],
    ['drafting', 'advancedDraftingTray', 'advancedDraftingTrayBacking'],
  ]) {
    act(command);
    const panelRoot = scene.getTransformNodeByName(name);
    const backing = scene.getMeshByName(backingName);
    assert.ok(panelRoot && backing, `${command} panel has a grabbable backing`);
    assert.ok(context.beginFloatingPanelGrab('left', Matrix.Identity(), backing, undefined, 0.03, true));
    context.updateFloatingPanelGrab('left', Matrix.Translation(0.2, 0.1, 0.3));
    context.endFloatingPanelGrab('left');
    const pose = panelRoot.computeWorldMatrix(true).clone();
    act('hide');
    act(command);
    assert.ok(panelRoot.computeWorldMatrix(true).asArray().every((value, index) =>
      Math.abs(value - pose.asArray()[index]) < 1e-6), `${command} keeps manual placement when reopened`);
  }
  context.recallFloatingPanels();
  act('show');
  act('stencils');
  act('cutters');
  const kinds = ['pencil', 'eraser', 'ruler', 'protractor', 'compass',
    'circleStencil', 'squareStencil', 'triangleStencil', 'pentagonStencil', 'hexagonStencil', 'starStencil'];
  assert.ok(kinds.every(kind => scene.getTransformNodeByName(`fieldTool-${kind}`)),
    'Trays contain every requested physical tool and stencil');
  assert.equal(scene.getMeshByName('fieldTool-pencilPanel-close'), null, 'Pencils are tools, not framed panels');
  act('pencil');
  assert.equal(scene.getTransformNodeByName('fieldTool-pencil').parent, null);
  act('toolboxStore');
  assert.equal(scene.getTransformNodeByName('drawingToolTray').parent, toolbox);
  assert.equal(scene.getTransformNodeByName('fieldTool-pencil').parent,
    scene.getTransformNodeByName('drawingToolTray'), 'Store all redocks a withdrawn tool');
  assert.equal(scene.getTransformNodeByName('fieldTool-pencil').isEnabled(), false);
  act('show');
  assert.equal(scene.getTransformNodeByName('drawingToolTray').parent, null, 'Opening a drawer detaches it from storage');
  assert.equal(scene.getTransformNodeByName('fieldTool-pencil').isEnabled(), true);
  const close = context.executeFloatingPanelControl({ action: 'panelControl', panelId: toolbox.uniqueId, command: 'close' });
  assert.equal(close.tool, 'toolboxStore', 'Toolbox close uses storage lifecycle');
  act(close.tool);
  assert.equal(toolbox.isEnabled(), false);
  context.recallFloatingPanels();
  assert.equal(toolbox.isEnabled(), true, 'Bring panels recalls a closed toolbox');
  act('show');
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
  assert.equal(scene.getMeshByName('drawingGuide')?.material?.name, 'drawingGuideYarnMaterial',
    'Committed layout guides use visible yarn rather than thin line geometry');
  assert.equal(scene.meshes.filter(mesh => /Tack|draftPin/.test(mesh.name)).length, 0,
    'Layout guides use no thumbtacks or pins');
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
  act('path');
  const fixedCompassRadius = conversions.at(-1)[1][0].x;
  act('larger');
  context.handleDrawingPointer('down', point(0, 0));
  context.handleDrawingPointer('move', point(2, 0));
  context.handleDrawingPointer('move', point(4, 0));
  context.handleDrawingPointer('up', point(4, 0));
  act('path');
  assert.ok(Math.abs(conversions.at(-1)[1][0].x - fixedCompassRadius * 1.25) < 1e-7,
    'Span sets the compass radius, and dragging preserves that radius and original center');
  act('smaller');
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
  stroke('ruler', point(0, 0), point(4, 2));
  assert.equal(context.selectDrawingGuideNear(point(2, 1), 0.1), true);
  stroke('pencil', point(4.1, 2), point(8, 5));
  assert.equal(guideCount(), 1, 'Pencil extends the original straight guide, not a second guide');
  let extended = context.getSelectedDrawingGuidePoints();
  assert.ok(extended[1].equalsWithEpsilon(point(8.4, 4.2)), 'Extension projects onto the original heading');
  stroke('pencil', point(0, 0), point(-4, -3));
  extended = context.getSelectedDrawingGuidePoints();
  assert.ok(extended[0].equalsWithEpsilon(point(-4.4, -2.2)), 'Either endpoint can be extended outward');
  const beforeInward = extended.map(p => p.clone());
  stroke('pencil', point(-4.4, -2.2), point(0, 0));
  assert.ok(context.getSelectedDrawingGuidePoints().every((p, i) => p.equalsWithEpsilon(beforeInward[i])),
    'Drawing inward does not shorten an existing guide');
  stroke('pencil', point(8.4, 4.2), point(100, 50));
  extended = context.getSelectedDrawingGuidePoints();
  assert.ok(Math.abs(extended[1].x - 53.333 / 2) < 1e-6, 'Extensions stop exactly at the field boundary');
  assert.ok(Math.abs(extended[1].z - extended[1].x / 2) < 1e-6, 'Boundary clipping preserves heading');
  act('clear');
  stroke('ruler', point(0, 0), point(4, 0));
  stroke('pencil', point(4.251, 0), point(6, 2));
  assert.equal(guideCount(), 2, 'Pencil remains freehand outside the endpoint tolerance');
  act('clear');
  stroke('spline', point(-4, 0), point(4, 0));
  stroke('pencil', point(4, 0), point(6, 2));
  assert.equal(guideCount(), 2, 'Curved guides do not capture a freehand pencil stroke');
  act('clear');
  stroke('tape', point(0, 0), point(3, 0));
  stroke('pencil', point(3, 0), point(6, 1));
  assert.equal(guideCount(), 1);
  assert.ok(scene.getMeshByName('draftingGuideLabel').metadata.label.includes('6.00 yd'),
    'Extending a measured straight guide refreshes its label');
  const extendedSave = JSON.parse(context.exportDrawingWorkspace());
  assert.equal(extendedSave.guides[0].options.controls[1].x, 6,
    'Extended control points are persisted instead of restoring the old length');
  act('clear');
  for (const scale of [1, 0.05]) {
    root.position.set(3, 1, -2); root.rotation.y = 0.7; root.scaling.setAll(scale);
    root.computeWorldMatrix(true);
    stroke('ruler', point(0, 0), point(3, 0));
    act('pencil');
    pencil.rotationQuaternion.copyFrom(Quaternion.RotationAxis(Vector3.Up(), 0.7));
    const placePencilTip = x => {
      const tipWorld = Vector3.TransformCoordinates(new Vector3(x, -0.48, 0), root.computeWorldMatrix(true));
      pencil.position.copyFrom(tipWorld.add(new Vector3(0, 0.12 * pencil.scaling.y, 0)));
    };
    placePencilTip(3);
    context.beginFloatingPanelGrab('right', Matrix.Identity(), mesh, undefined, 0.03, true);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    placePencilTip(6);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    context.endFloatingPanelGrab('right');
    scene.onBeforeRenderObservable.notifyObservers(scene);
    act('path');
    assert.equal(guideCount(), 1, 'Held pencil extends the same guide at full and tabletop scale');
    assert.ok(conversions.at(-1)[1][1].equalsWithEpsilon(point(6, 0), 1e-5),
      'Held extension stays field-local under translation, rotation and scale');
    act('clear');
  }
  root.position.setAll(0); root.rotation.setAll(0); root.scaling.setAll(1);
  root.computeWorldMatrix(true);
  act('laserPin');
  assert.ok(messages.at(-1).includes('Aim the laser'), 'Pinning without a beam reports what is missing');
  stroke('laser', point(0, 0), point(4, 0));
  assert.equal(guideCount(), 0, 'Aiming the laser does not silently commit a guide');
  const desktopBeam = scene.getMeshByName('fieldLaserBeam');
  assert.ok(desktopBeam, 'Desktop drag leaves a live laser line ready to save');
  assert.equal(desktopBeam.parent, root);
  act('laserPin');
  assert.equal(guideCount(), 1, 'Save laser line explicitly saves the beam as a layout guide');
  act('path');
  assert.ok(Math.abs(conversions.at(-1)[1][0].x + 53.333 / 2) < 1e-6);
  assert.ok(Math.abs(conversions.at(-1)[1][1].x - 53.333 / 2) < 1e-6,
    'Laser spans the entire field, not just the desktop drag endpoints');
  act('undo');
  assert.equal(guideCount(), 0, 'Pinned laser lines support guide undo');
  act('stop');
  assert.equal(scene.getMeshByName('fieldLaserBeam'), null, 'Putting away the laser removes its live beam');
  const diagonal = context.buildLaserGuide(point(0, 0), new Vector3(1, 0, 1));
  assert.ok(context.isGuideOnField(diagonal), 'Diagonal beam clips to field bounds');
  assert.equal(context.buildLaserGuide(point(50, 0), new Vector3(0, 0, 1)).length, 0,
    'Parallel off-field laser has no projection');
  assert.equal(context.buildLaserGuide(point(0, 0), Vector3.Up()).length, 0,
    'Vertical laser has no horizontal projection');
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
  {
    const desktopCamera = scene.activeCamera;
    const xrCamera = new FreeCamera('drawingXRCamera', new Vector3(0, 1.6, -3), scene);
    xrCamera.getClassName = () => 'WebXRCamera';
    scene.activeCamera = xrCamera;
    testARScale = 1;
    act('ruler');
    const ruler = scene.getTransformNodeByName('fieldTool-ruler');
    const base = ruler.scaling.x / 120;
    assert.ok(base >= 0.5 && base <= 3, 'Full-size field tools keep the chosen span, multiplied by the field scale');
    const fieldSurfaceY = Vector3.TransformCoordinates(new Vector3(0, -0.48, 0), root.computeWorldMatrix(true)).y;
    const rulerTip = Vector3.TransformCoordinates(new Vector3(-.12, -.12, 0), ruler.computeWorldMatrix(true));
    assert.ok(Math.abs(rulerTip.y - fieldSurfaceY - .008 * root.scaling.y) < 1e-5,
      'Rulers are laid directly on the field rather than floating above it');
    testARScale = 1 / 60;
    arScaleChanged.notifyObservers(testARScale);
    assert.ok(Math.abs(ruler.scaling.x - base * 2) < 1e-9, 'Held tools resize with the field scale');
    act('larger');
    assert.ok(Math.abs(ruler.scaling.x - base * 1.25 * 2) < 1e-9, 'Span changes keep the field-proportional size');
    act('smaller');
    act('stop');
    assert.equal(ruler.scaling.x, 0.65, 'Docked tools keep their tray size');
    testARScale = 1 / 120;
    scene.activeCamera = desktopCamera;
    xrCamera.dispose();
  }
  act('laser');
  const laser = scene.getTransformNodeByName('fieldTool-laser');
  laser.rotationQuaternion.copyFrom(Quaternion.FromEulerAngles(0, 0.7, 0));
  laser.position.copyFrom(Vector3.TransformCoordinates(new Vector3(0, 2, 0), root.computeWorldMatrix(true)));
  const laserBody = scene.getMeshByName('fieldLaserBody');
  context.beginFloatingPanelGrab('right', Matrix.Identity(), laserBody, undefined, 0.03, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.ok(scene.getMeshByName('fieldLaserBeam'), 'Held laser projects without touching the field');
  act('laserPin');
  act('path');
  assert.ok(context.isGuideOnField(conversions.at(-1)[1]),
    'Laser guides stay field-local under tabletop translation, rotation, and scale');
  assert.ok(Math.abs(conversions.at(-1)[1][0].x + 53.333 / 2) < 1e-5);
  const beamVertexCount = scene.getMeshByName('fieldLaserBeam').getTotalVertices();
  laser.position.z += 0.01;
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(scene.meshes.filter(mesh => mesh.name === 'fieldLaserBeam').length, 1);
  assert.equal(scene.getMeshByName('fieldLaserBeam').getTotalVertices(), beamVertexCount,
    'Moving the laser updates its existing beam geometry');
  context.endFloatingPanelGrab('right');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(scene.getMeshByName('fieldLaserBeam'), null, 'Releasing the XR laser turns off the live beam');
  act('clear');
  calibration.checked = true;
  act('laserPin');
  assert.ok(messages.at(-1).includes('calibration'), 'Floor calibration blocks laser pinning');
  act('pencil');
  assert.ok(messages.at(-1).includes('calibration'));
  assert.equal(context.handleDrawingPointer('down', point(0, 0)), false);
  calibration.checked = false;
  act('stop');
  root.position.setAll(0); root.rotation.setAll(0); root.scaling.setAll(1);
  root.computeWorldMatrix(true);
  act('drafting');
  assert.equal(scene.getTransformNodeByName('advancedDraftingTray').isEnabled(), true);
  const draftingKinds = ['tSquare', 'setSquare', 'dividers', 'tape', 'spline', 'offset', 'annotation'];
  assert.ok(draftingKinds.every(kind => scene.getTransformNodeByName(`fieldTool-${kind}`)),
    'All eight advanced implements exist as grabbable physical tools');
  assert.ok(![...actions.values()].some(hit => hit.tool === 'addTack'), 'The tray has no Add tack button');
  stroke('tSquare', point(0, 0), point(4, 1));
  act('path');
  assert.ok(Math.abs(conversions.at(-1)[1][1].z) < 1e-8, 'T-square constrains lines to field axes');
  act('clear');
  for (const angle of [30, 45, 60, 90]) {
    draftAngleInput.value = String(angle);
    stroke('setSquare', point(0, 0), point(4, 3));
    act('path');
    const end = conversions.at(-1)[1][1];
    const degrees = Math.atan2(end.z, end.x) * 180 / Math.PI;
    assert.ok(Math.abs(degrees / angle - Math.round(degrees / angle)) < 1e-7,
      `Set square constrains to ${angle}-degree increments`);
    act('clear');
  }
  stroke('ruler', point(0, 0), point(5, 0));
  draftSpacingInput.value = '1.25';
  stroke('dividers', point(0, 0), point(1, 0));
  assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('drawingGuideDivisionMark-')).length, 5,
    'Divider copy adds five exactly spaced flat marks and the source guide has none');
  assert.equal(scene.meshes.filter(mesh => /Tack/.test(mesh.name)).length, 0, 'Dividers use no tacks');
  const divisions = context.divideDraftLine([point(0, 0), point(2, 0), point(2, 3)], 1.25);
  assert.equal(divisions.length, 5);
  assert.ok(divisions[2].equalsWithEpsilon(point(2, 0.5)), 'Dividers follow path length through corners');
  act('clear');
  stroke('ruler', point(0, 0), point(4, 0));
  stroke('offset', point(0, 0), point(1, 1));
  act('path');
  assert.ok(conversions.at(-1)[1].every(p => Math.abs(p.z - 1.25) < 1e-8), 'Offset uses exact configured distance');
  act('draftSide');
  stroke('offset', point(0, 0), point(1, 1));
  act('path');
  assert.ok(conversions.at(-1)[1].every(p => Math.abs(p.z) < 1e-8), 'Offset side reverses the displacement');
  act('clear');
  stroke('ruler', point(0, 0), point(4, 2));
  act('draftReference');
  stroke('tSquare', point(0, 3), point(4, 4));
  act('path');
  const parallel = conversions.at(-1)[1];
  assert.ok(Math.abs((parallel[1].z - parallel[0].z) / (parallel[1].x - parallel[0].x) - 0.5) < 1e-8);
  act('draftReference');
  act('clear');
  stroke('tape', point(0, 0), point(3, 4));
  assert.ok(scene.getMeshByName('draftingGuideLabel').metadata.label.includes('5.00 yd | 8.00 steps'));
  assert.equal(scene.getMeshByName('draftPinHead-0'), null, 'Tape measurements create no draggable pins');
  act('clear');
  stroke('annotation', point(0, 0), point(2, 0));
  assert.equal(scene.getMeshByName('draftingGuideLabel').metadata.label, 'Test note');
  act('clear');
  draftTextInput.value = ' ';
  stroke('annotation', point(0, 0), point(2, 0));
  assert.equal(guideCount(), 0);
  assert.ok(messages.at(-1).includes('annotation text'), 'Empty notes report an actionable error');
  draftTextInput.value = 'Test note';
  stroke('spline', point(-4, 0), point(4, 0));
  act('path');
  const oldCurve = conversions.at(-1)[1];
  assert.equal(oldCurve.length, 65);
  assert.ok(oldCurve[32].z > 0.5, 'Spline creates a bent curve without control pins');
  assert.equal(scene.getMeshByName('draftPinHead-1'), null, 'Splines create no draggable pins');
  act('clear');
  root.position.set(3, 1, -2); root.rotation.y = 0.7; root.scaling.setAll(0.05);
  root.computeWorldMatrix(true);
  stroke('tape', point(-3, 0), point(3, 0));
  act('path');
  assert.ok(conversions.at(-1)[1][0].equalsWithEpsilon(point(-3, 0), 1e-5),
    'Tape converts correctly under tabletop translation, rotation, and scale');
  act('undo');
  assert.equal(guideCount(), 0, 'Undo removes the whole tape guide');
  act('clear');
  root.position.setAll(0); root.rotation.setAll(0); root.scaling.setAll(1);
  root.computeWorldMatrix(true);
  for (const kind of draftingKinds) {
    act('clear');
    if (kind === 'offset') stroke('ruler', point(-3, 0), point(3, 0));
    act(kind);
    const tool = scene.getTransformNodeByName(`fieldTool-${kind}`);
    tool.rotationQuaternion.copyFrom(Quaternion.Identity());
    tool.position.set(0, -0.48 + 0.12 * tool.scaling.y, 0);
    const body = tool.getChildMeshes().find(mesh => mesh.isPickable);
    context.beginFloatingPanelGrab('left', Matrix.Identity(), body, undefined, 0.03, true);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    context.endFloatingPanelGrab('left');
    scene.onBeforeRenderObservable.notifyObservers(scene);
    if (kind === 'dividers') {
      assert.ok(messages.at(-1).includes('interval long'), 'Physical dividers reject a segment shorter than spacing');
    } else {
      assert.ok(guideCount() >= 1, `${kind} commits from held field contact and release`);
    }
    act('stop');
  }
  act('clear');
  draftSpacingInput.value = '0';
  stroke('dividers', point(0, 0), point(4, 0));
  assert.equal(guideCount(), 0);
  assert.ok(messages.at(-1).includes('spacing'));
  draftSpacingInput.value = '1.25';
  act('clear');
  act('restoreDrafting');
  assert.ok(messages.at(-1).includes('No saved'), 'Missing saves are reported explicitly');
  draftTextInput.value = 'Remember the opening set';
  stroke('stickyNote', point(2, 3), point(2, 3));
  assert.equal(scene.getMeshByName('draftingStickyNote').metadata.label, draftTextInput.value);
  assert.equal(scene.getMeshByName('draftPinHead-0'), null, 'Sticky notes create no draggable pins');
  stroke('tape', point(0, 0), point(3, 4));
  stroke('spline', point(-4, 0), point(4, 0));
  gridToggle.checked = true; gridInterval.value = '2.5';
  act('saveDrafting');
  assert.ok(messages.at(-1).includes('Saved 3'), messages.at(-1));
  const originalSave = [...savedWorkspaceData.values()][0];
  assert.ok(originalSave);
  act('clear');
  gridToggle.checked = false; gridInterval.value = '5';
  draftTextInput.value = 'Changed';
  act('restoreDrafting');
  assert.equal(guideCount(), 3, 'Local restore rebuilds saved guides');
  assert.equal(scene.getMeshByName('draftingStickyNote').metadata.label, 'Remember the opening set');
  assert.ok(scene.getMeshByName('draftingGuideLabel').metadata.label.includes('5.00 yd'));
  assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('draftPinHead-')).length, 0,
    'Restored sticky, tape, and spline guides have no pins');
  assert.equal(gridToggle.checked, true); assert.equal(gridInterval.value, '2.5');
  assert.equal(draftTextInput.value, 'Remember the opening set');
  stroke('ruler', point(0, 0), point(2, 0));
  act('restoreDrafting');
  assert.equal(guideCount(), 4, 'Restoring over current work requires confirmation');
  assert.ok(messages.at(-1).includes('confirm'));
  act('restoreDrafting');
  assert.equal(guideCount(), 3, 'Second restore replaces rather than appends');
  storageFailure = true;
  act('saveDrafting');
  assert.ok(messages.at(-1).includes('Could not save'));
  assert.equal([...savedWorkspaceData.values()][0], originalSave, 'Failed save preserves previous data');
  storageFailure = false;
  const storageKey = [...savedWorkspaceData.keys()][0];
  savedWorkspaceData.set(storageKey, '{"version":999}');
  act('restoreDrafting');
  assert.ok(messages.at(-1).includes('Could not restore'));
  assert.equal(guideCount(), 3, 'Corrupt save leaves current guides untouched');
  savedWorkspaceData.set(storageKey, originalSave);
  for (const mutate of [
    data => { data.settings.spacing = 0; },
    data => { data.guides[0].points[0].x = 999; },
    data => { data.guides[0].options.controls = []; },
    data => { data.guides[0].options.label = 'x'.repeat(161); },
    data => { data.guides = Array.from({ length: 101 }, () => data.guides[0]); },
  ]) {
    const invalid = JSON.parse(originalSave);
    mutate(invalid);
    savedWorkspaceData.set(storageKey, JSON.stringify(invalid));
    act('restoreDrafting');
    assert.ok(messages.at(-1).includes('Could not restore'));
    assert.equal(guideCount(), 3, 'Invalid saved state never replaces current work');
  }
  savedWorkspaceData.set(storageKey, originalSave);
  act('restoreDrafting');
  stroke('ruler', point(0, 0), point(2, 0));
  act('restoreDrafting');
  assert.ok(messages.at(-1).includes('confirm'), 'Drawing disarms an earlier replacement confirmation');
  act('clear');
  act('restoreDrafting');
  const heldTool = scene.getTransformNodeByName('fieldTool-tape').getChildMeshes().find(mesh => mesh.isPickable);
  context.beginFloatingPanelGrab('right', Matrix.Identity(), heldTool, undefined, 0.03, true);
  act('saveDrafting');
  assert.ok(messages.at(-1).includes('Release drafting'), 'Saving while a tool is held is explicitly blocked');
  context.endFloatingPanelGrab('right');
  act('stop');
  act('saveDrafting');
  assert.ok(messages.at(-1).includes('Saved 3'));
  calibration.checked = true;
  act('restoreDrafting');
  assert.ok(messages.at(-1).includes('calibration'));
  calibration.checked = false;
  act('deleteDrafting');
  assert.equal(savedWorkspaceData.size, 0);
  assert.equal(guideCount(), 3, 'Deleting saved data does not delete current work');
  const flushPhoto = async () => { await new Promise(resolve => setImmediate(resolve)); };
  act('restorePhoto');
  assert.ok(messages.at(-1).includes('No camera snapshot'));
  const fieldSurface = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
  const excludedRoute = MeshBuilder.CreateBox('testMarcherRoute', {}, scene);
  excludedRoute.parent = root;
  const excludedTray = scene.getMeshByName('draftingCameraBody');
  const physicalCamera = scene.getTransformNodeByName('fieldTool-camera');
  context.beginFloatingPanelGrab('left', Matrix.Identity(), excludedTray, undefined, 0.03, true);
  assert.equal(physicalCamera.parent, null, 'Camera is a grabbable physical implement');
  assert.ok([...actions.values()].some(hit => hit.tool === 'takePhoto'), 'Physical shutter exposes capture action');
  act('takePhoto');
  act('clear');
  assert.equal(guideCount(), 3, 'Edits are blocked while capture is pending');
  await flushPhoto();
  const photoKey = 'chartxr.draftingCamera.v1';
  const savedPhoto = savedWorkspaceData.get(photoKey);
  assert.ok(savedPhoto, messages.at(-1));
  assert.ok(messages.at(-1).includes('saved together'), 'Capture works while holding the camera');
  context.endFloatingPanelGrab('left');
  const photo = JSON.parse(savedPhoto);
  assert.equal(photo.image, testPng);
  assert.deepEqual(encodedPixels, [0, 0, 255, 255, 255, 0, 0, 255], 'PNG encoding flips framebuffer rows upright');
  assert.equal(JSON.parse(photo.workspace).guides.length, 3);
  act('downloadPhoto');
  assert.ok(downloadedPhoto.filename.endsWith('.png'));
  assert.equal(downloadedPhoto.href, 'blob:field-photo');
  assert.equal(downloadedBlob.type, 'image/png');
  assert.equal(downloadedBlob.size, 8);
  assert.equal(revokedDownload, 'blob:field-photo', 'Download blob URLs are cleaned up');
  assert.ok(capturedRenderList.includes(fieldSurface));
  assert.ok(capturedRenderList.includes(scene.getMeshByName('draftingStickyNote')));
  assert.ok(capturedRenderList.includes(scene.getMeshByName('drawingGuide')));
  assert.ok(!capturedRenderList.includes(excludedRoute), 'Capture excludes marching routes');
  assert.ok(!capturedRenderList.includes(excludedTray), 'Capture excludes tool trays and camera');
  assert.equal(scene.getCameraByName('draftingSnapshotCamera'), null, 'Temporary camera is disposed');
  assert.equal(scene.activeCamera, camera, 'Capture leaves the viewer camera unchanged');
  storageFailure = true;
  act('takePhoto'); await flushPhoto();
  assert.ok(messages.at(-1).includes('Could not save camera'));
  assert.equal(savedWorkspaceData.get(photoKey), savedPhoto, 'Quota failures preserve the paired snapshot');
  storageFailure = false; captureFailure = true;
  act('takePhoto'); await flushPhoto();
  assert.equal(savedWorkspaceData.get(photoKey), savedPhoto, 'Image capture failure preserves previous snapshot');
  captureFailure = false;
  captureTimeout = true;
  act('takePhoto'); await flushPhoto();
  assert.ok(messages.at(-1).includes('timed out'));
  assert.equal(savedWorkspaceData.get(photoKey), savedPhoto, 'Capture timeout preserves previous snapshot');
  captureTimeout = false;
  act('takePhoto');
  draftTextInput.value = 'Changed during screenshot';
  await flushPhoto();
  assert.ok(messages.at(-1).includes('changed during capture'), 'State drift cannot save a mismatched photo/workspace');
  assert.equal(savedWorkspaceData.get(photoKey), savedPhoto);
  act('clear');
  act('restorePhoto');
  assert.equal(guideCount(), 3, 'Photo restores its own paired drafting workspace');
  stroke('ruler', point(0, 0), point(2, 0));
  act('restorePhoto');
  assert.equal(guideCount(), 4);
  assert.ok(messages.at(-1).includes('Restore photo'));
  act('restoreDrafting');
  act('restorePhoto');
  assert.equal(guideCount(), 4, 'Switching restore sources disarms confirmation');
  act('restorePhoto');
  assert.equal(guideCount(), 3);
  for (const mutate of [
    data => { data.version = 2; },
    data => { data.image = 'javascript:alert(1)'; },
    data => { data.workspace = '{"version":999}'; },
    data => { data.capturedAt = 'invalid'; },
  ]) {
    const invalid = JSON.parse(savedPhoto); mutate(invalid);
    savedWorkspaceData.set(photoKey, JSON.stringify(invalid));
    act('restorePhoto');
    assert.ok(messages.at(-1).includes('Could not restore camera'));
    assert.equal(guideCount(), 3);
  }
  savedWorkspaceData.set(photoKey, savedPhoto);
  root.position.set(3, 1, -2); root.rotation.y = 0.7; root.scaling.setAll(0.05);
  root.computeWorldMatrix(true);
  act('takePhoto'); await flushPhoto();
  const expectedEye = Vector3.TransformCoordinates(new Vector3(0, -0.48 + 90, 0), root.getWorldMatrix());
  assert.ok(capturedView.position.equalsWithEpsilon(expectedEye, 1e-5), 'Camera framing follows tabletop transforms');
  assert.ok(Math.abs(capturedView.width - 124 * 0.05) < 1e-5);
  assert.ok(capturedView.up.equalsWithEpsilon(Vector3.TransformNormal(Vector3.Right(), root.getWorldMatrix()).normalize(), 1e-5));
  assert.equal(capturedView.size.width, 1240);
  calibration.checked = true;
  act('takePhoto');
  assert.ok(messages.at(-1).includes('calibration'), 'Calibration blocks taking snapshots');
  calibration.checked = false;
  fieldSurface.dispose(); excludedRoute.dispose();
  root.position.setAll(0); root.rotation.setAll(0); root.scaling.setAll(1); root.computeWorldMatrix(true);
  act('clear');
  act('stop');
  assert.equal(context.isFieldDrawingToolActive(), false);
  assert.equal(pencil.parent.name, 'drawingToolTray', 'Put away returns physical implements to their trays');
  assert.equal(context.handleDrawingPointer('down', point(0, 0)), false);
  assert.equal(context.guideTouchesSweep([point(0, 0), point(0, 3)], point(2, 0), point(2, 3), 0.5), false,
    'Parallel, separated eraser motion does not delete a guide');
  const snapNear = (input, guides, grid, expected, label) =>
    assert.ok(context.snapDraftingPoint(input, guides, grid).equalsWithEpsilon(expected, 1e-8), label);
  snapNear(point(1.1, 1.1), [[point(1, 1), point(5, 1)]], 0.5, point(1, 1), 'Endpoints win over lines/grid');
  snapNear(point(3, 1.1), [[point(1, 1), point(5, 1)]], 0.5, point(3, 1), 'Nearest guide line wins over grid');
  snapNear(point(2.1, 2.1), [], 1, point(2, 2), 'Nearby grid points snap');
  snapNear(point(2.4, 2.4), [], 1, point(2.4, 2.4), 'Grid does not pull strokes outside the 0.25-yard tolerance');
  snapNear(point(2.1, 2.1), [], NaN, point(2.1, 2.1), 'Invalid grid spacing does not produce invalid geometry');
  gridToggle.checked = false;
  gridInterval.value = '1';
  draftSpacingInput.value = '1.25'; draftAngleInput.value = '90';
  const modePose = root.computeWorldMatrix(true).clone();
  testARScale = 1;
  act('table');
  assert.equal(context.isDraftingTableMode(), true);
  assert.equal(gridToggle.checked, true, 'Drafting mode enables the existing grid');
  assert.equal(scene.getTransformNodeByName('draftingTableWorkspace').isEnabled(), true);
  assert.equal(testARScale, 1, 'Desktop drafting keeps full 1:1 scale');
  assert.ok(root.computeWorldMatrix(true).equals(modePose), 'Stubbed AR pose helpers leave the isolated guide root unchanged');
  act('drafting');
  assert.equal(scene.getTransformNodeByName('drawingToolTray').isEnabled(), false, 'Only one tool category is open');
  assert.equal(scene.getTransformNodeByName('advancedDraftingTray').isEnabled(), true);
  act('stencils');
  assert.equal(scene.getTransformNodeByName('advancedDraftingTray').isEnabled(), false);
  act('tableSnap');
  assert.ok(messages.at(-1).includes('off'));
  stroke('tape', point(0, 0), point(4, 0));
  act('guideSelect');
  assert.equal(context.isFieldDrawingToolActive(), true, 'Table selection remains active after putting tools away');
  assert.equal(context.handleDrawingPointer('down', point(2, 0)), true, 'Desktop field clicks select guides in table mode');
  assert.equal(context.getSelectedDrawingGuidePoints().length, 2);
  act('guideSpacingMore');
  act('guideFacing');
  act('guideFacingRight');
  let configured = JSON.parse(context.exportDrawingWorkspace()).guides[0].options;
  assert.equal(configured.spacing, 1.563);
  assert.equal(configured.facing, 'fixed');
  assert.equal(configured.facingAngle, 15);
  act('formation');
  assert.equal(conversions.at(-1)[2].spacing, configured.spacing, 'Formation receives selected-guide spacing');
  assert.equal(conversions.at(-1)[2].facingAngle, 15, 'Formation receives selected-guide facing');
  act('guideForward');
  assert.ok(context.getSelectedDrawingGuidePoints().every(p => Math.abs(p.z - 1.25) < 1e-8));
  act('guideRotateRight');
  let movedGuide = context.getSelectedDrawingGuidePoints();
  assert.ok(movedGuide[0].equalsWithEpsilon(point(2, -0.75), 1e-8));
  assert.ok(movedGuide[1].equalsWithEpsilon(point(2, 3.25), 1e-8), 'Rotation preserves length and uses bounding center');
  assert.ok(scene.getMeshByName('draftingGuideLabel').metadata.label.includes('90.0'),
    'Rotating a measurement refreshes its heading label');
  act('guideDuplicate');
  assert.equal(guideCount(), 2);
  assert.ok(context.getSelectedDrawingGuidePoints()[0].equalsWithEpsilon(point(3.25, -0.75), 1e-8));
  act('guideForward');
  let tableSave = JSON.parse(context.exportDrawingWorkspace());
  assert.equal(tableSave.guides[0].points[0].z, -0.75, 'Duplicate edits do not mutate the source');
  assert.equal(tableSave.guides[1].points[0].z, 0.5);
  assert.equal(tableSave.guides[1].options.controls[0].z, 0.5, 'Edited control coordinates are saved');
  assert.equal(tableSave.guides[1].options.spacing, configured.spacing, 'Duplication preserves individual guide spacing');
  assert.equal(tableSave.guides[1].options.facingAngle, 15, 'Fixed field facing survives geometry edits');
  assert.equal(context.importDrawingWorkspace(JSON.stringify(tableSave)), true);
  assert.equal(context.getSelectedDrawingGuidePoints(), null, 'Restore clears stale selection');
  act('guideDelete');
  assert.ok(messages.at(-1).includes('Select a drafted guide'), 'Missing selection is explicit');
  act('clear');
  stroke('ruler', point(25, 0), point(26, 0));
  act('guideSelect'); context.handleDrawingPointer('down', point(25.5, 0));
  const boundarySave = context.exportDrawingWorkspace();
  act('guideRight');
  assert.ok(messages.at(-1).includes('rejected'));
  assert.equal(context.exportDrawingWorkspace(), boundarySave, 'Out-of-field edit leaves geometry and save unchanged');
  act('clear');
  stroke('spline', point(-4, 0), point(4, 0));
  act('guideSelect');
  context.handleDrawingPointer('down', point(0, 1));
  act('guideLeft');
  const splineSave = context.exportDrawingWorkspace();
  assert.equal(context.importDrawingWorkspace(splineSave), true);
  assert.equal(context.exportDrawingWorkspace(), splineSave, 'Transformed spline controls round-trip exactly');
  act('clear');
  stroke('stickyNote', point(2, 3), point(2, 3));
  act('guideSelect');
  context.handleDrawingPointer('down', point(2, 3));
  assert.ok(context.getSelectedDrawingGuidePoints(), 'Sticky notes can be selected in drafting mode');
  assert.equal(context.snapToSelectedDrawingGuide(point(2, 5)), null, 'Notes never attract released marchers');
  context.selectDrawingGuideNear(point(2, 3), 0.1);
  assert.equal(context.getSelectedDrawingGuidePoints(), null);
  const noteSurface = new Vector3(3, -0.48 + 0.105, 3.4);
  assert.equal(context.selectDrawingGuideNear(noteSurface, 0.03, true), true,
    'Hands select the visible note surface rather than an invisible line underneath it');
  act('guideRight');
  assert.ok(Math.abs(scene.getMeshByName('draftingStickyNote').position.x - 3.35) < 1e-6,
    'Notes move without pins and without stretching');
  act('guideDelete');
  assert.equal(guideCount(), 0);
  assert.equal(scene.getMeshByName('draftingStickyNote'), null);
  act('tableSnap');
  stroke('ruler', point(0.1, 0.1), point(4.1, 0.1));
  act('path');
  assert.ok(conversions.at(-1)[1][0].equalsWithEpsilon(point(0, 0)));
  assert.ok(conversions.at(-1)[1][1].equalsWithEpsilon(point(4, 0)), 'Desktop tools use shared grid snapping');
  act('clear');
  act('pencil');
  pencil.rotationQuaternion.copyFrom(Quaternion.Identity());
  pencil.position.set(0.1, -0.48 + 0.12 * pencil.scaling.y, 0.1);
  context.beginFloatingPanelGrab('right', Matrix.Identity(), mesh, undefined, 0.03, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  act('tableExit');
  assert.equal(context.isDraftingTableMode(), true, 'Mode changes are blocked during held strokes');
  pencil.position.x = 4.1;
  scene.onBeforeRenderObservable.notifyObservers(scene);
  context.endFloatingPanelGrab('right');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  act('path');
  assert.ok(conversions.at(-1)[1][0].equalsWithEpsilon(point(0, 0)));
  assert.ok(conversions.at(-1)[1][1].equalsWithEpsilon(point(4, 0)), 'Held tools share the desktop snapping rules');
  act('tableExit');
  assert.equal(context.isDraftingTableMode(), false);
  assert.equal(gridToggle.checked, false, 'Exiting restores the previous grid visibility');
  assert.equal(guideCount(), 1, 'Exiting preserves the current page guides');
  assert.equal(scene.getTransformNodeByName('draftingTableWorkspace').isEnabled(), false);
  assert.equal(context.isFieldDrawingToolActive(), false, 'Normal field interaction resumes on exit');
  assert.ok(root.computeWorldMatrix(true).equals(modePose));
  calibration.checked = true;
  act('table');
  assert.equal(context.isDraftingTableMode(), false, 'Calibration blocks entry');
  calibration.checked = false;
  act('clear');
  act('stop');
  act('show');
  for (const kind of ['ruler', 'protractor', 'compass']) {
    act(kind);
    const implement = scene.getTransformNodeByName(`fieldTool-${kind}`);
    const trayCopy = scene.transformNodes.find(node => node.name.startsWith(`fieldTool-${kind}-copy-`) &&
      node.parent === scene.getTransformNodeByName('drawingToolTray'));
    assert.ok(trayCopy, `${kind} leaves a reusable copy in the tray`);
    const trayPose = trayCopy.computeWorldMatrix(true).clone();
    const fieldWorld = root.computeWorldMatrix(true);
    const fieldInverse = fieldWorld.clone().invert();
    const fieldRotation = Quaternion.Identity();
    fieldWorld.decompose(new Vector3(), fieldRotation, new Vector3());
    implement.rotationQuaternion.copyFrom(fieldRotation);
    implement.scaling.setAll(1);
    const tip = new Vector3(kind === 'ruler' ? -.12 : 0, -.12, 0);
    implement.position.copyFrom(Vector3.TransformCoordinates(new Vector3(0, -.48, 0), fieldWorld)
      .subtract(Vector3.TransformNormal(tip, implement.computeWorldMatrix(true))));
    const body = implement.getChildMeshes().find(mesh => mesh.isPickable);
    context.beginFloatingPanelGrab('right', Matrix.Identity(), body, undefined, .03, true);
    const needleBefore = Vector3.TransformCoordinates(tip, implement.computeWorldMatrix(true));
    context.updateFloatingPanelGrab('right',
      Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(.4, .8, -.3), new Vector3(.8, 1.2, -.6)));
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const toolWorld = implement.computeWorldMatrix(true);
    const needle = Vector3.TransformCoordinates(tip, toolWorld);
    const needleLocal = Vector3.TransformCoordinates(needle, fieldInverse);
    assert.ok(Math.abs(needleLocal.y - (-.48 + (kind === 'compass' ? 0 : .008))) < 1e-5,
      `${kind} working surface stays on the field`);
    const fieldUp = Vector3.TransformNormal(Vector3.Up(), fieldWorld).normalize();
    const toolUp = Vector3.TransformNormal(Vector3.Up(), toolWorld).normalize();
    assert.ok(Vector3.Dot(fieldUp, toolUp) > .99999, `${kind} rejects controller pitch and roll`);
    if (kind === 'compass') {
      assert.ok(needle.equalsWithEpsilon(needleBefore, 1e-5), 'Compass pivot does not slide during rotation');
      const pencilTip = Vector3.TransformCoordinates(new Vector3(.12, -.12, 0), toolWorld);
      assert.ok(Math.abs(Vector3.Distance(needle, pencilTip) - .12) < 1e-5,
        'Compass pencil rotates at the fixed radius');
    }
    assert.ok(trayCopy.computeWorldMatrix(true).equals(trayPose), 'Tray original is unaffected by moving a copy');
    context.endFloatingPanelGrab('right');
    if (kind !== 'compass') {
      const relative = implement.computeWorldMatrix(true).multiply(fieldInverse);
      const previousPosition = root.position.clone();
      root.position.x += .7;
      root.position.z -= .4;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const expected = relative.multiply(root.computeWorldMatrix(true)).asArray();
      assert.ok(implement.computeWorldMatrix(true).asArray().every((value, index) =>
        Math.abs(value - expected[index]) < 1e-5), 'Released flat tools follow later field transforms');
      root.position.copyFrom(previousPosition);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
    context.beginFloatingPanelGrab('left', Matrix.Identity(), trayCopy.getChildMeshes().find(mesh => mesh.isPickable),
      undefined, .03, true);
    assert.equal(trayCopy.parent, null, 'A second pickup is independent of the first');
    assert.equal(implement.parent, null);
    assert.ok(scene.transformNodes.some(node => node !== trayCopy && node.name.startsWith(`fieldTool-${kind}`) &&
      node.parent === scene.getTransformNodeByName('drawingToolTray')), 'Repeated pickup replenishes the tray');
    context.endFloatingPanelGrab('left');
    act('stop');
    act('show');
  }
  act('wire');
  act('wire');
  const wireCopies = scene.transformNodes.filter(node => node.name === 'fieldTool-wire');
  assert.equal(wireCopies.filter(node => node.parent === null).length, 2, 'Wire launchers also supply independent copies');
  assert.equal(wireCopies.filter(node => node.parent?.name === 'drawingToolTray').length, 1,
    'Memory-wire tray remains reusable');
  act('stop');
  assert.equal(scene.transformNodes.filter(node => node.name === 'fieldTool-wire').length, 1,
    'Storing tools cleans up extra wire copies');
  console.log('Drafting checks passed: physical tools, laser, advanced geometry, pin-free drafting-table lifecycle, shared snapping, selected-guide edits, bounds, persistence, camera, cleanup, tabletop transforms, and calibration gating.');
} finally {
  scene.dispose();
  engine.dispose();
}
