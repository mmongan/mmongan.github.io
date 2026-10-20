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
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const load = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine(), scene = new Scene(engine);
const stadium = new TransformNode('stadium', scene);
let tempo = 120, gaitChanges = [], hornChanges = 0;
const context = vm.createContext({
  scene, engine, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3, Matrix, Quaternion, Vector3, Plane, Ray, Observable,
  __APP_VERSION__: 'test', performance,
  document: { createElement: () => ({ getContext: () => new Proxy({}, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  attachToARTransform: node => node.setParent(stadium),
  createVideoField: () => ({ mesh: MeshBuilder.CreateGround('videoField', {}, scene), updateFieldLevel() {} }),
  createTopDownFieldTexture: () => null,
  MIN_MARCH_TEMPO_BPM: 40, MAX_MARCH_TEMPO_BPM: 240,
  getMarchTempo: () => tempo, setMarchTempo: value => { tempo = value; },
  cycleMarchingGait: direction => gaitChanges.push(direction), getMarchingGaitLabel: () => 'March',
  getInstrumentCarryPose: () => false, toggleInstrumentCarryPose: () => { hornChanges++; },
});
try {
  for (const file of ['interaction/editingMode', 'menu/handMenu', 'menu/settingsButtonIcons', 'menu/floatingPanel', 'field/scoreboard']) {
    vm.runInContext(load(read(`../src/${file}.ts`)), context);
  }
  const board = read('../src/field/videoBoard.ts');
  vm.runInContext(load(board.slice(board.indexOf('function roundedRect('),
    board.indexOf('export interface VideoBoardResult'))), context);
  context.formatBuildStamp = () => 'test';
  vm.runInContext(load(board.slice(board.indexOf('export function createVideoBoard('))), context);
  const video = context.createVideoBoard();
  assert.equal(scene.meshes.some(mesh => mesh.name.startsWith('videoBoardSettings')), false,
    'The video board has no side-mounted tool/settings banks');
  context.createScoreboard();
  const mounts = new Map();
  for (const name of ['videoBoardFrame', 'videoBoardButtonPanel', 'scoreboardFrame']) {
    const panel = scene.getMeshByName(name);
    mounts.set(panel, { parent: panel.parent, pose: Matrix.Compose(panel.scaling,
      panel.rotationQuaternion, panel.position) });
  }
  const mediaPanel = scene.getMeshByName('videoBoardButtonPanel');
  const pointerTarget = mediaPanel.computeWorldMatrix(true).getTranslation().add(new Vector3(0, 2, -.15));
  const pointerOrigin = new Vector3(0, pointerTarget.y, 0);
  assert.equal(context.beginFloatingPanelPointerDrag(new Ray(pointerOrigin, Vector3.Forward(), 100)), false);
  context.updateFloatingPanelPointerDrag(new Ray(pointerOrigin.add(new Vector3(2, 0, 0)), Vector3.Forward(), 100));
  context.endFloatingPanelGrab('pointer');
  assert.ok(Math.abs(mediaPanel.position.x) < 1e-5, 'Desktop dragging cannot move mounted media controls');
  assert.equal(context.nudgeFloatingPanelDistance(new Ray(pointerOrigin, Vector3.Forward(), 100), 100), false);
  stadium.position.set(1, .8, -2); stadium.rotation.y = .7; stadium.scaling.setAll(.02);
  const cases = [
    ['videoBoardFrame', 'videoBoardScreen'],
    ['videoBoardButtonPanel', 'videoBoardButton-playPause'],
    ['scoreboardFrame', 'scoreboardScreen'],
  ];
  for (const [name, faceName] of cases) {
    const panel = scene.getMeshByName(name), face = scene.getMeshByName(faceName);
    assert.equal(context.isFloatingPanelMesh(panel), false, `${name} is not grabbable`);
    assert.equal(context.isFloatingPanelMesh(face), false, `${faceName} is not grabbable`);
    const parent = panel.parent;
    const before = panel.computeWorldMatrix(true).clone();
    const faceBefore = face.computeWorldMatrix(true).getTranslation();
    assert.equal(context.beginFloatingPanelGrab('left', Matrix.Identity(), face, undefined, .03, true), false);
    assert.equal(context.beginFloatingPanelGrab('hand-left', Matrix.Identity(), undefined,
      panel.computeWorldMatrix(true).getTranslation(), .03, true), false, 'Near-hand pinches cannot detach mounted boards');
    assert.equal(panel.parent, parent);
    assert.ok(panel.computeWorldMatrix(true).equalsWithEpsilon(before, 1e-5), 'Grab attempts preserve world pose and scale');
    const delta = new Vector3(.2, .1, -.3);
    context.updateFloatingPanelGrab('left', Matrix.Translation(delta.x, delta.y, delta.z));
    context.endFloatingPanelGrab('left');
    assert.ok(face.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(faceBefore, 1e-5),
      'Controller motion cannot move mounted faces');
    stadium.position.x += 1;
    assert.ok(face.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(faceBefore.add(new Vector3(1, 0, 0)), 1e-5),
      'Mounted boards follow field translation');
    const localPose = Matrix.Compose(panel.scaling, panel.rotationQuaternion, panel.position);
    stadium.rotation.y += .3;
    stadium.scaling.scaleInPlace(1.5);
    assert.ok(panel.computeWorldMatrix(true).equalsWithEpsilon(
      localPose.multiply(parent.computeWorldMatrix(true)), 1e-5), 'Mounted boards inherit field rotation and scale');
    assert.equal(context.beginFloatingPanelGrab('right', Matrix.Identity(), panel), false);
    context.endFloatingPanelGrab('right');
    assert.equal(scene.getMeshByName(`${name}-close`), null, 'Mounted boards have no close/resize chrome');
  }
  const media = scene.getMeshByName('videoBoardButton-playPause');
  assert.equal(context.getFloatingPanelButtonNearPoint(media.computeWorldMatrix(true).getTranslation()).action, 'playPause',
    'Near hand button actions are not converted into grabs');
  video.setScreenSize(.5);
  video.setScreenSize(1);
  context.recallFloatingPanels();
  for (const [panel, mount] of mounts) {
    assert.equal(panel.parent, mount.parent, 'Reset reattaches stadium signs/displays to their original mount');
    assert.ok(Matrix.Compose(panel.scaling, panel.rotationQuaternion, panel.position)
      .equalsWithEpsilon(mount.pose, 1e-5), 'Reset restores original local position, rotation, and scale');
    assert.equal(context.isFloatingPanelGrabbed('right'), false);
  }
  const mountedMedia = media.computeWorldMatrix(true).getTranslation();
  stadium.position.x += .7;
  assert.ok(media.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(
    mountedMedia.add(new Vector3(.7, 0, 0)), 1e-5), 'Reset signs follow subsequent stadium movement');
  const screen = scene.getMeshByName('scoreboardScreen');
  const pickAt = (x, y) => ({ pickedMesh: screen,
    pickedPoint: Vector3.TransformCoordinates(new Vector3(-x, y - 12, 0), screen.computeWorldMatrix(true)) });
  for (const rotation of [0, .9]) {
    screen.parent.rotationQuaternion = Quaternion.FromEulerAngles(.3, rotation, .1);
    assert.ok(context.updateScoreboardTempoFromPick(pickAt(4, 8.38))); assert.ok(Math.abs(tempo - 40) < .001);
    assert.ok(context.updateScoreboardTempoFromPick(pickAt(-4, 8.38))); assert.ok(Math.abs(tempo - 240) < .001);
    assert.ok(context.updateScoreboardGaitFromPick(pickAt(1, 10)));
    assert.ok(context.updateScoreboardHornPoseFromPick(pickAt(0, 9.34)));
    assert.equal(context.updateScoreboardTempoFromPick(pickAt(0, 12)), false);
  }
  assert.deepEqual(gaitChanges, [-1, -1]); assert.equal(hornChanges, 2);
  const frame = screen.parent;
  frame.setEnabled(false);
  assert.equal(context.beginFloatingPanelGrab('left', Matrix.Identity(), screen), false);
  frame.dispose();
  assert.equal(context.isFloatingPanelMesh(screen), false);
  assert.equal(context.isScoreboardTempoScreen(screen), false, 'Disposal unregisters scoreboard controls');
  console.log('Stadium panel locks passed: live screen, media panel, scoreboard, controller/hand/mouse rejection, inherited field transforms, hand actions and transformed tempo/gait/horn controls.');
} finally {
  scene.dispose(); engine.dispose();
}
