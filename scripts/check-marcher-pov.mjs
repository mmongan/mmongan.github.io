import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const near = (a, b, message) => assert.ok(Vector3.Distance(a, b) < 1e-6, message);
const engine = new NullEngine();
const scene = new Scene(engine);
try {
  const context = vm.createContext({ Vector3, Quaternion });
  vm.runInContext(`${compile(read('../src/camera/marcherPOVCamera.ts'))}
globalThis.Follower = MarcherPOVCamera;`, context);
  const parent = new TransformNode('field', scene);
  parent.position.set(4, -0.48, -5);
  parent.scaling.setAll(0.9144);
  parent.rotation.y = 0.4;
  const robot = new TransformNode('marcher', scene);
  robot.parent = parent;
  robot.position.set(2, 0, 3);
  const body = new TransformNode('body', scene);
  body.parent = robot;
  const height = (1.8 / 0.9144) / 1.372;
  body.scaling.set(height * 0.64, height, height * 0.64);
  const mesh = new Mesh('bodyMesh', scene);
  mesh.parent = body;
  const marker = new Mesh('videoBoardDot', scene);
  marker.parent = robot;
  marker.layerMask = 0x10000000;
  const second = new TransformNode('secondMarcher', scene);
  second.parent = parent;
  const secondBody = new TransformNode('secondBody', scene);
  secondBody.parent = second;
  secondBody.scaling.copyFrom(body.scaling);
  const parts = new Map([[robot, { body }], [second, { body: secondBody }]]);
  const eyeSource = read('../src/robot/robot.ts').match(/export function getMarcherEyePose[\s\S]*?\n}/)[0];
  const eyeContext = vm.createContext({ marcherParts: parts, Vector3,
    MARCHER_BODY_SCALE: height, MARCHER_BUILD_SCALE: 0.64 });
  vm.runInContext(`${compile(eyeSource)};globalThis.eyePose = getMarcherEyePose;`, eyeContext);
  const eyePose = eyeContext.eyePose;
  const eye = eyePose(robot);
  near(eye.position, Vector3.TransformCoordinates(new Vector3(0, 1.283, 0.154), body.computeWorldMatrix(true)),
    'Eye anchor uses actual body and scaled/rotated field world matrix');
  assert.ok(Math.abs(eye.position.y - (parent.position.y + 1.8 * 1.283 / 1.372)) < 1e-6);
  for (const offset of [0, -0.05, -0.15, -0.05, 0]) {
    body.position.y = offset;
    near(eyePose(robot).position, eye.position, 'POV ignores animated body height and never bounces');
  }
  const camera = new UniversalCamera('viewer', new Vector3(-28.5, 21.52, 0), scene);
  camera.rotation.set(0.7, 1.2, 0);
  const originalPosition = camera.position.clone();
  const originalRotation = camera.rotation.clone();
  const originalMask = mesh.layerMask;
  const follower = new context.Follower(eyePose);
  assert.equal(follower.start(robot, camera, false), true);
  near(camera.position, eye.position, 'Start at actual eyes');
  assert.equal(mesh.layerMask, 0x20000000, 'Hide own body from main camera');
  assert.equal(marker.layerMask, 0x10000000, 'Keep video-board dot visible');
  camera.rotation.x = 0.23;
  camera.rotation.y += 0.3;
  const lookOffset = camera.rotation.y - eye.yaw;
  robot.rotation.y = 0.8;
  robot.position.x += 3;
  follower.update(robot);
  near(camera.position, eyePose(robot).position, 'Follow playback/seek position');
  assert.ok(Math.abs(camera.rotation.y - eyePose(robot).yaw - lookOffset) < 1e-6, 'Keep look offset while marcher turns');
  assert.equal(camera.rotation.x, 0.23);
  follower.update(robot);
  near(camera.position, eyePose(robot).position, 'Paused pose does not drift');
  robot.position.x -= 6;
  follower.update(robot);
  near(camera.position, eyePose(robot).position, 'Follow reverse/seek discontinuity');
  follower.update(second);
  assert.equal(mesh.layerMask, originalMask, 'Selection change restores previous marcher');
  near(camera.position, eyePose(second).position, 'Follow new selection');
  follower.stop();
  near(camera.position, originalPosition, 'Restore spectator position');
  near(camera.rotation, originalRotation, 'Restore spectator look');

  camera.position.set(10, 1.7, 20);
  camera.rotationQuaternion = Quaternion.FromEulerAngles(0.2, 0.5, 0.1);
  const vrOrigin = camera.position.clone();
  const headsetLook = camera.rotationQuaternion.clone();
  follower.start(robot, camera, true);
  const initialEye = eyePose(robot).position;
  const physicalMotion = new Vector3(0.15, -0.2, 0.25);
  camera.position.addInPlace(physicalMotion);
  robot.position.x += 4;
  robot.rotation.y += 1;
  follower.update(robot);
  near(camera.position, eyePose(robot).position.add(physicalMotion), 'Keep physical head translation while following');
  assert.ok(camera.rotationQuaternion.equals(headsetLook), 'Never force headset turn or pitch');
  follower.update(robot);
  near(camera.position, eyePose(robot).position.add(physicalMotion), 'No XR cumulative drift');
  follower.stop();
  near(camera.position, vrOrigin.add(physicalMotion), 'Restore XR navigation while preserving physical motion');
  assert.ok(camera.rotationQuaternion.equals(headsetLook));
  follower.start(robot, camera, false);
  robot.dispose();
  assert.equal(follower.update(robot), false, 'Disposed marcher signals exit');
  follower.stop();
  assert.equal(follower.active, false);

  const interaction = read('../src/interaction/pathInteraction.ts').replace(/\r\n/g, '\n');
  const triggerStart = interaction.indexOf('      const pickedRobot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;');
  const triggerEnd = interaction.indexOf('\n    }\n\n    if (isPressed && wasPressed)', triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
  const povSource = read('../src/camera/marcherPOV.ts').replace(/\r\n/g, '\n');
  const followerUpdate = povSource.match(/function updateFollower\(\)[\s\S]*?\n}/)[0];
  let triggerSelection = second;
  let pickedRobot = null;
  let routed = false;
  const triggerContext = vm.createContext({
    follower, scene, TargetCamera,
    pick: null,
    findRobotRoot: () => pickedRobot, selectDrawingGuideFromRay: () => false, getControllerRay: () => null, controller: {},
    getRobotCounts: () => routed ? [{}, {}] : null,
    selectRobot: value => { triggerSelection = value; },
    getSelected: () => triggerSelection,
    isMarcherPOVActive: () => follower.active,
    availableVR: () => true,
    setMarcherPOVEnabled: enabled => { assert.equal(enabled, false); follower.stop(); },
  });
  vm.runInContext(compile(`function triggerClick() {
${interaction.slice(triggerStart, triggerEnd)}
}
${followerUpdate}`), triggerContext);
  for (const xr of [false, true]) {
    triggerSelection = second;
    camera.position.copyFrom(originalPosition);
    scene.activeCamera = camera;
    follower.start(second, camera, xr);
    const beforeClick = camera.position.clone();
    for (const pick of [null, { hit: false }, { hit: true, pickedMesh: {} }]) {
      triggerContext.pick = pick;
      pickedRobot = null;
      triggerContext.triggerClick();
      triggerContext.updateFollower();
      assert.ok(triggerSelection === second, 'Empty trigger click preserves the POV marcher');
      assert.equal(follower.active, true, 'Empty trigger click must not exit POV');
      near(camera.position, beforeClick, 'Empty trigger click never restores the sideline camera');
    }
    for (routed of [false, true]) {
      triggerContext.pick = { hit: true, pickedMesh: {} };
      pickedRobot = second;
      triggerContext.triggerClick();
      assert.ok(triggerSelection === second, 'Trigger still selects standing and routed marchers');
    }
    follower.stop();
    triggerContext.pick = null;
    pickedRobot = null;
    triggerContext.triggerClick();
    assert.equal(triggerSelection, null, 'Empty trigger click still deselects outside POV');
  }

  // Exercise the real chart renderer with a recording 2D context.
  let selected = second;
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, method) => (...args) => calls.push({ method, args }),
    set: () => true,
  });
  const chartContext = vm.createContext({
    Vector3, scene: { onBeforeRenderObservable: { add() {} } },
    PANEL_PAPER_COLOR: '#fffdf7',
    FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, END_ZONE_DEPTH_YARDS: 10,
    HASH_OFFSETS_YARDS: { highSchool: 17.777 }, getSelectedFieldLevel: () => 'highSchool',
    getDrillLastCountIndex: () => 8, getGlobalCountIndex: () => 3,
    isAuthoredChartPage: () => true, getChartPageTimeline: () => ({ authoredCounts: [0, 8] }),
    getChartTransition: () => ({ shape: 'straight', pace: 'linear', styleIndex: 0 }),
    getChartTransitionLabels: () => ({ shape: 'Straight', pace: 'Linear', style: 'March' }),
    getRobotPositionsAtCount: count => [new Vector3(count, 0, 2), new Vector3(10, 0, 3)],
    getRobotPositionAtCount: (robot, count) => new Vector3(count, 0, 2),
    getMarcherPOVRobot: () => selected, getMarcherPOVLabel: () => 'Marcher 2',
  });
  vm.runInContext(`${compile(read('../src/menu/drillChartPad.ts'))}
globalThis.drawPage = drawPage;globalThis.signature = getPageSignature;`, chartContext);
  const target = { ctx, texture: { update() {} } };
  chartContext.drawPage(target, [0, 8], 1);
  assert.ok(!calls.some(c => c.method === 'fillText' && /\bME\b/.test(c.args[0])), 'Highlight has no ME label');
  assert.ok(calls.some(c => c.method === 'arc' && c.args[2] === 9), 'Chart draws live highlighted dot');
  assert.ok(calls.some(c => c.method === 'arc' && c.args[2] === 11), 'Chart draws target-set ring');
  const signature = chartContext.signature([0, 8], 1);
  second.position.x += 0.05;
  assert.notEqual(chartContext.signature([0, 8], 1), signature, 'Live movement invalidates chart even between counts');
  const movedSignature = chartContext.signature([0, 8], 1);
  selected = null;
  assert.notEqual(chartContext.signature([0, 8], 1), movedSignature, 'Leaving POV invalidates chart');
  calls.length = 0;
  chartContext.drawPage(target, [0, 8], 1);
  assert.ok(!calls.some(c => c.method === 'fillText' && c.args[0] === 'ME'), 'No POV highlight when off');
  console.log('Marcher POV checks passed: transformed eye anchor, follow/seek/pause/reverse, look, restoration, selection/disposal, natural VR head motion, own-body hiding, and live chart highlight.');
} finally {
  scene.dispose();
  engine.dispose();
}
