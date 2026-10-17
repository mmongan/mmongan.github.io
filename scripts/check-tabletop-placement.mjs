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
  console.log('Tabletop placement passed: table button, AR re-entry, translated/rotated tracking origins, both coordinate systems, pitch/vertical gaze, height, scale, and stationary placement.');
} finally {
  scene.dispose();
  engine.dispose();
}
