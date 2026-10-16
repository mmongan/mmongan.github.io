import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { WebXRHandJoint as J } from '@babylonjs/core/XR/features/WebXRHandTracking.js';

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  const camera = new UniversalCamera('viewer', new Vector3(0, 1.7, 0), scene);
  scene.activeCamera = camera;
  const context = vm.createContext({
    scene, Vector3, Color3, MeshBuilder, TransformNode, StandardMaterial, WebXRHandJoint: J,
  });
  const source = readFileSync(new URL('../src/interaction/handJoystick.ts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '') +
    '\nglobalThis.Joystick = HandJoystick;', context);
  const fingers = [
    [J.INDEX_FINGER_TIP, J.INDEX_FINGER_PHALANX_PROXIMAL],
    [J.MIDDLE_FINGER_TIP, J.MIDDLE_FINGER_PHALANX_PROXIMAL],
    [J.RING_FINGER_TIP, J.RING_FINGER_PHALANX_PROXIMAL],
    [J.PINKY_FINGER_TIP, J.PINKY_FINGER_PHALANX_PROXIMAL],
  ];
  const joints = new Map([[J.WRIST, new Vector3(0, 1, 0)],
    [J.THUMB_METACARPAL, new Vector3(0, 1.02, 0)],
    [J.THUMB_TIP, new Vector3(0, 1.13, 0)]]);
  for (const [tip, knuckle] of fingers) {
    joints.set(tip, new Vector3(0, 1.04, 0));
    joints.set(knuckle, new Vector3(0, 1.08, 0));
  }
  const joint = name => joints.get(name);
  assert.equal(context.isThumbsUp(joint), true);
  joints.set(J.INDEX_FINGER_TIP, new Vector3(0, 1.18, 0));
  assert.equal(context.isThumbsUp(joint), false, 'Open fingers do not activate locomotion');
  joints.set(J.INDEX_FINGER_TIP, new Vector3(0, 1.04, 0));
  const center = joints.get(J.THUMB_TIP);
  let point = center.clone();
  let pinching = false;
  let otherPresent = true;
  const owner = { getJointMesh: name => ({ getAbsolutePosition: () => joint(name) }) };
  const operator = { getJointMesh: name => ({
    getAbsolutePosition: () => point.add(new Vector3(name === J.THUMB_TIP ? -0.005 : 0.005,
      pinching ? 0 : name === J.THUMB_TIP ? -0.05 : 0.05, 0)),
  }) };
  for (const hand of ['left', 'right']) {
    const joystick = new context.Joystick();
    const tracking = { getHandByHandedness: side => side === hand ? owner : otherPresent ? operator : null };
    let activations = 0;
    const update = (time, allowed = true, seconds = 0.02) =>
      joystick.update(tracking, allowed, time, seconds, () => { activations++; });
    pinching = false;
    point = center.clone();
    camera.position.set(0, 1.7, 0);
    update(0);
    update(499);
    assert.equal(joystick.active, false);
    update(500);
    assert.equal(joystick.active, true);
    assert.equal(activations, 1);
    pinching = true;
    update(501);
    assert.equal(camera.position.z, 0, 'Grabbing handle has no initial movement');
    point.z += 0.08;
    update(521);
    assert.ok(Math.abs(camera.position.z - 0.03) < 1e-6, 'Full forward is 1.5 meters/second');
    assert.equal(camera.position.y, 1.7, 'No vertical locomotion');
    pinching = false;
    const before = camera.position.clone();
    update(541);
    assert.ok(camera.position.equals(before), 'Pinch release stops immediately');
    pinching = true;
    update(561);
    point.z += 0.08;
    update(581, true, 2);
    assert.ok(camera.position.z - before.z <= 0.075001, 'Slow frames cannot produce large jumps');
    otherPresent = false;
    const lost = camera.position.clone();
    update(600);
    assert.ok(camera.position.equals(lost), 'Lost operating hand stops movement');
    otherPresent = true;
    update(620, false);
    assert.equal(joystick.active, false, 'AR, calibration, or busy input disables joystick');
    update(700);
    update(1199);
    assert.equal(joystick.active, false, 'Reactivation requires another complete hold');
    update(1200);
    joints.get(J.THUMB_TIP).y = 1.03;
    update(1220);
    assert.equal(joystick.active, false, 'Releasing thumbs-up stops and hides joystick');
    joints.get(J.THUMB_TIP).y = 1.13;
    joystick.reset();
  }
  const velocity = context.joystickVelocity(new Vector3(0.01, 0, 0), Vector3.Forward());
  assert.equal(velocity.length(), 0, 'Center deadzone prevents drift');
  assert.ok(context.joystickVelocity(new Vector3(1, 0, 1), Vector3.Forward()).length() <= 1.500001,
    'Diagonal movement is speed limited');
  assert.ok(scene.meshes.every(mesh => !mesh.isPickable), 'Joystick cannot intercept other picks');
  const interaction = readFileSync(new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8');
  const from = interaction.indexOf('  function updateTabletopHands()');
  const to = interaction.indexOf("    if (formationPull?.originalGrab.source === 'controller'", from);
  assert.ok(from >= 0 && to > from);
  let joystickAllowed = false;
  let inPOV = true;
  let mode = 'immersive-vr';
  const inputContext = vm.createContext({
    scene: { activeCamera: {
      position: new Vector3(3, 1.7, 4), getClassName: () => 'WebXRCamera',
    }, getEngine: () => ({ getDeltaTime: () => 16 }) },
    joystick: { update: (_tracking, allowed, _now, _seconds, activate) => {
      joystickAllowed = allowed;
      if (allowed) activate();
      return allowed;
    } },
    handTracking: {}, floorCalibrationToggle: { checked: false },
    getSelectedXRMode: () => mode,
    formationPull: null, circleResize: null, fingerPath: null, marcherGrabs: new Map(),
    isFloatingPanelGrabbed: () => false, paths: { isPainting: () => false }, isEraseMode: () => false,
    performance: { now: () => 0 }, isMarcherPOVActive: () => inPOV,
    setMarcherPOVEnabled: () => {
      inPOV = false;
      inputContext.scene.activeCamera.position.set(-28, 20, 0);
    },
    handPinches: new Map(), sceneGesture: {}, joystickOwnsHands: false,
  });
  vm.runInContext(stripTypeScriptTypes(`${interaction.slice(from, to)}\n}`, { mode: 'transform' }), inputContext);
  inputContext.updateTabletopHands();
  assert.equal(joystickAllowed, true);
  assert.equal(inPOV, false, 'Joystick takes over from POV');
  assert.ok(inputContext.scene.activeCamera.position.equals(new Vector3(3, 1.7, 4)),
    'POV takeover does not snap back to the sideline');
  assert.equal(inputContext.handPinches.get('right'), true, 'Operating pinch is consumed by navigation');
  mode = 'immersive-ar';
  inputContext.updateTabletopHands();
  assert.equal(joystickAllowed, false, 'Real input dispatcher disables joystick in AR');
  mode = 'immersive-vr';
  inputContext.floorCalibrationToggle.checked = true;
  inputContext.updateTabletopHands();
  assert.equal(joystickAllowed, false, 'Real input dispatcher disables joystick during calibration');
  inputContext.floorCalibrationToggle.checked = false;
  inputContext.marcherGrabs.set('left', {});
  inputContext.updateTabletopHands();
  assert.equal(joystickAllowed, false, 'Holding a marcher prevents navigation takeover');
  console.log('Hand joystick passed: both hands, thumbs-up recognition, 500 ms hold, pinch ownership, movement speed, deadzone, release/loss, and safety gating.');
} finally {
  scene.dispose();
  engine.dispose();
}
