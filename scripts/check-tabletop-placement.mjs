import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const source = readFileSync(new URL('../src/xr/ar.ts', import.meta.url), 'utf8');
const transformed = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const xrSource = readFileSync(new URL('../src/xr/webXR.ts', import.meta.url), 'utf8');
const buttonHandler = xrSource.slice(
  xrSource.indexOf('  tabletopScaleButton?.addEventListener'),
  xrSource.indexOf('  function applyRoomScale')
);
const engine = new NullEngine();
const scene = new Scene(engine);
let camera = new FreeCamera('viewer', new Vector3(8, 1.7, -12), scene);
const origin = new TransformNode('trackingOrigin', scene);
camera.parent = origin;
scene.activeCamera = camera;
let click;
let inXR = true;
const context = vm.createContext({
  Vector3, TransformNode, Observable, scene,
  FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333, FIELD_SURFACE_Y: -0.48,
  switchingToFullScaleVR: false, giantModeActive: false,
  isMarcherPOVActive: () => false,
  floorCalibrationToggle: { checked: false },
  sittingModeToggle: { checked: false }, detectedSitting: false,
  WebXRState: { IN_XR: 2 },
  xrExperience: { baseExperience: { get state() { return inXR ? 2 : 3; }, camera } },
  applyPostureHeight() {}, updateTableHeightFromCamera() {},
  updateTeleportationAvailability() {},
  tabletopScaleButton: { addEventListener: (event, handler) => { click = handler; } },
});
vm.runInContext(transformed, context);
vm.runInContext(stripTypeScriptTypes(buttonHandler, { mode: 'transform' }), context);
const near = (actual, expected, label) => assert.ok(
  Vector3.Distance(actual, expected) < 1e-6, `${label}: ${actual.toString()} vs ${expected.toString()}`
);

try {
  context.setFieldHeightSetting('table', 0.83);
  for (const rightHanded of [false, true]) {
    scene.useRightHandedSystem = rightHanded;
    camera.dispose();
    camera = new FreeCamera('viewer', new Vector3(8, 1.7, -12), scene);
    camera.parent = origin;
    scene.activeCamera = camera;
    context.xrExperience.baseExperience.camera = camera;
    for (const parentYaw of [0, 0.8]) {
      origin.rotation.y = parentYaw;
      origin.position.set(3, 0.2, -4);
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        for (const pitch of [0, -0.7, 0.7, Math.PI / 2, -Math.PI / 2]) {
          camera.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0);
          scene.incrementRenderId();
          camera.computeWorldMatrix();
          const heading = yaw + parentYaw;
          const sign = rightHanded ? -1 : 1;
          const expected = camera.globalPosition.add(new Vector3(
            sign * Math.sin(heading) * 0.6, 0, sign * Math.cos(heading) * 0.6
          ));
          expected.y = 0.83 + 0.48 / 120;
          context.setARPosition(new Vector3(100, 9, 200));
          context.setARRotation(2.1);
          click();
          near(context.getARPosition(), expected, `Table button places center ahead (${rightHanded}, ${parentYaw}, ${yaw}, ${pitch})`);
          assert.ok(Math.abs(context.getARSurfaceHeight() - 0.83) < 1e-6,
            'Placement preserves configured table surface height');
          assert.equal(context.getARScale(), 1 / 120, 'Table button applies default tabletop scale');
          const tableForward = new Vector3(Math.sin(context.getARRotation()), 0, Math.cos(context.getARRotation()));
          near(tableForward, new Vector3(sign * Math.sin(heading), 0, sign * Math.cos(heading)),
            'Table aligns with horizontal viewing direction');
        }
      }
    }
  }
  const placed = context.getARPosition();
  camera.position.x += 5;
  scene.incrementRenderId();
  camera.computeWorldMatrix();
  near(context.getARPosition(), placed, 'Table does not follow subsequent head movement');
  inXR = false;
  click();
  assert.ok(Vector3.Distance(context.getARPosition(), placed) > 4.9,
    'Desktop table entry also uses the current camera');
  context.enterARTabletopMode();
  const arPosition = context.getARPosition();
  camera.position.z += 4;
  context.enterARTabletopMode();
  near(context.getARPosition(), arPosition, 'Repeated AR enter calls do not continuously reposition');
  context.exitARTabletopMode();
  context.enterARTabletopMode();
  assert.ok(Vector3.Distance(context.getARPosition(), arPosition) > 3.9,
    'Re-entering AR places table at the new viewer position');
  assert.match(xrSource, /else if \(state === WebXRState\.IN_XR\) \{\s*placeTabletopInFrontOfCamera/,
    'AR entry repositions after the first tracked headset frame, not only before tracking');
  for (const ar of [false, true]) {
    context.exitARTabletopMode();
    if (ar) context.enterARTabletopMode();
    context.setFieldHeightSetting('table', 0.83);
    context.setARScale(1);
    context.setFieldHeightMode('floor');
    context.setARScale(1 / 120);
    context.setARSurfaceHeight(0.1);
    assert.equal(context.getFieldHeightMode(), 'floor', 'Shrinking never changes height mode');
    assert.ok(Math.abs(context.getARSurfaceHeight() - 0.1) < 1e-6,
      'Even the first floor-to-table shrink preserves height');
    click();
    assert.equal(context.getFieldHeightMode(), 'table', 'Tabletop button explicitly enters table height mode');
    assert.ok(Math.abs(context.getARSurfaceHeight() - 0.83) < 1e-6,
      'Tabletop button still resets to configured height');
    context.setARPosition(new Vector3(8, 1.17, -3));
    context.setARSurfaceHeight(1.17);
    let height = 1.17;
    for (const [nextScale, verticalMotion] of [
      [1 / 60, 0], [1 / 120, 0], [1 / 240, 0],
      [1 / 60, 0.12], [1 / 120, -0.04], [1 / 240, 0],
    ]) {
      height += verticalMotion;
      context.setARScale(nextScale);
      context.setARSurfaceHeight(height);
      assert.ok(Math.abs(context.getARSurfaceHeight() - height) < 1e-6,
        'Existing table preserves surface height across repeated threshold crossings and vertical movement');
      assert.equal(context.getARPosition().x, 8, 'Resizing does not recenter the table horizontally');
      assert.equal(context.getARPosition().z, -3);
    }
  }
  context.setFieldHeightSetting('floor', 0);
  for (const scale of [0.002, 1 / 240, 1 / 120]) {
    assert.equal(context.getScaleAwareSurfaceHeight(1.2, scale), 1.2, 'Tabletop scales keep the gesture height');
  }
  assert.ok(context.getScaleAwareSurfaceHeight(1.2, 0.1) < 0.7,
    'A field grown well past tabletop size is pulled most of the way to the floor');
  assert.ok(Math.abs(context.getScaleAwareSurfaceHeight(1.6, 1)) < 1e-9,
    'Full-size scaling puts the ground on the floor, not at eye level');
  let previous = Infinity;
  for (let scale = 1 / 120; scale <= 1.0001; scale *= 1.1) {
    const blended = context.getScaleAwareSurfaceHeight(1.6, scale);
    assert.ok(blended <= previous + 1e-9 && blended >= -1e-9, 'Floor blend descends smoothly while scaling up');
    previous = blended;
  }
  assert.equal(context.getScaleGestureSurfaceHeight(0.75, 0.4, 1 / 240, 1 / 240), 1.15,
    'Hands still lift a tabletop field when its size is unchanged');
  assert.equal(context.getScaleGestureSurfaceHeight(0.75, 0.4, 1 / 480, 1 / 120), 0.75,
    'Hands rising while spreading do not lift a growing field toward eye level');
  assert.ok(context.getScaleGestureSurfaceHeight(0.75, 0.6, 1 / 120, 0.05) < 0.75,
    'Growing from tabletop settles toward the floor even with raised hands');
  context.setFieldHeightSetting('floor', 0.05);
  assert.ok(Math.abs(context.getScaleAwareSurfaceHeight(1.6, 1) - 0.05) < 1e-9,
    'Full-size scaling honours a calibrated floor height');
  context.setFieldHeightSetting('floor', 0);
  for (const file of ['controllers.ts', 'handInteraction.ts']) {
    const interaction = readFileSync(new URL(`../src/interaction/${file}`, import.meta.url), 'utf8');
    assert.match(interaction, /setARSurfaceHeight\(getScaleGestureSurfaceHeight\(/,
      'Both resize inputs preserve gesture height at tabletop scale and settle to the floor at full size');
    assert.doesNotMatch(interaction, /setARSurfaceHeightForScaleGesture/, 'No threshold height resets remain');
  }
  console.log('Tabletop placement passed: viewer-relative entry, AR re-entry, both coordinate systems, vertical gaze, button-only height reset, resize threshold crossings, preserved custom height, and vertical movement.');
} finally {
  scene.dispose();
  engine.dispose();
}
