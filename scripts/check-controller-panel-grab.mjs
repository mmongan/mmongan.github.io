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
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const transform = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
engine.getDeltaTime = () => 100;
const scene = new Scene(engine);
const gripNode = new TransformNode('controllerGrip', scene);
let grip = false, trigger = false, stick = 0, remotePalette = false, paletteGrabs = 0;
const controller = { inputSource: { gamepad: { buttons: [{}, { get pressed() { return grip; } }] } },
  grip: gripNode };
const context = vm.createContext({
  scene, Matrix, Quaternion, Vector3, Plane, Mesh, MeshBuilder, TransformNode, StandardMaterial, Color3,
  isARTabletopModeActive: () => false,
  controller, handedness: 'left',
  registerMenuButton() {},
  gripHeld: new Map(), triggerHeld: new Map(), marcherGrabs: new Map(), padGrabButtons: new Map(),
  getTriggerPressed: () => trigger,
  getThumbstickAxes: () => ({ y: stick }),
  getControllerRay: () => new Ray(gripNode.getAbsolutePosition(), Vector3.Forward(), 20),
  getHandMenuHitNearPoint: () => null,
  pickMenuControl: () => remotePalette ? { hit: true, distance: 0.5, pickedPoint: new Vector3(0, 0, 4) } : null,
  getHandMenuHit: () => ({ action: 'createMarcher' }),
  handInteraction: {
    getFacingYaw: () => 0,
    grabPaletteMarcher: (_, hit) => {
      if (hit?.action !== 'createMarcher') return false;
      paletteGrabs++;
      return true;
    },
  },
  SCRUB_DEADZONE: 0.2,
});
try {
  vm.runInContext(transform(read('../src/menu/settingsButtonIcons.ts')), context);
  vm.runInContext(`${transform(read('../src/menu/floatingPanel.ts'))}
    globalThis.FloatingPanel = FloatingPanel;`, context);
  const source = read('../src/interaction/pathInteraction.ts');
  vm.runInContext(transform(source.slice(source.indexOf('function isGripPressed('),
    source.indexOf('// Caller guarantees pinchState'))), context);
  const start = source.indexOf('    const gripPressed = isGripPressed(controller);',
    source.indexOf('export function updateRobotPathFromControllers'));
  const end = source.indexOf('    if (handInteraction.updateControllerFormationPull(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(transform(`function frame() { ${source.slice(start, end)} }`), context);
  const handSource = read('../src/interaction/handInteraction.ts');
  const handStart = handSource.indexOf('  function updateTabletopHands() {');
  const handEnd = handSource.indexOf('    const left = pinchedPoints.get', handStart);
  assert.ok(handStart >= 0 && handEnd > handStart);
  const trackedHands = new Map();
  Object.assign(context, {
    joystick: { update: () => false },
    handTracking: { getHandByHandedness: side => trackedHands.get(side) },
    joystickOwnsHands: false, formationPull: null, circleResize: null, fingerPath: null,
    floorCalibrationToggle: { checked: false }, sceneGesture: null,
    padHands: new Set(), handPinches: new Map(),
    finishFormationPull() {}, finishCircleResize() {},
    WebXRHandJoint: { THUMB_TIP: 'thumb', INDEX_FINGER_TIP: 'index' },
    getHandGrabMatrix: hand => hand.world,
    performance,
  });
  vm.runInContext(transform(`${handSource.slice(handStart, handEnd)} }`), context);
  const root = new TransformNode('testPanel', scene);
  root.position.z = 1;
  const face = MeshBuilder.CreateBox('testPanelFace', { width: .6, height: .4, depth: .02 }, scene);
  face.parent = root;
  let sliderUpdates = 0;
  const slider = {
    mesh: face, hit: mesh => mesh === face,
    beginDrag() {}, setFromWorld() { sliderUpdates++; },
  };
  const panel = new context.FloatingPanel(root, new Set([face]), root, new Vector3(.3, .2, .01),
    new Map([[face, { action: 'playPause' }]]), undefined, slider);
  const frame = () => {
    gripNode.computeWorldMatrix(true);
    context.updateTabletopHands();
    context.frame();
  };
  const release = () => { grip = false; trigger = false; frame(); };

  grip = true;
  frame();
  assert.ok(panel.grabbed('left'), 'Raw grip ray grabs a panel without a motion-controller profile');
  assert.equal(context.padGrabButtons.get('left'), 'grip');
  assert.ok(root.position.equals(new Vector3(0, 0, 1)), 'Pickup preserves position');
  gripNode.position.set(.2, .1, .3);
  gripNode.rotation.y = .3;
  frame();
  assert.ok(root.computeWorldMatrix(true).equalsWithEpsilon(
    Matrix.Translation(0, 0, 1).multiply(gripNode.computeWorldMatrix(true)), 1e-5),
  'Panel follows controller translation and rotation');
  release();
  const released = root.computeWorldMatrix(true).clone();
  gripNode.position.x += 1;
  frame();
  assert.ok(root.computeWorldMatrix(true).equalsWithEpsilon(released, 1e-5), 'Release leaves panel placed');

  gripNode.position.set(0, 0, 1);
  gripNode.rotation.setAll(0);
  root.position.set(0, 0, 1);
  root.rotationQuaternion.copyFrom(Quaternion.Identity());
  remotePalette = true;
  grip = true;
  frame();
  assert.ok(panel.grabbed('left'), 'Near panel wins over a distant instrument tile');
  assert.equal(paletteGrabs, 0);
  release();
  remotePalette = false;

  for (const sliderDrag of [false, true]) {
    gripNode.position.setAll(0);
    root.position.set(0, 0, 1);
    assert.ok(context.beginFloatingPanelGrab('left', Matrix.Identity(), face,
      new Vector3(0, 0, 1), .03, !sliderDrag));
    context.padGrabButtons.set('left', 'trigger');
    trigger = true;
    frame();
    gripNode.position.x = 3;
    frame();
    const before = root.computeWorldMatrix(true).clone();
    const updates = sliderUpdates;
    grip = true;
    frame();
    assert.equal(context.padGrabButtons.get('left'), 'grip', 'Grip takes over an active trigger drag');
    assert.ok(root.computeWorldMatrix(true).equalsWithEpsilon(before, 1e-5),
      'Takeover preserves the same panel pose even when pointing elsewhere');
    assert.equal(sliderUpdates, updates, 'Grip takeover stops transparency adjustment');
    trigger = false;
    gripNode.position.y += .2;
    frame();
    assert.ok(root.computeWorldMatrix(true).getTranslation()
      .equalsWithEpsilon(before.getTranslation().add(new Vector3(0, .2, 0))),
      'Trigger release does not end the grip grab');
    assert.equal(sliderUpdates, updates);
    release();
    assert.equal(panel.grabbed(), false);
  }

  gripNode.position.setAll(0);
  root.position.set(0, 0, 1);
  controller.motionController = { getComponentOfType: () => ({ pressed: grip }) };
  grip = true;
  frame();
  assert.ok(panel.grabbed('left'), 'Profile squeeze can regrab a released panel');
  const beforeTelescope = root.position.z;
  stick = -1;
  frame();
  assert.ok(Math.abs(root.position.z - beforeTelescope - .4) < 1e-5,
    'Forward thumbstick applies room-scale base speed plus proportional depth speed');
  stick = 1;
  const beforePull = root.position.z;
  frame();
  assert.ok(Math.abs(root.position.z - beforePull + (1.5 + beforePull * 2.5) * .1) < 1e-5,
    'Backward thumbstick brings a held panel closer');
  stick = .1;
  const centered = root.position.clone();
  frame();
  assert.ok(root.position.equalsWithEpsilon(centered), 'Thumbstick deadzone preserves panel depth');
  release();
  assert.equal(context.padGrabButtons.has('left'), false, 'Release clears controller ownership');
  stick = 0;
  for (const side of ['left', 'right']) {
    context.handedness = side;
    gripNode.position.setAll(0);
    root.position.set(0, 0, 1);
    grip = true;
    frame();
    for (let step = 1; step <= 4; step++) {
      gripNode.position.x = step * .1;
      frame();
      assert.ok(panel.grabbed(side), 'Hand tracking without a hand must not release a controller grab');
      assert.ok(Math.abs(root.position.x - step * .1) < 1e-5,
        'Controller moves the panel over successive real-order hand/controller updates');
    }
    trackedHands.set(side, {
      getJointMesh: joint => ({ getAbsolutePosition: () =>
        new Vector3(joint === 'thumb' ? 0 : .01, 0, 0) }),
    });
    gripNode.position.y = .15;
    frame();
    assert.ok(panel.grabbed(side) && Math.abs(root.position.y - .15) < 1e-5,
      'An unowned tracked-hand pinch cannot hijack or update a controller-owned panel');
    trackedHands.clear();
    release();
    assert.equal(panel.grabbed(), false);
    root.position.y = 0;
    context.handPinches.clear();
  }
  assert.ok(context.beginFloatingPanelGrab('left', Matrix.Identity(), face, undefined, .03, true));
  context.padHands.add('left');
  context.updateTabletopHands();
  assert.equal(panel.grabbed(), false, 'Losing a tracked hand still releases its own panel grab');
  assert.equal(context.padHands.size, 0);
  for (const yaw of [0, .8, -1.4]) {
    gripNode.position.set(.2, .3, -.1);
    gripNode.rotation.y = yaw;
    const world = gripNode.computeWorldMatrix(true);
    const local = new Vector3(.4, .2, 2);
    root.position.copyFrom(Vector3.TransformCoordinates(local, world));
    const direction = Vector3.TransformNormal(Vector3.Forward(), world).normalize();
    const ray = new Ray(gripNode.position.clone(), direction, 100);
    assert.ok(context.beginFloatingPanelGrab('left', world, face, undefined, .03, true));
    const before = root.position.clone();
    const rotation = root.rotationQuaternion.clone();
    context.telescopeFloatingPanelGrab('left', 1, .1, ray);
    context.updateFloatingPanelGrab('left', world);
    assert.ok(root.position.equalsWithEpsilon(before.add(direction.scale(.65)), 1e-5),
      'Depth movement follows the controller ray, retaining lateral offset at any wrist yaw');
    assert.ok(root.rotationQuaternion.equalsWithEpsilon(rotation, 1e-5), 'Depth adjustment retains panel rotation');
    for (let step = 0; step < 100; step++) {
      context.telescopeFloatingPanelGrab('left', -1, .1, ray);
      context.updateFloatingPanelGrab('left', world);
    }
    const close = Vector3.TransformCoordinates(root.position, world.clone().invert());
    assert.ok(close.equalsWithEpsilon(new Vector3(.4, .2, 0), 1e-5),
      'Retraction stops at the controller plane without losing lateral offset');
    for (let step = 0; step < 100; step++) {
      context.telescopeFloatingPanelGrab('left', 1, .1, ray);
      context.updateFloatingPanelGrab('left', world);
    }
    const far = Vector3.TransformCoordinates(root.position, world.clone().invert());
    assert.ok(far.equalsWithEpsilon(new Vector3(.4, .2, 100), 1e-4),
      'Telescoping reaches and clamps at 100 meters');
    context.endFloatingPanelGrab('left');
  }
  console.log('Controller panel grab checks passed: raw/profile grips, near/ray pickup, pose tracking, release, contact priority, trigger/slider takeover, thumbstick depth, and hand/controller ownership across frames.');
} finally {
  scene.dispose();
  engine.dispose();
}
