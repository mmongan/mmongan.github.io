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
  scene, engine, MeshBuilder, TransformNode, StandardMaterial, Color3, Matrix, Quaternion, Vector3, Plane, Ray, Observable,
  __APP_VERSION__: 'test', performance,
  document: { createElement: () => ({ getContext: () => new Proxy({}, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  attachToARTransform: node => node.setParent(stadium),
  createVideoField: () => ({ mesh: MeshBuilder.CreateGround('videoField', {}, scene), updateFieldLevel() {} }),
  createTopDownFieldTexture: () => null, createVideoBoardSettings() {},
  MIN_MARCH_TEMPO_BPM: 40, MAX_MARCH_TEMPO_BPM: 240,
  getMarchTempo: () => tempo, setMarchTempo: value => { tempo = value; },
  cycleMarchingGait: direction => gaitChanges.push(direction), getMarchingGaitLabel: () => 'March',
  getInstrumentCarryPose: () => false, toggleInstrumentCarryPose: () => { hornChanges++; },
});
try {
  for (const file of ['interaction/editingMode', 'menu/handMenu', 'menu/floatingPanel', 'field/scoreboard']) {
    vm.runInContext(load(read(`../src/${file}.ts`)), context);
  }
  const board = read('../src/field/videoBoard.ts');
  vm.runInContext(load(board.slice(board.indexOf('function roundedRect('),
    board.indexOf('export interface VideoBoardResult'))), context);
  context.formatBuildStamp = () => 'test';
  vm.runInContext(load(board.slice(board.indexOf('export function createVideoBoard('))), context);
  const video = context.createVideoBoard();
  context.createScoreboard();
  const mediaPanel = scene.getMeshByName('videoBoardButtonPanel');
  const pointerTarget = mediaPanel.computeWorldMatrix(true).getTranslation().add(new Vector3(0, 2, -.15));
  const pointerOrigin = new Vector3(0, pointerTarget.y, 0);
  assert.ok(context.beginFloatingPanelPointerDrag(new Ray(pointerOrigin, Vector3.Forward(), 100)));
  context.updateFloatingPanelPointerDrag(new Ray(pointerOrigin.add(new Vector3(2, 0, 0)), Vector3.Forward(), 100));
  context.endFloatingPanelGrab('pointer');
  assert.ok(Math.abs(mediaPanel.position.x - 2) < 1e-5, 'Desktop dragging works at stadium distance, beyond six meters');
  mediaPanel.setParent(scene.getTransformNodeByName('videoBoardRoot'));
  stadium.position.set(1, .8, -2); stadium.rotation.y = .7; stadium.scaling.setAll(.02);
  const cases = [
    ['videoBoardFrame', 'videoBoardScreen'],
    ['videoBoardButtonPanel', 'videoBoardButton-playPause'],
    ['scoreboardFrame', 'scoreboardScreen'],
  ];
  for (const [name, faceName] of cases) {
    const panel = scene.getMeshByName(name), face = scene.getMeshByName(faceName);
    assert.ok(context.isFloatingPanelMesh(panel) && context.isFloatingPanelMesh(face), `${name} and its face are grabbable`);
    const before = panel.computeWorldMatrix(true).clone();
    const faceBefore = face.computeWorldMatrix(true).getTranslation();
    assert.ok(context.beginFloatingPanelGrab('left', Matrix.Identity(), face, undefined, .03, true));
    assert.equal(panel.parent, null);
    assert.ok(panel.computeWorldMatrix(true).equalsWithEpsilon(before, 1e-5), 'No pickup jump or scale change');
    const delta = new Vector3(.2, .1, -.3);
    context.updateFloatingPanelGrab('left', Matrix.Translation(delta.x, delta.y, delta.z));
    context.endFloatingPanelGrab('left');
    assert.ok(face.computeWorldMatrix(true).getTranslation().equalsWithEpsilon(faceBefore.add(delta), 1e-5),
      'All child faces follow the complete panel');
    const released = panel.computeWorldMatrix(true).clone();
    stadium.position.x += 1; video.setScreenSize(.5);
    assert.ok(panel.computeWorldMatrix(true).equalsWithEpsilon(released, 1e-5), 'Released panels stay world-fixed');
    assert.ok(context.beginFloatingPanelGrab('right', Matrix.Identity(), panel));
    context.endFloatingPanelGrab('right');
  }
  const media = scene.getMeshByName('videoBoardButton-playPause');
  assert.equal(context.getFloatingPanelButtonNearPoint(media.computeWorldMatrix(true).getTranslation()).action, 'playPause',
    'Near hand button actions are not converted into grabs');
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
  console.log('Stadium panel grabs passed: live screen, media panel, scoreboard, scaled/rotated parents, no pickup jumps, independent release, regrabbing, hand actions and transformed tempo/gait/horn controls.');
} finally {
  scene.dispose(); engine.dispose();
}
