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
  assert.equal(watch.isEnabled(), false);
  assert.equal(plate.isEnabled(), false);

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
      const hand = { getJointMesh: name => joints.get(name) };
      context.setMenuHandTracking({ getHandByHandedness: side => side === handedness ? hand : null });
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        parent.rotation.set(0.2, yaw, -0.25);
        update();
        assert.ok(watch.isEnabled() && !plate.isEnabled(), `${handedness} wears watch without the old palm plate`);
        const normal = parent.getDirection(Axis.Y).normalize();
        const forward = parent.getDirection(new Vector3(0, 0, forwardZ)).normalize();
        const wrist = joints.get(WebXRHandJoint.WRIST).getAbsolutePosition();
        near(watch.getAbsolutePosition(), wrist.add(normal.scale(0.035)).subtract(forward.scale(0.13)),
          'Media watch is above the palm side of the wrist');
        near(plate.getAbsolutePosition(), wrist.add(normal.scale(0.09)).add(forward.scale(0.195)),
          'Instrument plate is above the palm toward the fingers');
        near(watch.getDirection(Axis.Y), normal, 'Watch faces outward from the palm');
        near(plate.getDirection(Axis.Y), normal, 'Instrument plate faces outward from the palm');
        near(watch.absoluteScaling, Vector3.One(), 'Watch does not inherit the wrist joint radius');
        near(plate.absoluteScaling, Vector3.One(), 'Instrument menu does not inherit the joint radius');
        const button = scene.getMeshByName('handMenuButton->||');
        const world = button.computeWorldMatrix(true);
        const left = Vector3.TransformCoordinates(new Vector3(-0.011, 0, 0), world);
        const right = Vector3.TransformCoordinates(new Vector3(0.011, 0, 0), world);
        assert.ok(Math.abs(Vector3.Distance(left, right) - 0.022) < 1e-6,
          'Transport buttons keep their physical size');
      }
      const summonCount = () => handedness === 'left' ? summons : draftingSummons;
      const beforeSummon = summonCount();
      now += 499;
      update();
      assert.equal(summonCount(), beforeSummon, 'Open palm waits 500 ms');
      now += 1;
      update();
      assert.equal(summonCount(), beforeSummon + 1, 'Left palm opens instruments; right palm opens drafting');
      now += 1000;
      update();
      assert.equal(summonCount(), beforeSummon + 1, 'Held palm summons once, without repeated repositioning');
      const watchPosition = watch.getAbsolutePosition().clone();
      context.beginFloatingPanelGrab('other', Matrix.Identity(), undefined, watchPosition, 0.03, true);
      assert.notEqual(watch.parent, null, 'Tracked watch cannot be detached');
      assert.equal(context.beginFloatingPanelGrab('other', Matrix.Identity(),
        scene.getMeshByName('mediaWatchFace'), undefined, 0.03, true), false,
      'Ray-picked watch cannot be detached either');
      parent.rotation.set(0, 0, Math.PI);
      update();
      assert.equal(watch.isEnabled(), true, 'Wearable watch follows a lowered palm');
      assert.equal(plate.isEnabled(), false, 'Palm down hides instruments');
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
      assert.equal(summonCount(), beforeSummon + 1, 'Closed fingers do not summon the palette');
      parent.rotation.setAll(0);
      joints.get(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL).position.setAll(0);
      update();
      assert.equal(watch.isEnabled(), false, 'Collapsed/uninitialized joints do not open a menu');
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
  assert.ok(watch.isEnabled() && plate.isEnabled(), 'Controllers still open both menus');
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
