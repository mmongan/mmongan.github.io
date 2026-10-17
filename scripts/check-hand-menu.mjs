import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Axis } from '@babylonjs/core/Maths/math.axis.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { WebXRHandJoint } from '@babylonjs/core/XR/features/WebXRHandTracking.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const load = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
let now = 0;
let summons = 0;
let draftingSummons = 0;
const context = vm.createContext({
  performance: { now: () => now }, summonInstrumentPanel: () => { summons++; },
  executeDrawingToolAction: action => {
    assert.equal(action.tool, 'drafting');
    draftingSummons++;
  },
  scene, MeshBuilder, TransformNode, StandardMaterial, Axis, Color3, Matrix, Quaternion, Vector3, Plane, Ray,
  WebXRHandJoint,
  document: { createElement: () => ({ getContext: () => ctx }) },
  DynamicTexture: class { update() {} dispose() {} },
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  addInstrumentButtonModel() {},
});
vm.runInContext(load('../src/menu/handMenuPose.ts'), context);
vm.runInContext(load('../src/menu/floatingPanel.ts'), context);
vm.runInContext(load('../src/menu/handMenu.ts'), context);
const controllers = new Map();
const update = () => {
  scene.incrementRenderId();
  context.updateHandMenu(controllers, 0.5);
};
const near = (actual, expected, message) =>
  assert.ok(Vector3.Distance(actual, expected) < 1e-5,
    `${message}: actual ${actual.toString()}, expected ${expected.toString()}`);

try {
  update();
  const watch = scene.getTransformNodeByName('mediaWatchRoot');
  const plate = scene.getTransformNodeByName('instrumentPlateRoot');
  const drafting = scene.getTransformNodeByName('draftingPlateRoot');
  assert.ok(drafting, 'Right palm has a drafting plate');
  assert.equal(watch.isEnabled(), false);
  assert.equal(plate.isEnabled(), false);
  for (const name of ['mediaWatchBezel', 'mediaWatchCrown']) {
    assert.ok(scene.getMeshByName(name), 'Watch includes a case and crown');
  }
  assert.equal(scene.getMeshByName('mediaWatchStrap'), null, 'Watch has no band');
  const caseSize = scene.getMeshByName('mediaWatchBezel').getBoundingInfo().boundingBox.extendSize.scale(2 * 0.48);
  assert.ok(caseSize.x < 0.09 && caseSize.z < 0.06, 'Watch case has wearable dimensions');

  for (const rightHanded of [false, true]) {
    scene.useRightHandedSystem = rightHanded;
    for (const handedness of ['left', 'right']) {
      const parent = new TransformNode('trackingOrigin', scene);
      parent.position.set(2, 1.3, -4);
      const joints = new Map();
      const indexX = handedness === 'left' ? -0.035 : 0.035;
      const forwardZ = rightHanded ? -1 : 1;
      for (const [name, position] of [
        [WebXRHandJoint.WRIST, Vector3.Zero()],
        [WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL, new Vector3(indexX, 0, forwardZ * 0.09)],
        [WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL, new Vector3(0, 0, forwardZ * 0.1)],
        [WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL, new Vector3(-indexX, 0, forwardZ * 0.08)],
        [WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL, new Vector3(-indexX / 2, 0, forwardZ * 0.09)],
        [WebXRHandJoint.INDEX_FINGER_TIP, new Vector3(indexX, 0, forwardZ * 0.19)],
        [WebXRHandJoint.MIDDLE_FINGER_TIP, new Vector3(0, 0, forwardZ * 0.21)],
        [WebXRHandJoint.RING_FINGER_TIP, new Vector3(-indexX / 2, 0, forwardZ * 0.19)],
        [WebXRHandJoint.PINKY_FINGER_TIP, new Vector3(-indexX, 0, forwardZ * 0.16)],
      ]) {
        const joint = MeshBuilder.CreateSphere(name, { diameter: 1 }, scene);
        joint.parent = parent;
        joint.position.copyFrom(position);
        joint.scaling.setAll(0.008);
        joint.rotationQuaternion = Quaternion.FromEulerAngles(1.2, -0.8, 0.4);
        joint.isVisible = false;
        joints.set(name, joint);
      }
      const palmPlate = handedness === 'left' ? plate : drafting;
      const otherPlate = handedness === 'left' ? drafting : plate;
      const hand = { getJointMesh: name => joints.get(name) };
      context.setMenuHandTracking({ getHandByHandedness: side => side === handedness ? hand : null });
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        parent.rotation.set(0.2, yaw, -0.25);
        update();
        assert.ok(watch.isEnabled() && palmPlate.isEnabled(), `${handedness} shows ${handedness === 'left' ? 'instruments' : 'drafting'} on a flat palm`);
        assert.equal(otherPlate.isEnabled(), false, `${handedness} flat palm shows only its own plate`);
        if (handedness === 'right') {
          const draft = scene.getMeshByName('draftingPlateButton-Draft');
          assert.ok(draft.isEnabled(), 'Drafting plate buttons are shown');
          const hit = context.getHandMenuHitNearPoint(draft.getAbsolutePosition());
          assert.equal(hit?.action, 'drawingTool');
          assert.equal(hit?.tool, 'drafting', 'Draft button opens the drafting tray');
        }
        const normal = parent.getDirection(Axis.Y).normalize();
        const forward = parent.getDirection(new Vector3(0, 0, forwardZ)).normalize();
        const wrist = joints.get(WebXRHandJoint.WRIST).getAbsolutePosition();
        near(watch.getAbsolutePosition(), wrist.subtract(normal.scale(0.025)).subtract(forward.scale(0.045)),
          'Media watch sits on the back of the wrist toward the forearm');
        near(palmPlate.getAbsolutePosition(), wrist.add(normal.scale(0.09)).add(forward.scale(0.195)),
          'Instrument plate is above the palm toward the fingers');
        near(watch.getDirection(Axis.Y).normalize(), normal.negate(), 'Watch faces away from the back of the wrist');
        near(palmPlate.getDirection(Axis.Y), normal, 'Instrument plate faces outward from the palm');
        near(watch.absoluteScaling, Vector3.One().scale(0.48), 'Watch has wearable dimensions independent of joint radius');
        near(palmPlate.absoluteScaling, Vector3.One(), 'Instrument menu does not inherit the joint radius');
        const button = scene.getMeshByName('handMenuButton->||');
        const world = button.computeWorldMatrix(true);
        const left = Vector3.TransformCoordinates(new Vector3(-0.011, 0, 0), world);
        const right = Vector3.TransformCoordinates(new Vector3(0.011, 0, 0), world);
        assert.ok(Math.abs(Vector3.Distance(left, right) - 0.022 * 0.48) < 1e-6,
          'Transport buttons keep their physical size');
        assert.equal(scene.getMeshByName('handMenuButton-Tools').isEnabled(), false,
          'Flat palm does not show the controller utility buttons');
      }
      const summonCount = () => handedness === 'left' ? summons : draftingSummons;
      const beforeSummon = summonCount();
      now += 499;
      update();
      assert.equal(summonCount(), beforeSummon, 'Open palm waits 500 ms');
      now += 1;
      update();
      assert.equal(summonCount(), beforeSummon, 'Flat palm does not summon a separate floating palette');
      now += 1000;
      update();
      assert.equal(summonCount(), beforeSummon, 'Holding flat palm only keeps the instrument menu attached');
      const watchPosition = watch.getAbsolutePosition().clone();
      context.beginFloatingPanelGrab('other', Matrix.Identity(), undefined, watchPosition, 0.03, true);
      assert.notEqual(watch.parent, null, 'Tracked watch cannot be detached');
      assert.equal(context.beginFloatingPanelGrab('other', Matrix.Identity(),
        scene.getMeshByName('mediaWatchFace'), undefined, 0.03, true), false,
      'Ray-picked watch cannot be detached either');
      parent.rotation.set(0, 0, Math.PI);
      update();
      assert.equal(watch.isEnabled(), true, 'Wearable watch follows a lowered palm');
      assert.equal(palmPlate.isEnabled(), false, 'Palm down hides instruments');
      parent.rotation.z = Math.PI / 2;
      update();
      assert.equal(watch.isEnabled(), true, 'Wearable watch stays on the wrist edge-on');
      parent.rotation.setAll(0);
      for (const tip of [WebXRHandJoint.INDEX_FINGER_TIP, WebXRHandJoint.MIDDLE_FINGER_TIP,
        WebXRHandJoint.RING_FINGER_TIP, WebXRHandJoint.PINKY_FINGER_TIP]) {
        joints.get(tip).position.scaleInPlace(0.3);
      }
      update();
      now += 600;
      update();
      assert.equal(palmPlate.isEnabled(), false, 'Closed fingers hide the instrument menu');
      assert.equal(summonCount(), beforeSummon, 'Closed fingers do not summon the palette');
      parent.rotation.setAll(0);
      joints.get(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL).position.setAll(0);
      update();
      assert.equal(watch.isEnabled(), false, 'Collapsed/uninitialized joints do not open a menu');
      joints.get(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL).position.set(0, 0, forwardZ * 0.1);
      update();
      assert.equal(watch.isEnabled(), true, 'Restored joints show the wearable watch again');
      const heldGrip = MeshBuilder.CreateBox('heldControllerGrip', {}, scene);
      controllers.set('held', { grip: heldGrip, inputSource: { handedness: handedness === 'left' ? 'right' : 'left' } });
      update();
      assert.ok(!watch.isEnabled() && !palmPlate.isEnabled(), 'Menus do not auto-show while a controller is connected');
      controllers.delete('held');
      heldGrip.dispose();
      context.setMenuHandTracking(null);
      parent.dispose();
    }
  }

  scene.useRightHandedSystem = false;
  const grip = MeshBuilder.CreateBox('controllerGrip', {}, scene);
  grip.position.set(1, 1.2, 2);
  grip.rotation.set(0.2, 0.7, 0.1);
  controllers.set('left', { grip, inputSource: { handedness: 'left' } });
  update();
  assert.ok(!watch.isEnabled() && !plate.isEnabled(), 'Controllers no longer open menus by pose alone');
  assert.equal(context.toggleControllerHandMenu('instruments', 'left'), true, 'X opens the instrument menu');
  update();
  assert.ok(plate.isEnabled() && !watch.isEnabled(), 'X shows only the instrument menu');
  assert.equal(scene.getMeshByName('handMenuButton-Tools').isEnabled(), true, 'Instrument menu includes its tool buttons');
  assert.equal(context.toggleControllerHandMenu('media', 'left'), true, 'Y opens the media watch');
  update();
  assert.ok(watch.isEnabled() && plate.isEnabled(), 'X and Y menus can be open together');
  assert.equal(context.isHandMenuVisible(), true, 'Media watch enables thumbstick jogging');
  context.toggleControllerHandMenu('instruments', 'left');
  update();
  assert.ok(watch.isEnabled() && !plate.isEnabled(), 'Second X press closes only the instrument menu');
  assert.equal(scene.getMeshByName('handMenuButton-Tools').isEnabled(), false, 'Closing X hides its tool buttons');
  assert.equal(scene.getMeshByName('handMenuButton->||').isEnabled(), true, 'Media buttons stay with Y');
  context.toggleControllerHandMenu('instruments', 'left');
  update();
  assert.ok(watch.isEnabled() && plate.isEnabled(), 'Controllers open both menus with X and Y');
  near(watch.getAbsolutePosition(), Vector3.TransformCoordinates(
    new Vector3(0, 0.035, 0.13), grip.computeWorldMatrix(true)), 'Controller watch placement is preserved');
  near(plate.getAbsolutePosition(), Vector3.TransformCoordinates(
    new Vector3(0, 0.09, -0.195), grip.computeWorldMatrix(true)), 'Controller instrument placement is preserved');
  const before = watch.computeWorldMatrix(true).clone();
  assert.ok(context.beginFloatingPanelGrab('right', Matrix.Identity(), scene.getMeshByName('mediaWatchFace'),
    undefined, 0.03, true));
  context.endFloatingPanelGrab('right');
  assert.equal(watch.parent, null, 'Watch remains detachable');
  controllers.clear();
  update();
  assert.ok(watch.isEnabled(), 'Detached watch stays visible without a tracked hand or controller');
  assert.equal(plate.isEnabled(), false, 'Still-worn instrument menu hides independently');
  assert.ok(watch.computeWorldMatrix(true).asArray().every((value, index) =>
    Math.abs(value - before.asArray()[index]) < 1e-6), 'Detachment preserves the world pose');
  assert.equal(context.getHandMenuPose(Vector3.Zero(), new Vector3(NaN, 0, 0), Axis.Z), null);
  console.log('Hand-menu checks passed: both tracked hands, both coordinate systems, rotated tracking origins, palm-side placement, physical size, pose gating, controller compatibility, and independent detachment.');
} finally {
  scene.dispose();
  engine.dispose();
}
