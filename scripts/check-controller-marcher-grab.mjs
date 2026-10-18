import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const handSource = readFileSync(new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8');
const transform = text => stripTypeScriptTypes(text, { mode: 'transform' });
const gripSource = source.slice(source.indexOf('function isGripPressed('), source.indexOf('\nfunction getControllerPosition('));
const gripContext = vm.createContext({});
vm.runInContext(transform(gripSource), gripContext);
assert.equal(gripContext.isGripPressed({ motionController: { getComponentOfType: () => ({ pressed: true }) },
  inputSource: {} }), true, 'Motion-controller squeeze activates grip');
assert.equal(gripContext.isGripPressed({ inputSource: { gamepad: { buttons: [{ pressed: false }, { pressed: true }] } } }),
  true, 'Raw gamepad grip works without a motion-controller profile');
assert.equal(gripContext.isGripPressed({ inputSource: { gamepad: { buttons: [{ pressed: true }, { pressed: false }] } } }),
  false, 'Trigger alone is not a grip');
const nearStart = handSource.indexOf('  function findMarcherNearHand(');
const nearEnd = handSource.indexOf('  function getFormationFieldPoint(', nearStart);
const robot = {};
const meshes = Array.from({ length: 7 }, (_, index) => ({
  isEnabled: () => true, isVisible: true, isPickable: true,
  computeWorldMatrix() {},
  getBoundingInfo: () => ({ boundingBox: {
    minimumWorld: new Vector3(index * 0.2 - 0.02, 0, -0.02),
    maximumWorld: new Vector3(index * 0.2 + 0.02, 0.1, 0.02),
  } }),
}));
const nearContext = vm.createContext({
  scene: { meshes }, findRobotRoot: () => robot, marcherGrabs: new Map(), fingerPath: null,
});
vm.runInContext(transform(handSource.slice(nearStart, nearEnd)), nearContext);
for (let part = 0; part < meshes.length; part++) {
  assert.equal(nearContext.findMarcherNearHand(new Vector3(part * 0.2, 0.05, 0)), robot,
    'Contact with any body/instrument mesh finds the complete marcher');
}
assert.equal(nearContext.findMarcherNearHand(new Vector3(4, 0, 0)), null);
nearContext.marcherGrabs.set('left', { robot, source: 'hand' });
assert.equal(nearContext.findMarcherNearHand(new Vector3(0, 0.05, 0)), null, 'Do not steal a held marcher');
assert.equal(nearContext.findMarcherNearHand(new Vector3(0, 0.05, 0), 'left'), robot, 'Hand-off remains available');
nearContext.marcherGrabs.set('left', { robot, source: 'controller' });
assert.equal(nearContext.findMarcherNearHand(new Vector3(0, 0.05, 0), 'left'), robot,
  'Second controller can contact the held marcher to start formation pulling');

robot.rotation = { y: 0.8 };
robot.getAbsolutePosition = () => new Vector3(0.5, 0.8, 0.3);
robot.computeWorldMatrix = () => {};
const transferStart = handSource.indexOf('  function transferDraftGrab(');
const transferEnd = handSource.indexOf('  function beginFormationPull(', transferStart);
assert.ok(transferStart >= 0 && transferEnd > transferStart);
Object.assign(nearContext, {
  handPlacementDrafts: new Set(),
  placementDrafts: new Map(),
  marcherPinchHands: new Set(),
  formationPull: null,
  handTracking: null,
});
vm.runInContext(transform(handSource.slice(transferStart, transferEnd)), nearContext);
for (const sourceType of ['hand', 'controller']) {
  for (let part = 0; part < meshes.length; part++) {
    const grab = { robot, source: sourceType, offset: Vector3.Zero(),
      originalPosition: new Vector3(1, 2, 3), originalRotationY: 0.2,
      ghost: {}, recordMove() {}, originalRenderingGroup: 2 };
    nearContext.marcherGrabs.clear();
    nearContext.marcherGrabs.set('left', grab);
    nearContext.handPlacementDrafts.add(robot);
    nearContext.marcherPinchHands.add('left');
    const point = new Vector3(part * 0.2, 0.05, 0);
    assert.equal(nearContext.transferDraftGrab('right', point, sourceType, 1.2), true,
      'New draft transfers from contact with any body/instrument part');
    assert.equal(nearContext.marcherGrabs.has('left'), false, 'Old hand cannot move or release the draft');
    assert.equal(nearContext.marcherGrabs.get('right'), grab, 'Transfer retains cancellation and rendering state');
    assert.ok(point.add(grab.offset).equalsWithEpsilon(robot.getAbsolutePosition()),
      'Reanchoring at the new contact does not jump the marcher');
    assert.equal(grab.initialFacingYaw, 1.2);
    assert.equal(grab.initialRotationY, robot.rotation.y);
    assert.equal(grab.originalRotationY, 0.2, 'Cancellation still restores the original pose');
    assert.equal(nearContext.marcherPinchHands.has('left'), false);
    nearContext.handPlacementDrafts.clear();
    assert.equal(nearContext.transferDraftGrab('left', point, sourceType, 0), sourceType === 'hand',
      'Tracked hands transfer placed marchers; controllers retain formation pulling');
    if (sourceType === 'hand') {
      nearContext.marcherGrabs.delete('left');
      nearContext.marcherGrabs.set('right', grab);
    }
    nearContext.handPlacementDrafts.add(robot);
    assert.equal(nearContext.transferDraftGrab('left', new Vector3(4, 0, 0), sourceType, 0), false,
      'The receiving hand must touch the draft');
    nearContext.formationPull = {};
    assert.equal(nearContext.transferDraftGrab('left', point, sourceType, 0), false,
      'An active formation pull cannot be stolen');
    nearContext.formationPull = null;
  }
}

let grip = true;
let near = robot;
let rayHit = false;
let begun;
let moved;
let committed = false;
let stickY = 0;
let stickX = 0;
let deltaTime = 100;
let scale = 1;
let painting = false;
let nearPaletteHit = null;
let paletteGrab;
let draftingTableActive = false;
const gripPoint = new Vector3(0.2, 0.8, 0.4);
const direction = Vector3.Forward();
const controller = { inputSource: {}, grip: {
  getAbsolutePosition: () => gripPoint, computeWorldMatrix() {},
}, motionController: { getComponentOfType: () => ({ axes: { x: stickX, y: stickY } }) } };
const context = vm.createContext({
  controller, handedness: 'left', Vector3,
  gripHeld: new Map(), triggerHeld: new Map(), marcherGrabs: new Map(),
  padGrabButtons: new Map(), menuInteractionHeld: new Map(),
  eraseMode: false,
  isMarcherPainting: () => painting,
  isDraftingTableMode: () => draftingTableActive,
  SCRUB_DEADZONE: 0.2, GRAB_DEPTH_BASE_SPEED: 6, GRAB_DEPTH_TELESCOPE_RATE: 2.5, getARScale: () => scale,
  isGripPressed: () => grip, getTriggerPressed: () => false,
  isFloatingPanelGrabbed: () => false, getFloatingPanelNear: () => null,
  getFloatingPanelButtonNearPoint: () => nearPaletteHit, getHandMenuHitNearPoint: () => null,
  pickMenuControl: () => null, getHandMenuHit: () => null,
  pickFloatingPanel: () => null, getControllerPosition: value => value.grip,
  getControllerRay: () => ({ origin: Vector3.Zero(), direction }),
  scene: {
    getEngine: () => ({ getDeltaTime: () => deltaTime }),
    pickWithRay: () => rayHit ? { hit: true, pickedMesh: meshes[0], pickedPoint: new Vector3(0, 0, 2) } : null,
  },
  findRobotRoot: () => robot,
  handInteraction: {
    transferDraftGrab: () => false,
    grabPaletteMarcher: (...args) => {
      if (args[1]?.action !== 'createMarcher') return false;
      paletteGrab = args;
      return true;
    },
    findMarcherNearHand: () => near, getFacingYaw: () => 0,
    beginControllerFormationPull: () => false,
    updateControllerFormationPull: () => false,
  },
  beginMarcherGrab(...args) { begun = args; },
  moveMarcherGrab(...args) { moved = args; },
  finishMarcherGrab(hand, commit) { committed = hand === 'left' && commit; },
});
const start = source.indexOf('    const gripPressed = isGripPressed(controller);',
  source.indexOf('export function updateRobotPathFromControllers'));
const end = source.indexOf('    if (!isPressed && wasPressed && tempoControllerDrags.delete', start);
assert.ok(start >= 0 && end > start);
vm.runInContext(transform(`function update() {\n${source.slice(start, end)}\n}`), context);
const axesStart = source.indexOf('function getThumbstickAxes(');
const axesSource = source.slice(axesStart);
const axesEnd = axesSource.match(/\r?\n}\r?\n/);
vm.runInContext(transform(axesSource.slice(0, axesEnd.index + axesEnd[0].length)), context);
let panelHeld = false, panelUpdates = 0, panelEnds = 0;
let panelNear = true;
const panelMesh = {};
Object.assign(context, {
  isFloatingPanelGrabbed: () => panelHeld,
  getFloatingPanelNear: () => panelNear ? {} : null,
  pickFloatingPanel: () => panelNear ? null : { hit: true, pickedMesh: panelMesh, pickedPoint: gripPoint },
  beginFloatingPanelGrab(...args) {
    assert.equal(args[5], true, 'Grip moves panels instead of activating sliders');
    panelHeld = true;
  },
  updateFloatingPanelGrab() { panelUpdates++; },
  endFloatingPanelGrab() { panelHeld = false; panelEnds++; },
  telescopeFloatingPanelGrab() {},
  PANEL_GRAB_DEPTH_SPEED: 1,
});
context.menuInteractionHeld.set('left', true);
context.update();
assert.ok(panelHeld, 'Grip starts a panel grab even after a menu trigger action');
assert.equal(context.padGrabButtons.get('left'), 'grip');
context.update(); assert.equal(panelUpdates, 1, 'Holding grip updates the panel');
grip = false; context.update(); assert.equal(panelEnds, 1, 'Releasing grip drops the panel');
panelNear = false; grip = true; context.update();
assert.ok(panelHeld, 'Pointing and gripping also grabs the panel');
grip = false; context.update();
context.menuInteractionHeld.clear();
Object.assign(context, {
  isFloatingPanelGrabbed: () => false, getFloatingPanelNear: () => null, pickFloatingPanel: () => null,
});
grip = true; context.gripHeld.clear();
nearPaletteHit = { action: 'createMarcher', instrument: 'trumpet' };
context.update();
assert.equal(begun, undefined, 'Gripping an instrument button does not grab a nearby marcher');
assert.equal(paletteGrab[1].instrument, 'trumpet', 'Grip on an instrument button pulls out that instrument');
assert.equal(paletteGrab[2], gripPoint, 'Palette marcher starts in the physical grip');
assert.equal(paletteGrab[3], 'controller');
assert.equal(paletteGrab[4], -1, 'Palette marcher uses a near grab so the thumbstick telescopes it');
nearPaletteHit = null;
grip = false; context.update(); grip = true;
draftingTableActive = true;
context.gripHeld.clear(); context.update();
assert.equal(begun, undefined, 'Drafting-table mode prevents ordinary marcher grabs');
draftingTableActive = false;
grip = false; context.update(); grip = true;
context.gripHeld.clear();
context.update();
assert.equal(begun[1], robot);
assert.equal(begun[2], gripPoint, 'Near grab anchors at the physical grip, not the aim ray');
assert.equal(begun[4], -1);
begun = undefined;
context.update();
assert.equal(begun, undefined, 'Holding grip never repeatedly begins grabs');
grip = false; context.update();
painting = true; grip = true; context.update();
assert.equal(begun, undefined, 'Painting cannot begin a marcher grab or formation pull');
painting = false;
context.marcherGrabs.set('left', { source: 'controller', rayDistance: -1 });
context.update();
assert.ok(moved[1].equals(gripPoint), 'Near-held marcher follows the physical controller');
stickY = -1;
context.update();
assert.ok(moved[1].equalsWithEpsilon(gripPoint.add(new Vector3(0, 0, 0.6))), 'Forward stick extends near grab at the faster base speed');
stickY = 1;
context.update();
assert.ok(moved[1].equalsWithEpsilon(gripPoint), 'Backward stick retracts near grab');
context.update();
assert.ok(moved[1].equalsWithEpsilon(gripPoint), 'Near grab cannot retract behind the controller');
stickY = 0;
grip = false;
context.update();
assert.equal(committed, true, 'Grip release commits placement');
context.marcherGrabs.clear();
near = null;
rayHit = true;
grip = true;
context.update();
assert.equal(begun[1], robot, 'Grip can also grab any marcher mesh at a distance');
assert.equal(begun[4], 2, 'Remote grab preserves picked distance');
context.marcherGrabs.set('left', { source: 'controller', rayDistance: 2 });
context.update();
assert.ok(moved[1].equals(new Vector3(0, 0, 2)), 'Remote grip follows the aim ray at fixed depth');
stickY = -1;
context.update();
assert.ok(moved[1].equalsWithEpsilon(new Vector3(0, 0, 3.1)), 'Forward stick telescopes ray grab farther with reach');
stickY = 0.1;
context.update();
assert.ok(moved[1].equalsWithEpsilon(new Vector3(0, 0, 3.1)), 'Deadzone prevents drift');
stickY = 1;
deltaTime = 50;
context.update();
assert.ok(moved[1].equalsWithEpsilon(new Vector3(0, 0, 2.4125)), 'Depth speed is frame-time based');
scale = 0.1;
context.update();
assert.ok(moved[1].equalsWithEpsilon(new Vector3(0, 0, 2.0809375)), 'Tabletop base depth speed follows scene scale');
scale = 1;
deltaTime = 100;
context.marcherGrabs.get('left').rayDistance = 0.15;
context.update();
assert.equal(context.marcherGrabs.get('left').rayDistance, 0.1, 'Ray grab cannot move behind the controller');
controller.motionController = null;
controller.inputSource.gamepad = { axes: [0, 0, 0, -1] };
context.update();
assert.ok(Math.abs(context.marcherGrabs.get('left').rayDistance - 0.725) < 1e-9, 'Raw XR thumbstick axes remain supported');
controller.inputSource.gamepad.axes = [];
context.update();
assert.ok(Math.abs(context.marcherGrabs.get('left').rayDistance - 0.725) < 1e-9, 'Missing axes preserve depth');
controller.motionController = { getComponentOfType: () => ({ axes: { x: stickX, y: stickY } }) };
stickY = 0;
stickX = 1;
context.update();
assert.ok(Math.abs(moved[2] - Math.PI / 20) < 1e-9, 'Right stick turns facing clockwise');
stickX = 0.1;
context.update();
assert.ok(Math.abs(moved[2] - Math.PI / 20) < 1e-9, 'Turn deadzone preserves facing');
stickX = -1;
deltaTime = 50;
scale = 0.01;
context.update();
assert.ok(Math.abs(moved[2] - Math.PI / 40) < 1e-9, 'Left stick turns back at a time-based, scale-independent rate');
controller.motionController = null;
controller.inputSource.gamepad.axes = [-1, -1];
context.update();
assert.ok(Math.abs(moved[2]) < 1e-9, 'Raw two-axis sticks support turning and depth together');
assert.ok(moved[1].z > 0.725, 'Diagonal input also changes depth');

let committedFacing;
let allowed = true;
const commitContext = vm.createContext({
  tryManualMarcherPose: () => allowed,
  setRobotFacing: (target, yaw) => { committedFacing = { target, yaw }; },
});
const commitStart = handSource.indexOf('  function commitMarcherTwist(');
const commitEnd = handSource.indexOf('  function finishMarcherGrab(', commitStart);
vm.runInContext(transform(handSource.slice(commitStart, commitEnd)), commitContext);
const turnedGrab = { source: 'controller', robot: { position: Vector3.Zero() }, controllerYawOffset: 0.1 };
commitContext.commitMarcherTwist(turnedGrab, 0.1);
assert.equal(committedFacing.yaw, 0.1, 'Small intentional stick turns persist after release without the hand-twist threshold');
committedFacing = undefined;
allowed = false;
commitContext.commitMarcherTwist(turnedGrab, 1);
assert.equal(committedFacing, undefined, 'Collision-rejected facing is not committed');
allowed = true;
turnedGrab.controllerYawOffset = 0;
commitContext.commitMarcherTwist(turnedGrab, 1);
assert.equal(committedFacing, undefined, 'A controller grab without stick turning leaves scheduled facing unchanged');
const formationRobot = {
  getAbsolutePosition: () => new Vector3(1, 0, 1),
  rotation: { y: 0 },
};
const formationGrabs = new Map([['left', { robot: formationRobot, source: 'controller' }]]);
const formationContext = vm.createContext({
  performance: { now: () => 0 }, FORMATION_PULL_HOLD_MS: 500,
  Vector3, marcherGrabs: formationGrabs, marcherPinchHands: new Set(),
  otherHand: hand => hand === 'left' ? 'right' : 'left',
  findMarcherNearHand: () => formationRobot,
  highlightPendingMarcher() {},
});
vm.runInContext('let formationPull = null;', formationContext);
vm.runInContext(transform(handSource.slice(handSource.indexOf('  function beginFormationPull('),
  handSource.indexOf('  function getFormationPullControlPoints('))), formationContext);
vm.runInContext('function finishFormationShaping() { formationPull.shapedOffsets = []; }', formationContext);
assert.equal(formationContext.beginFormationPull('right', new Vector3(1, 0, 1), 'controller'), true,
  'Second controller grip on a held marcher starts a formation');
assert.equal(formationContext.beginFormationPull('right', Vector3.Zero(), 'controller'), false,
  'Holding/regrabbing never overwrites an active formation');
vm.runInContext('formationPull.activationTime = null;', formationContext);
const endpoint = new Vector3(4, 1, 2);
assert.equal(formationContext.updateControllerFormationPull('right', true, endpoint), true);
assert.ok(vm.runInContext('formationPull.endPoint', formationContext).equals(endpoint),
  'Pulling controller traces formation endpoint');
formationContext.updateControllerFormationPull('right', false, endpoint);
assert.ok(vm.runInContext('formationPull.shapedOffsets !== null', formationContext),
  'Releasing the pull grip finishes shaping');
formationContext.updateControllerFormationPull('left', false, Vector3.Zero());
assert.ok(vm.runInContext('formationPull.floating', formationContext),
  'Releasing the anchor leaves formation floating for Commit');
assert.equal(formationGrabs.has('left'), false);
assert.equal(formationContext.beginFormationPull('right', endpoint, 'controller', formationRobot), true,
  'Either controller can pick up a finished floating formation');
assert.equal(formationGrabs.get('right').robot, formationRobot);
assert.equal(vm.runInContext('formationPull.floating', formationContext), false);
formationContext.updateControllerFormationPull('right', false, endpoint);
assert.equal(vm.runInContext('formationPull.floating', formationContext), true);
vm.runInContext('formationPull = null;', formationContext);
formationGrabs.set('left', { robot: formationRobot, source: 'controller' });
assert.equal(formationContext.beginFormationPull('right', Vector3.Zero(), 'controller', {}), false,
  'A different ray-picked marcher never starts formation duplication');
console.log('Controller marcher grabs passed: all-part contact, ownership/handoff, grip edges, near/ray tracking, thumbstick depth/facing, deadzones, time/scale adjustment, raw axes, release, and collision-safe facing persistence.');
