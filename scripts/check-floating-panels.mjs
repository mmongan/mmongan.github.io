import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const registered = new Map();
const context = vm.createContext({ scene, Matrix, Quaternion, Vector3, Plane, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3,
  isARTabletopModeActive: () => false,
  registerMenuButton(mesh, action) { registered.set(mesh, action); } });
const source = readFileSync(new URL('../src/menu/floatingPanel.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('../src/menu/settingsButtonIcons.ts', import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.api = { FloatingPanel, DetachableFloatingPanel, recallFloatingPanels, getFloatingPanelButtonNearPoint, beginFloatingPanelGrab, updateFloatingPanelGrab,
endFloatingPanelGrab, isFloatingPanelGrabbed, getFloatingPanelNear,
pickFloatingPanel, beginFloatingPanelPointerDrag, updateFloatingPanelPointerDrag,
nudgeFloatingPanelDistance };`, context);
const api = context.api;
const resetListeners = new Map();
const settingsSource = readFileSync(new URL('../src/menu/settings.ts', import.meta.url), 'utf8');
let resets = 0;
const resetContext = vm.createContext({
  recallPanelsButton: { addEventListener: (event, handler) => resetListeners.set(`settings:${event}`, handler) },
  resetPanelsButton: { addEventListener: (event, handler) => resetListeners.set(`toolbar:${event}`, handler) },
  recallFloatingPanels: () => { resets++; api.recallFloatingPanels(); },
});
vm.runInContext(stripTypeScriptTypes(settingsSource.slice(0, settingsSource.indexOf('const settingsButton')),
  { mode: 'transform' }).replace(/^import .*?;\r?$/gm, ''), resetContext);
assert.equal(resetListeners.size, 2, 'Toolbar and Settings both expose panel reset');
resetListeners.get('settings:click')();
resetListeners.get('toolbar:click')();
assert.equal(resets, 2, 'Both reset buttons use the shared recall action');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(html, /id="resetPanelsButton"[^>]*type="button"[\s\S]*?>Reset panels &amp; signs<\/button>/);
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
  const wrist = new TransformNode('detachmentWrist', scene);
  wrist.position.set(1, 2, 3);
  wrist.rotation.set(0.2, 0.7, -0.3);
  const wearable = new TransformNode('detachmentRoot', scene);
  wearable.parent = wrist;
  wearable.position.set(0, 0.035, 0.13);
  const wearableFace = MeshBuilder.CreateBox('detachmentFace', { width: 0.16, height: 0.01, depth: 0.08 }, scene);
  wearableFace.parent = wearable;
  const detachable = new api.DetachableFloatingPanel(wearable, new Set([wearableFace]),
    wearable, new Vector3(0.09, 0.025, 0.045));
  const attachedWorld = wearable.computeWorldMatrix(true).clone();
  api.beginFloatingPanelGrab('left', Matrix.Translation(0.4, 1, 2), wearableFace, undefined, 0.03, true);
  assert.equal(wearable.parent, null, 'Grabbing removes the panel from the wrist');
  assert.ok(detachable.userPlaced);
  assert.ok(wearable.computeWorldMatrix(true).asArray().every((v, i) =>
    Math.abs(v - attachedWorld.asArray()[i]) < 1e-6), 'Detaching preserves the complete world pose');
  api.updateFloatingPanelGrab('left', Matrix.Translation(0.6, 1.1, 2.3));
  const floatingPosition = attachedWorld.getTranslation().add(new Vector3(0.2, 0.1, 0.3));
  assert.ok(Vector3.Distance(wearable.position, floatingPosition) < 1e-6);
  api.endFloatingPanelGrab('left');
  wrist.position.set(5, 6, 7);
  wearable.computeWorldMatrix(true);
  assert.ok(Vector3.Distance(wearable.getAbsolutePosition(), floatingPosition) < 1e-6,
    'Released panel floats independently of subsequent wrist motion');
  api.beginFloatingPanelGrab('right', Matrix.Identity(), wearableFace);
  assert.ok(detachable.grabbed('right'), 'A floating panel can be grabbed again');
  api.endFloatingPanelGrab('right');
  wearable.dispose();
  wrist.dispose();
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
  button.setEnabled(false);
  assert.equal(api.getFloatingPanelButtonNearPoint(button.getAbsolutePosition()), null, 'Disabled controls cannot activate');
  button.setEnabled(true);
  buttonRoot.setEnabled(false);
  assert.equal(api.getFloatingPanelButtonNearPoint(button.getAbsolutePosition()), null);
  buttonRoot.dispose();
  const scaled = create('scaled', 4);
  scaled.root.scaling.setAll(0.25);
  scaled.root.computeWorldMatrix(true);
  const edge = Vector3.TransformCoordinates(new Vector3(0.368, 0, 0), scaled.desk.computeWorldMatrix(true));
  assert.ok(scaled.panel.near(edge.add(new Vector3(0.025, 0, 0))), 'Small panels retain a 3 cm world contact margin');
  assert.equal(scaled.panel.near(edge.add(new Vector3(0.035, 0, 0))), false);
  scaled.root.scaling.setAll(4);
  scaled.root.computeWorldMatrix(true);
  const largeEdge = Vector3.TransformCoordinates(new Vector3(0.368, 0, 0), scaled.desk.computeWorldMatrix(true));
  assert.equal(scaled.panel.near(largeEdge.add(new Vector3(0.04, 0, 0))), false,
    'Large panels do not inflate contact tolerance');
  scaled.root.setEnabled(false);
  assert.equal(api.beginFloatingPanelGrab('left', Matrix.Identity(), scaled.mesh), false, 'Hidden panels reject direct mesh grabs');
  scaled.root.dispose();
  const parented = create('parented', 0);
  const parent = new TransformNode('panelParent', scene);
  parent.position.set(3, 1, 2);
  parent.rotation.set(0.2, 0.6, -0.1);
  parent.scaling.setAll(0.7);
  parented.root.parent = parent;
  const originalWorld = parented.root.computeWorldMatrix(true).clone();
  parented.panel.begin('left', Matrix.Identity());
  parented.panel.update('left', Matrix.Translation(0.2, -0.1, 0.3));
  const movedWorld = parented.root.computeWorldMatrix(true);
  assert.ok(Vector3.Distance(movedWorld.getTranslation(),
    originalWorld.getTranslation().add(new Vector3(0.2, -0.1, 0.3))) < 1e-5,
    'Parented panels convert grab world coordinates back to parent space');
  assert.ok(movedWorld.asArray().slice(0, 12).every((value, index) =>
    Math.abs(value - originalWorld.asArray()[index]) < 1e-5), 'Parented grab preserves scale and orientation');
  parented.panel.end('left');
  parent.dispose();
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
  assert.equal(api.isFloatingPanelGrabbed('left'), true, 'Second hand joins a two-hand resize');
  api.endFloatingPanelGrab('right');
  api.endFloatingPanelGrab('left');
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
  const stretchRoot = new TransformNode('stretchRoot', scene);
  stretchRoot.position.set(0, 0, 1);
  const stretchSurface = new TransformNode('stretchSurface', scene);
  stretchSurface.parent = stretchRoot;
  const stretchMesh = MeshBuilder.CreatePlane('stretchSheet', { width: 0.7, height: 0.6 }, scene);
  stretchMesh.parent = stretchSurface;
  stretchMesh.material = score.mesh.material;
  let scale = 1;
  const resizePanel = new api.FloatingPanel(stretchRoot, new Set([stretchMesh]), stretchSurface,
    new Vector3(0.35, 0.3, 0.02), new Map(), {
      getScale: () => scale,
      setScale(next) { scale = Math.max(0.6, Math.min(2.5, next)); stretchSurface.scaling.setAll(scale); },
    });
  const leftPose = Matrix.Translation(-0.2, 0, 1);
  const rightPose = Matrix.Translation(0.2, 0, 1);
  api.beginFloatingPanelGrab('left', leftPose, stretchMesh);
  api.beginFloatingPanelGrab('right', rightPose, stretchMesh);
  assert.ok(resizePanel.grabbed('left') && resizePanel.grabbed('right'), 'Both sources keep the pad');
  const originalRotation = stretchRoot.rotationQuaternion.clone();
  api.updateFloatingPanelGrab('left', Matrix.Translation(-0.4, 0, 1));
  api.updateFloatingPanelGrab('right', Matrix.Translation(0.4, 0, 1));
  assert.ok(Math.abs(scale - 2) < 1e-6, 'Doubling grip separation doubles size');
  assert.ok(Vector3.Distance(stretchRoot.position, new Vector3(0, 0, 1)) < 1e-6);
  assert.ok(stretchRoot.rotationQuaternion.equals(originalRotation), 'Stretch does not flip pad orientation');
  assert.ok(resizePanel.near(new Vector3(0.6, 0, 1)), 'Hit surface grows with pad');
  api.updateFloatingPanelGrab('right', Matrix.Translation(2, 0, 1));
  assert.equal(scale, 2.5, 'Stretch respects maximum size');
  api.updateFloatingPanelGrab('right', Matrix.Translation(-0.39, 0, 1));
  assert.equal(scale, 0.6, 'Pinching hands together respects minimum size');
  api.updateFloatingPanelGrab('left', Matrix.Translation(-0.4, 0, 1));
  api.updateFloatingPanelGrab('right', Matrix.Translation(0.4, 0, 1));
  const beforeRelease = stretchRoot.position.clone();
  api.endFloatingPanelGrab('left');
  assert.ok(resizePanel.grabbed('right') && !resizePanel.grabbed('left'));
  api.updateFloatingPanelGrab('right', Matrix.Translation(0.4, 0, 1));
  assert.ok(Vector3.Distance(stretchRoot.position, beforeRelease) < 1e-6, 'One-hand release never jumps');
  api.updateFloatingPanelGrab('right', Matrix.Translation(0.6, 0.1, 1.2));
  assert.ok(Vector3.Distance(stretchRoot.position, beforeRelease.add(new Vector3(0.2, 0.1, 0.2))) < 1e-6,
    'Remaining hand continues normal movement');
  api.beginFloatingPanelGrab('left', Matrix.Translation(-0.2, 0, 1), stretchMesh);
  chart.root.setEnabled(true);
  api.beginFloatingPanelGrab('left', Matrix.Identity(), chart.mesh);
  assert.ok(resizePanel.grabbed('right') && !resizePanel.grabbed('left'), 'Transfer releases only that stretch source');
  api.endFloatingPanelGrab('left');
  chart.root.setEnabled(false);
  resizePanel.release();
  assert.equal(resizePanel.grabbed(), false, 'Hiding or placing cancels both grabs');
  const heldScale = scale;
  api.updateFloatingPanelGrab('right', Matrix.Translation(5, 0, 1));
  assert.equal(scale, heldScale, 'Released hands do not resize');
  stretchRoot.dispose();
  const camera = new FreeCamera('followCamera', Vector3.Zero(), scene);
  scene.activeCamera = camera;
  score.root.setEnabled(true);
  score.root.position.set(-0.35, -0.08, 0.75);
  score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
  const placedWorld = score.root.computeWorldMatrix(true).clone();
  camera.position.set(4, 2, -3);
  camera.rotation.y = Math.PI / 2;
  camera.rotation.x = 0.4;
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.ok(score.root.computeWorldMatrix(true).asArray().every((v, i) => Math.abs(v - placedWorld.asArray()[i]) < 1e-6),
    'Walking and looking do not move or rotate a world-fixed panel');
  score.panel.begin('left', Matrix.Identity());
  const heldPose = score.root.position.clone();
  score.panel.end('left');
  assert.ok(Vector3.Distance(score.root.position, heldPose) < 1e-6, 'Release preserves world placement');
  camera.position.x = 5;
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(score.root.position.equals(heldPose), 'Released panel does not chase viewer translation');
  score.root.setEnabled(false);
  const rimPanel = create('rimCoverage', 8);
  const rails = rimPanel.desk.getChildMeshes().filter(mesh => mesh.name.includes('GrabRim-'));
  assert.equal(rails.length, 4, 'Rectangular panels have four solid grab rails');
  for (const rail of rails) {
    const size = rail.getBoundingInfo().boundingBox.extendSize.scale(2);
    assert.ok(size.z >= .055 && Math.min(size.x, size.y) >= .018 - 1e-6,
      'Rails provide at least 5.5 cm depth and 1.8 cm edge width');
    assert.ok(rimPanel.panel.meshes.has(rail));
    const world = rail.computeWorldMatrix(true);
    assert.ok(rimPanel.panel.near(world.getTranslation()), 'Contact bounds include the physical rail');
    assert.ok(api.beginFloatingPanelGrab('right', Matrix.Identity(), rail, undefined, .03, true));
    api.endFloatingPanelGrab('right');
  }
  const rimMaterial = rails[0].material;
  const controls = ['smaller', 'larger', 'close'].map(command =>
    scene.getMeshByName(`rimCoveragePanel-${command}`));
  const header = scene.getMeshByName('rimCoveragePanelHeader');
  for (const control of controls) {
    assert.ok(control && rimPanel.panel.meshes.has(control), 'Shared header includes owned control buttons');
    assert.equal(control.parent, header, 'Size and close buttons are attached directly to the frame header');
    const headerSize = header.getBoundingInfo().boundingBox.extendSize;
    const controlSize = control.getBoundingInfo().boundingBox.extendSize;
    assert.ok(Math.abs(control.position.x) + controlSize.x <= headerSize.x &&
      Math.abs(control.position.y) + controlSize.y <= headerSize.y,
    'Button faces fit on the frame');
    assert.ok(control.position.z - controlSize.z < -headerSize.z &&
      control.position.z + controlSize.z > -headerSize.z,
    'Raised buttons intersect the frame face instead of floating in front of it');
    assert.equal(registered.get(control).action, 'panelControl');
    assert.equal(registered.get(control).panelId, rimPanel.root.uniqueId);
    control.computeWorldMatrix(true);
    assert.ok(rimPanel.panel.near(control.getAbsolutePosition()), 'Header controls fit inside contact bounds');
    for (const glyph of control.getChildMeshes()) {
      assert.equal(registered.get(glyph).panelId, rimPanel.root.uniqueId,
        'Attached button glyphs retain their panel actions');
    }
  }
  rimPanel.root.scaling.setAll(.5);
  rimPanel.panel.control('larger');
  assert.ok(Math.abs(rimPanel.root.scaling.x - .6) < 1e-6, 'Resize respects current XR panel scale');
  rimPanel.panel.control('smaller');
  assert.ok(Math.abs(rimPanel.root.scaling.x - .5) < 1e-6);
  for (let i = 0; i < 20; i++) rimPanel.panel.control('larger');
  assert.ok(Math.abs(rimPanel.root.scaling.x - 1.5) < 1e-6, 'Default resize has an upper bound');
  for (let i = 0; i < 40; i++) rimPanel.panel.control('smaller');
  assert.ok(Math.abs(rimPanel.root.scaling.x - .125) < 1e-6, 'Default resize has a lower bound');
  rimPanel.panel.begin('right', Matrix.Identity());
  assert.equal(rimPanel.panel.control('close'), null);
  assert.equal(rimPanel.panel.grabbed(), false, 'Close releases panel ownership');
  assert.equal(rimPanel.root.isEnabled(), false, 'Generic close hides stadium panels');
  rimPanel.panel.recall();
  assert.equal(rimPanel.root.isEnabled(), true, 'Recall can restore closed standalone stadium panels');
  rimPanel.root.dispose();
  assert.ok(rails.every(rail => rail.isDisposed()) && !scene.materials.includes(rimMaterial),
    'Disposing a panel releases its rails and shared rim material');
  const hiddenPose = score.root.position.clone();
  camera.position.x = 10;
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(score.root.position.equals(hiddenPose), 'Hidden panels never follow');
  score.root.setEnabled(false);
  assert.equal(api.getFloatingPanelNear(score.root.position), undefined);
  assert.equal(api.pickFloatingPanel(ray)?.hit, false);
  score.root.setEnabled(true);
  camera.position.setAll(0);
  camera.rotation.setAll(0);
  const placement = {
    desktop: { distance: 0.75, height: -0.08 },
    xr: { distance: 0.55, height: -0.22 }, side: -0.35,
  };
  score.panel.placeForViewer(placement);
  score.panel.begin('left', Matrix.Identity());
  score.panel.update('left', Matrix.Translation(2, 1, -1));
  score.panel.end('left');
  const retainedPose = score.root.computeWorldMatrix(true).clone();
  score.root.setEnabled(false);
  camera.position.set(10, 2, 3);
  score.root.setEnabled(true);
  score.panel.showForViewer(placement);
  assert.ok(score.root.computeWorldMatrix(true).asArray().every((value, index) =>
    Math.abs(value - retainedPose.asArray()[index]) < 1e-6),
    'Reopening retains exact manually placed position, rotation and scale even far from viewer');
  score.root.setEnabled(false);
  api.recallFloatingPanels();
  assert.equal(score.root.isEnabled(), false, 'Recall does not reveal hidden panels');
  assert.equal(score.panel.userPlaced, false);
  assert.ok(Vector3.Distance(score.root.position, camera.globalPosition) < 2, 'Recall brings a lost panel beside the viewer');
  score.root.setEnabled(true);
  camera.position.setAll(0);
  score.panel.placeForViewer(placement);
  score.panel.begin('left', Matrix.Identity());
  const beforeLostRelease = score.root.position.clone();
  camera.rotation.y = Math.PI;
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(score.root.position.equals(beforeLostRelease), 'Turning does not move a held panel');
  score.panel.end('left');
  assert.ok(score.root.position.equals(beforeLostRelease), 'Recovery does not snap on release');
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(Vector3.Distance(score.root.position, beforeLostRelease) < 1e-6,
    'Release after turning keeps placed direction instead of chasing gaze');
  score.root.setEnabled(false);
  const sliderContext = vm.createContext({
    scene, Vector3, Color3, MeshBuilder, StandardMaterial,
    drawPanelButton() {},
    DynamicTexture: class { update() {} dispose() {} },
    document: { createElement: () => ({
      getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
    }) },
  });
  const sliderSource = readFileSync(new URL('../src/menu/panelTransparencySlider.ts', import.meta.url), 'utf8');
  vm.runInContext(`${stripTypeScriptTypes(sliderSource, { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.Slider = PanelTransparencySlider;`, sliderContext);
  const sliderRoot = new TransformNode('sliderPanel', scene);
  sliderRoot.position.z = 1;
  let opacity = -1;
  const slider = new sliderContext.Slider(sliderRoot, 'slider', 0.4, 0, 0.04, 0.08, value => { opacity = value; });
  const sliderPanel = new api.FloatingPanel(sliderRoot, new Set([slider.mesh]), sliderRoot,
    new Vector3(0.45, 0.3, 0.03), undefined, undefined, slider);
  assert.equal(opacity, 0.65, 'Start at existing 35% transparency');
  const sliderPoint = slider.mesh.getAbsolutePosition().clone();
  assert.ok(api.beginFloatingPanelGrab('left', Matrix.Identity(), null, sliderPoint), 'Near pinch targets slider');
  assert.equal(opacity, 0.65, 'Grabbing header handle does not jump transparency');
  const panelPose = sliderRoot.position.clone();
  api.updateFloatingPanelGrab('left', Matrix.Translation(0, 1, 0));
  assert.equal(opacity, 0, 'Upward drag reaches 100% transparency');
  api.updateFloatingPanelGrab('left', Matrix.Translation(0, -1, 0));
  assert.equal(opacity, 1, 'Downward drag reaches 0% transparency');
  assert.ok(sliderRoot.position.equals(panelPose), 'Slider gesture never moves panel');
  api.endFloatingPanelGrab('left');
  assert.equal(sliderPanel.grabbed(), false);
  const beforeGrip = sliderRoot.position.clone();
  const beforeGripOpacity = opacity;
  assert.ok(api.beginFloatingPanelGrab('left', Matrix.Identity(), slider.mesh, sliderPoint, 0.03, true),
    'Controller grip always grabs the panel, even over the transparency control');
  api.updateFloatingPanelGrab('left', Matrix.Translation(0.1, 0.2, 0));
  assert.ok(Vector3.Distance(sliderRoot.position, beforeGrip.add(new Vector3(0.1, 0.2, 0))) < 1e-6,
    'Grip moves the complete panel');
  assert.equal(opacity, beforeGripOpacity, 'Grip does not change transparency');
  api.endFloatingPanelGrab('left');
  sliderRoot.position.copyFrom(beforeGrip);
  slider.setTransparency(35);
  const sliderRay = new Ray(new Vector3(0.4, 0, 0), Vector3.Forward(), 3);
  assert.ok(api.beginFloatingPanelPointerDrag(sliderRay), 'Mouse can start slider drag');
  api.updateFloatingPanelPointerDrag(new Ray(new Vector3(0.4, 0.18, 0), Vector3.Forward(), 3));
  assert.ok(opacity < 1e-6, 'Mouse reaches clear endpoint');
  assert.ok(sliderRoot.position.equals(panelPose), 'Mouse slider does not move panel');
  api.endFloatingPanelGrab('pointer');
  sliderPanel.placeForViewer({
    desktop: { distance: 1, height: 0 }, xr: { distance: 1, height: 0 }, side: 0.6,
  });
  const beforeSliderTurn = sliderRoot.position.clone();
  const contact = slider.mesh.getAbsolutePosition().clone();
  api.beginFloatingPanelGrab('right', Matrix.Identity(), slider.mesh, contact);
  camera.rotation.y += Math.PI;
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(sliderRoot.position.equals(beforeSliderTurn), 'Slider contact suspends follow');
  api.endFloatingPanelGrab('right');
  scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  assert.ok(Vector3.Distance(sliderRoot.position, beforeSliderTurn) < 1e-6,
    'Turning during transparency adjustment keeps the panel in its placed direction');
  sliderRoot.setEnabled(false);
  assert.equal(api.beginFloatingPanelPointerDrag(sliderRay), false, 'Hidden slider cannot be dragged');
  score.root.setEnabled(true);
  score.root.position.set(0, 0, 2);
  score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
  score.mesh.computeWorldMatrix(true);
  const remotePoint = score.mesh.getAbsolutePosition().clone();
  const handWorld = Matrix.Translation(0.2, -0.1, 0.4);
  const beforeRayGrab = score.root.position.clone();
  api.beginFloatingPanelGrab('left', handWorld, score.mesh, remotePoint);
  score.mesh.computeWorldMatrix(true);
  assert.ok(score.root.position.equals(beforeRayGrab), 'Ray grabbing does not summon or jump panel');
  assert.ok(score.panel.grabbed('left'), 'Ray selection starts a remote grab');
  const summonedPosition = score.root.position.clone();
  api.updateFloatingPanelGrab('left', Matrix.Translation(0.3, 0, 0.4));
  assert.ok(Vector3.Distance(score.root.position, summonedPosition.add(new Vector3(0.1, 0.1, 0))) < 1e-6,
    'Summoned panel follows hand immediately');
  api.endFloatingPanelGrab('left');
  score.root.setEnabled(false);
  console.log('Floating panel checks passed: picking, near contact, pose tracking, two-hand stretching, limits, release, ownership, pointer drag, viewer follow, and independent mouse/pinch transparency sliders with clamped endpoints.');
} finally {
  scene.dispose();
  engine.dispose();
}
