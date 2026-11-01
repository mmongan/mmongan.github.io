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
const handMoveStart = new Vector3(3, 0.8, -4);
const handStart = new Vector3(-2, 1, 5);
const handCurrent = new Vector3(1, 2.5, 3);
near(
  scaleContext.getARPositionForSingleHandMovement(handMoveStart, handStart, handCurrent),
  new Vector3(6, 2.3, -6),
  'One-hand movement translates the field in all three axes',
);
const handInteractionSource = readFileSync(
  new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8'
).replace(/\r\n/g, '\n');
assert.match(controllerSource, /setARPosition\(getARPositionForScaleAnchor\(/,
  'Controller scaling uses the shared midpoint anchor');
assert.match(controllerSource, /setARPosition\(getARPositionForSingleHandMovement\(/,
  'One controller translates the field from its grip position');
assert.match(handInteractionSource, /setARPosition\(getARPositionForScaleAnchor\(/,
  'Tracked-hand scaling uses the shared midpoint anchor');
assert.match(handInteractionSource, /updateSingleHandFieldMovement\(singleHandFieldMove\.movement/,
  'One tracked hand uses the shared anchored translation and rotation');

let fieldPosition = handMoveStart.clone();
let fieldRotation = 0.7;
Object.assign(scaleContext, {
  getARPosition: () => fieldPosition.clone(),
  getARRotation: () => fieldRotation,
  setARPosition: position => { fieldPosition = position.clone(); },
  setARRotation: rotation => { fieldRotation = rotation; },
  floorCalibrationToggle: { checked: false },
});
for (const scale of [0.01, 0.2, 1]) {
  for (const initialRotation of [0, 0.7, -2]) {
    fieldPosition = handMoveStart.clone();
    fieldRotation = initialRotation;
    const movement = scaleContext.beginSingleHandFieldMovement(handStart, 3);
    near(fieldPosition, handMoveStart, 'Starting one-hand rotation never jumps the field');
    const heldLocal = scaleContext.rotateAroundY(handStart.subtract(fieldPosition), -fieldRotation).scale(1 / scale);
    scaleContext.updateSingleHandFieldMovement(movement, handCurrent, -3);
    const delta = Math.atan2(Math.sin(-6), Math.cos(-6));
    assert.ok(Math.abs(fieldRotation - initialRotation - delta) < 1e-6,
      'Wrist yaw crosses the +/-pi boundary without a full turn');
    near(fieldPosition.add(scaleContext.rotateAroundY(heldLocal.scale(scale), fieldRotation)), handCurrent,
      'Translation and wrist rotation keep the held field point under the hand at every scale');
    const heldRotation = fieldRotation;
    scaleContext.updateSingleHandFieldMovement(movement, handCurrent, null);
    scaleContext.updateSingleHandFieldMovement(movement, handCurrent, 1);
    assert.equal(fieldRotation, heldRotation, 'Vertical poses and recovery do not snap rotation');
    scaleContext.updateSingleHandFieldMovement(movement, handCurrent, 1.2);
    assert.ok(Math.abs(fieldRotation - heldRotation - 0.2) < 1e-6);
  }
}
assert.equal(scaleContext.getSingleHandYaw(Vector3.Up()), null, 'Vertical wrist has no usable yaw');
assert.equal(scaleContext.getSingleHandYaw(Vector3.Zero()), null, 'Missing joint direction has no usable yaw');
assert.ok(Math.abs(scaleContext.getSingleHandYaw(new Vector3(1, 0, 1)) - Math.PI / 4) < 1e-6);

for (const handedness of ['left', 'right']) {
  const grip = new TransformNode(`singleGrip-${handedness}`, scene);
  const controller = { uniqueId: handedness, inputSource: { handedness },
    motionController: { getComponentOfType: () => ({ pressed: true }) }, grip, pointer: grip };
  fieldPosition = handMoveStart.clone();
  fieldRotation = 0.7;
  grip.position.copyFrom(handStart);
  grip.rotation.y = 0.2;
  scaleContext.setActiveController(controller);
  scaleContext.updateARResizeFromControllers(false);
  near(fieldPosition, handMoveStart, `${handedness}: first squeeze establishes the anchor`);
  grip.rotation.y = 0.6;
  grip.position.copyFrom(handCurrent);
  scaleContext.updateARResizeFromControllers(false);
  assert.ok(Math.abs(fieldRotation - 1.1) < 1e-6, `${handedness}: controller wrist yaw rotates the field`);
  near(fieldPosition, scaleContext.getARPositionForSingleHandMovement(handMoveStart, handStart, handCurrent, 0.4),
    `${handedness}: controller movement rotates around its held point`);
  scaleContext.setSceneManipulationLocked(true);
  grip.rotation.y = 1.2;
  scaleContext.updateARResizeFromControllers(false);
  assert.ok(Math.abs(fieldRotation - 1.1) < 1e-6, 'Drum Game lock blocks one-handed rotation');
  scaleContext.setSceneManipulationLocked(false);
  scaleContext.removeActiveController(controller, () => {});
  scaleContext.updateARResizeFromControllers(false);
  grip.dispose();
}

const handBranchStart = handInteractionSource.indexOf('    sceneGesture = null;\n    const singlePinch');
const handBranchEnd = handInteractionSource.indexOf("    for (const handedness of ['left', 'right'] as const)", handBranchStart);
assert.ok(handBranchStart >= 0 && handBranchEnd > handBranchStart);
const handYawSource = handInteractionSource.match(/  function getHandWorldYaw[\s\S]*?\n  }/)[0];
const handContext = vm.createContext({
  Vector3, left: null, right: null, marcherHandsBusy: false,
  WebXRHandJoint: { WRIST: 'wrist', MIDDLE_FINGER_METACARPAL: 'middle' },
  getSingleHandYaw: scaleContext.getSingleHandYaw,
  beginSingleHandFieldMovement: scaleContext.beginSingleHandFieldMovement,
  updateSingleHandFieldMovement: scaleContext.updateSingleHandFieldMovement,
  isControllerSceneManipulationActive: () => false, isSceneManipulationLocked: () => false,
  isDraftingTableMode: () => false, isPointOnField: () => false,
  getSidelineDraftPosition: () => null, findMarcherNearHand: () => null,
});
vm.runInContext(stripTypeScriptTypes(`let singleHandFieldMove = null, sceneGesture = null;
${handYawSource}
function moveHand() {
${handInteractionSource.slice(handBranchStart, handBranchEnd)}
}`, { mode: 'transform' }), handContext);
for (const handedness of ['left', 'right']) {
  let direction = new Vector3(0, 0, 0.05);
  handContext.handTracking = { getHandByHandedness: side => side === handedness ? {
    getJointMesh: joint => ({ getAbsolutePosition: () => joint === 'wrist' ? Vector3.Zero() : direction }),
  } : null };
  fieldPosition = handMoveStart.clone();
  fieldRotation = 0.7;
  handContext[handedness] = handStart;
  handContext.moveHand();
  handContext[handedness] = handCurrent;
  direction = new Vector3(Math.sin(0.4) * 0.05, 0, Math.cos(0.4) * 0.05);
  handContext.moveHand();
  assert.ok(Math.abs(fieldRotation - 1.1) < 1e-6, `${handedness}: tracked wrist yaw rotates the field`);
  near(fieldPosition, scaleContext.getARPositionForSingleHandMovement(handMoveStart, handStart, handCurrent, 0.4),
    `${handedness}: tracked pinch keeps its held point anchored`);
  handContext[handedness] = null;
  handContext.moveHand();
}

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
  context.setFieldHeightSetting('floor', 0.05);
  assert.ok(Math.abs(context.getScaleAwareSurfaceHeight(1) - 0.05) < 1e-9,
    'Full-size scaling honours a calibrated floor height');
  context.setFieldHeightSetting('floor', 0);
  context.setImmersiveFieldScaling(true);
  const resizeAPI = Object.fromEntries([
    'getARPosition', 'getARRotation', 'getARScale', 'getARScaleRange',
    'getARSurfaceHeight', 'setARPosition', 'setARRotation', 'setARScale',
    'setARSurfaceHeight', 'preserveARSurfaceHeight',
  ].map(name => [name, context[name]]));
  Object.assign(scaleContext, resizeAPI);
  Object.assign(handContext, resizeAPI, {
    getControllerYaw: scaleContext.getControllerYaw,
    getARPositionForScaleAnchor: scaleContext.getARPositionForScaleAnchor,
    rotateAroundY: scaleContext.rotateAroundY,
    pinchesOutsideField: true, finishFingerPath() {}, finishMarcherGrab() {},
    marcherGrabs: new Map(), handPinches: new Map(),
  });
  const twoHandStart = handInteractionSource.indexOf('    if (!isSceneManipulationLocked() && left && right && pinchesOutsideField');
  vm.runInContext(stripTypeScriptTypes(`function resizeHands() {
${handInteractionSource.slice(twoHandStart, handBranchStart)}
sceneGesture = null;
}`, { mode: 'transform' }), handContext);
  for (const input of ['controllers', 'hands']) {
    for (const initialScale of [1, .1, .008]) {
      context.setARScale(initialScale);
      context.setARRotation(.4);
      const initialAltitude = .87;
      context.setARPosition(new Vector3(3, initialAltitude + .48 * initialScale, -4));
      const initialMidpoint = new Vector3(1, 1.3, 2);
      const heldAnchor = scaleContext.rotateAroundY(initialMidpoint.subtract(context.getARPosition()), -.4)
        .scale(1 / initialScale);
      const grips = ['left', 'right'].map((side, index) => {
        const grip = new TransformNode(`resize-${side}`, scene);
        grip.position.copyFrom(initialMidpoint.add(new Vector3(index ? .4 : -.4, 0, 0)));
        const controller = { uniqueId: side, inputSource: { handedness: side }, grip, pointer: grip,
          motionController: { getComponentOfType: () => ({ pressed: true }) } };
        if (input === 'controllers') scaleContext.setActiveController(controller);
        else handContext[side] = grip.position;
        return { grip, controller };
      });
      const update = () => {
        grips.forEach(({ grip }) => grip.computeWorldMatrix(true));
        if (input === 'controllers') scaleContext.updateARResizeFromControllers(false);
        else handContext.resizeHands();
      };
      update();
      near(context.getARPosition().add(scaleContext.rotateAroundY(
        heldAnchor.scale(context.getARScale()), context.getARRotation())), initialMidpoint,
      `${input}: starting resize does not jump vertically`);
      const currentMidpoint = new Vector3(1.2, 1.45, 1.8);
      grips.forEach(({ grip }, index) => grip.position.copyFrom(
        currentMidpoint.add(new Vector3(index ? .15 : -.15, 0, 0))));
      update();
      const shrunkScale = context.getARScale();
      assert.ok(shrunkScale < initialScale, `${input}: input actually shrinks the field`);
      const resizedAnchor = context.getARPosition().add(scaleContext.rotateAroundY(
        heldAnchor.scale(shrunkScale), context.getARRotation()));
      assert.ok(Math.hypot(resizedAnchor.x - currentMidpoint.x, resizedAnchor.z - currentMidpoint.z) < 1e-6,
        `${input}: shrinking retains the horizontal midpoint anchor`);
      assert.ok(Math.abs(context.getARSurfaceHeight() - initialAltitude) < 1e-6,
        `${input}: shrinking ignores vertical hand movement and preserves surface altitude`);
      const fullSeparation = .8 * Math.pow(1 / initialScale,
        input === 'controllers' ? 1 / scaleContext.getScaleExponentFor(initialScale) : 1) * 1.01;
      grips.forEach(({ grip }, index) => grip.position.copyFrom(
        new Vector3((index ? 1 : -1) * fullSeparation / 2, .3, 2)));
      update();
      assert.equal(context.getARScale(), 1, `${input}: expansion reaches full size`);
      assert.ok(Math.abs(context.getARSurfaceHeight() - initialAltitude) < 1e-6,
        `${input}: expansion to 1:1 also preserves altitude rather than falling to the floor`);
      const retainedPosition = context.getARPosition();
      grips.forEach(({ grip, controller }) => {
        if (input === 'controllers') scaleContext.removeActiveController(controller, () => {});
        grip.dispose();
      });
      if (input === 'controllers') scaleContext.updateARResizeFromControllers(false);
      else { handContext.left = null; handContext.right = null; handContext.resizeHands(); }
      near(context.getARPosition(), retainedPosition, `${input}: releasing preserves the resized altitude`);
    }
  }
  const floorStart = xrSource.indexOf('  function alignRoomScaleFloor(');
  const floorEnd = xrSource.indexOf('  function alignFieldFloorTo(', floorStart);
  Object.assign(context, {
    giantModeActive: true,
    getHeadsetFloorY: () => 0,
  });
  vm.runInContext(stripTypeScriptTypes(xrSource.slice(floorStart, floorEnd), { mode: 'transform' }), context);
  context.setFieldHeightMode('floor');
  context.setARScale(.08);
  context.setARSurfaceHeight(1);
  context.alignRoomScaleFloor({ realWorldHeight: 1.7 }, 1 / 60);
  assert.ok(context.getARSurfaceHeight() < 1, 'Unmodified room-sized Giant mode still sinks toward the floor');
  context.setARScale(.02);
  context.preserveARSurfaceHeight(1.3);
  context.alignRoomScaleFloor({ realWorldHeight: 1.7 }, 1 / 60);
  assert.ok(Math.abs(context.getARSurfaceHeight() - 1.3) < 1e-6,
    'Giant-mode floor following cannot pull a resized field back down after release');
  context.setARScale(1);
  context.preserveARSurfaceHeight(1.3);
  context.alignRoomScaleFloor({ realWorldHeight: 1.7 }, 1 / 60);
  assert.ok(Math.abs(context.getARSurfaceHeight() - 1.3) < 1e-6,
    'Height ownership also blocks Giant floor following at full size');
  context.setFieldHeightMode('floor');
  assert.equal(context.isARSurfaceHeightPreserved(), false, 'Explicit floor placement restores floor ownership');
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
    assert.match(interaction, /preserveARSurfaceHeight\(/,
      'Both resize inputs preserve surface altitude');
    assert.doesNotMatch(interaction, /setARSurfaceHeightForScaleGesture/, 'No threshold height resets remain');
  }
  console.log('Tabletop placement passed: viewer-relative entry, AR re-entry, both coordinate systems, vertical gaze, height transitions, and anchored one-handed translation/rotation for both controllers and tracked hands.');
} finally {
  scene.dispose();
  engine.dispose();
}
