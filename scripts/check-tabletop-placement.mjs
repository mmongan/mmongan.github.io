import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Matrix, Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const source = readFileSync(new URL('../src/xr/ar.ts', import.meta.url), 'utf8');
const transformed = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '');
const controllerSource = readFileSync(new URL('../src/interaction/controllers.ts', import.meta.url), 'utf8');
const controllerTransformed = stripTypeScriptTypes(controllerSource, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
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
assert.equal(context.setARScale(1 / 120), 1, 'Desktop always stays at 1:1');
context.enterARTabletopMode();
assert.equal(context.isARTabletopModeActive(), false, 'Desktop cannot enter AR tabletop transforms');
context.setImmersiveFieldScaling(true);
vm.runInContext(stripTypeScriptTypes(buttonHandler, { mode: 'transform' }), context);
const near = (actual, expected, label) => assert.ok(
  Vector3.Distance(actual, expected) < 1e-6, `${label}: ${actual.toString()} vs ${expected.toString()}`
);

const scaleContext = vm.createContext({ Matrix, Vector3 });
vm.runInContext(controllerTransformed, scaleContext);
const startPosition = new Vector3(3, 0, -4);
const midpoint = new Vector3(1, 0, 2);
const startScale = 0.8;
const startRotation = 0.4;
const nextScale = 0.2;
const nextRotation = 0.9;
const localAnchor = scaleContext.rotateAroundY(midpoint.subtract(startPosition), -startRotation)
  .scale(1 / startScale);
const resizedPosition = scaleContext.getARPositionForScaleAnchor(
  midpoint, localAnchor, nextScale, nextRotation
);
const resizedAnchor = resizedPosition.add(
  scaleContext.rotateAroundY(localAnchor.scale(nextScale), nextRotation)
);
near(resizedAnchor, midpoint, 'Shrinking keeps the field point under the hand midpoint');
const centeredAnchor = midpoint.subtract(startPosition).scale(1 / startScale);
const centeredPosition = scaleContext.getARPositionForScaleAnchor(
  midpoint, centeredAnchor, nextScale, 0
);
assert.ok(Vector3.Distance(centeredPosition, midpoint) < Vector3.Distance(startPosition, midpoint),
  'Shrinking moves the field center toward the controllers/hands midpoint');
const handInteractionSource = readFileSync(
  new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8'
);
assert.match(controllerSource, /setARPosition\(getARPositionForScaleAnchor\(/,
  'Controller scaling uses the shared midpoint anchor');
assert.match(handInteractionSource, /setARPosition\(getARPositionForScaleAnchor\(/,
  'Tracked-hand scaling uses the shared midpoint anchor');

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
  near(context.getARPosition(), placed, 'Table button cannot change desktop field placement');
  inXR = true;
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
  for (const mode of ['vr', 'ar']) {
    context.setImmersiveFieldScaling(true);
    if (mode === 'ar') context.enterARTabletopMode();
    context.setARScale(.03);
    context.setARPosition(new Vector3(4, 2, 9));
    context.setARRotation(.7);
    context.setImmersiveFieldScaling(false);
    assert.equal(context.getARScale(), 1, `Exiting ${mode} restores desktop 1:1`);
    assert.equal(context.getFieldHeightMode(), 'floor');
    assert.equal(context.getARRotation(), 0);
    assert.equal(context.getARPosition().x, 0);
    assert.equal(context.getARPosition().z, 0);
    assert.equal(context.setARScale(.2), 1, 'Later desktop scaling requests cannot shrink the field');
  }
  for (const scale of [0.002, 1 / 240, 1 / 120]) {
    assert.equal(context.getScaleAwareSurfaceHeight(scale), 0.83,
      'Tabletop scales use the configured table height');
  }
  assert.ok(context.getScaleAwareSurfaceHeight(0.1) < 0.7,
    'Intermediate scales blend toward the floor');
  assert.ok(Math.abs(context.getScaleAwareSurfaceHeight(1)) < 1e-9,
    'Full-size scaling puts the ground on the floor, not at eye level');
  let previous = Infinity;
  for (let scale = 1 / 120; scale <= 1.0001; scale *= 1.1) {
    const blended = context.getScaleAwareSurfaceHeight(scale);
    assert.ok(blended <= previous + 1e-9 && blended >= -1e-9, 'Floor blend descends smoothly while scaling up');
    previous = blended;
  }
  assert.equal(context.getScaleGestureSurfaceHeight(0.83, 0.4, 1 / 240, 1 / 240), 1.23,
    'Hands can still lift a tabletop field when its size is unchanged');
  assert.equal(context.getScaleGestureSurfaceHeight(0.75, 0.4, 1 / 480, 1 / 120), 0.83,
    'Hand lift fades when spreading reaches tabletop scale');
  context.setFieldHeightSetting('floor', 0.05);
  assert.equal(context.getScaleGestureSurfaceHeight(1.2, 0.8, 1 / 120, 1), 0.05,
    'Expanding to 1:1 puts the field surface at configured floor height');
  assert.equal(context.getScaleGestureSurfaceHeight(0.05, 0, 1, 1 / 120), 0.83,
    'Shrinking from 1:1 raises the field to configured table height');
  assert.ok(context.getScaleGestureSurfaceHeight(0.83, 0.6, 1 / 120, 0.05) < 0.83,
    'Growing from tabletop blends toward the floor despite raised hands');
  assert.ok(Math.abs(context.getScaleAwareSurfaceHeight(1) - 0.05) < 1e-9,
    'Full-size scaling honours a calibrated floor height');
  context.setFieldHeightSetting('floor', 0);
  let followedHeight = 0;
  const firstFollowStep = context.getARSurfaceHeightFollowStep(followedHeight, 1, 1 / 60);
  assert.ok(firstFollowStep > followedHeight && firstFollowStep < 1,
    'Giant-mode floor following moves smoothly instead of snapping');
  for (let frame = 0; frame < 300; frame++) {
    followedHeight = context.getARSurfaceHeightFollowStep(followedHeight, 1, 1 / 60);
  }
  assert.ok(Math.abs(followedHeight - 1) < 1e-6,
    'Giant-mode floor following settles at the changing floor altitude');
  assert.match(xrSource, /alignRoomScaleFloor\(baseExperience\.camera,\s*scene\.getEngine\(\)\.getDeltaTime\(\)\s*\/\s*1000\)/,
    'Giant-mode floor following uses frame time for smooth altitude changes');
  for (const file of ['controllers.ts', 'handInteraction.ts']) {
    const interaction = readFileSync(new URL(`../src/interaction/${file}`, import.meta.url), 'utf8');
    assert.match(interaction, /setARSurfaceHeight\(getScaleGestureSurfaceHeight\(/,
      'Both resize inputs use the scale-aware surface-height transition');
    assert.doesNotMatch(interaction, /setARSurfaceHeightForScaleGesture/, 'No threshold height resets remain');
  }
  console.log('Tabletop placement passed: viewer-relative entry, AR re-entry, both coordinate systems, vertical gaze, button-only height reset, resize threshold crossings, preserved custom height, and vertical movement.');
} finally {
  scene.dispose();
  engine.dispose();
}
