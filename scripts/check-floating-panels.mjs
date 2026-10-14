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
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

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
  score.panel.captureViewerOffset();
  const startFollow = score.root.position.clone();
  camera.position.x = 1;
  score.panel.followViewer(1 / 60);
  assert.ok(score.root.position.x > startFollow.x && score.root.position.x < startFollow.x + 1,
    'Follow moves partway toward viewer instead of snapping');
  for (let frame = 0; frame < 120; frame++) score.panel.followViewer(1 / 60);
  assert.ok(Vector3.Distance(score.root.position, startFollow.add(new Vector3(1, 0, 0))) < 0.001);
  const compareFrames = fps => {
    camera.position.setAll(0);
    score.root.position.copyFrom(startFollow);
    score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
    score.panel.captureViewerOffset();
    camera.position.x = 1;
    for (let frame = 0; frame < fps; frame++) score.panel.followViewer(1 / fps);
    return score.root.position.clone();
  };
  assert.ok(Vector3.Distance(compareFrames(30), compareFrames(90)) < 1e-6, 'Lag is frame-rate independent');
  const poseBeforeTurn = score.root.position.clone();
  camera.rotation.y = Math.PI / 2;
  camera.rotation.x = 0.4;
  score.panel.followViewer(1 / 60);
  assert.ok(Vector3.Distance(score.root.position, poseBeforeTurn) > 0.001, 'Panel follows viewer yaw/pitch');
  score.panel.begin('left', Matrix.Identity());
  const heldPose = score.root.position.clone();
  camera.position.x = 4;
  score.panel.followViewer(1);
  assert.ok(score.root.position.equals(heldPose), 'Follow is suspended during grabs');
  score.panel.end('left');
  score.panel.followViewer(1 / 60);
  assert.ok(Vector3.Distance(score.root.position, heldPose) < 1e-6, 'Release captures placement without snapping');
  camera.position.x = 5;
  score.panel.followViewer(1);
  assert.ok(score.root.position.x > heldPose.x + 0.9, 'Released pad resumes following from chosen offset');
  score.root.setEnabled(false);
  const hiddenPose = score.root.position.clone();
  camera.position.x = 10;
  score.panel.followViewer(1);
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
  const beforeLostRelease = score.root.position.clone();
  camera.rotation.y = Math.PI;
  score.panel.followViewer(1);
  assert.ok(score.root.position.equals(beforeLostRelease), 'Turning does not move a held panel');
  score.panel.end('left');
  assert.ok(score.root.position.equals(beforeLostRelease), 'Recovery does not snap on release');
  for (let i = 0; i < 120; i++) score.panel.followViewer(1 / 60);
  const recoveredLocal = Vector3.TransformCoordinates(score.root.position, camera.getViewMatrix(true));
  assert.ok(recoveredLocal.z > 0.7 && recoveredLocal.x < -0.3,
    'Released panel finds viewer again on original left side after a 180-degree turn');
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
  sliderPanel.followViewer(1);
  assert.ok(sliderRoot.position.equals(beforeSliderTurn), 'Slider contact suspends follow');
  api.endFloatingPanelGrab('right');
  for (let i = 0; i < 120; i++) sliderPanel.followViewer(1 / 60);
  const sliderRecovered = Vector3.TransformCoordinates(sliderRoot.position, camera.getViewMatrix(true));
  assert.ok(sliderRecovered.z > 0.99 && sliderRecovered.x > 0.59,
    'After turning during slider interaction the panel recovers to the right, not behind viewer');
  sliderRoot.setEnabled(false);
  assert.equal(api.beginFloatingPanelPointerDrag(sliderRay), false, 'Hidden slider cannot be dragged');
  score.root.setEnabled(true);
  score.root.position.set(0, 0, 2);
  score.root.rotationQuaternion.copyFrom(Quaternion.Identity());
  score.mesh.computeWorldMatrix(true);
  const remotePoint = score.mesh.getAbsolutePosition().clone();
  const handWorld = Matrix.Translation(0.2, -0.1, 0.4);
  api.beginFloatingPanelGrab('left', handWorld, score.mesh, remotePoint, 0.03, true);
  score.mesh.computeWorldMatrix(true);
  assert.ok(Vector3.Distance(score.mesh.getAbsolutePosition(), handWorld.getTranslation()) < 1e-6,
    'Ray selection summons picked location directly to hand');
  assert.ok(score.panel.grabbed('left'), 'Summoned panel starts a hand grab');
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
