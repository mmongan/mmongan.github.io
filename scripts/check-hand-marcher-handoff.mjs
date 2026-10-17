import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Axis } from '@babylonjs/core/Maths/math.axis.js';

const source = readFileSync(new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const engine = new NullEngine();
const scene = new Scene(engine);
const field = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
const ground = MeshBuilder.CreateGround('outerBase', { width: 75, height: 136 }, scene);
const pathRoot = new TransformNode('paths', scene);
const root = new TransformNode('tabletop', scene);
field.parent = ground.parent = pathRoot.parent = root;
field.position.y = -0.48;
const grabs = new Map();
const pinches = new Map();
const hands = new Map();
const drafts = new Set();
const robots = new Set();
let releases = 0;
let creations = 0;
let savedFacing;
let panelPicks = 0;
let paletteHit = null;
let chosenInstrument = null;
const context = vm.createContext({
  scene, pathRoot, Vector3, Matrix, Ray, Axis,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120,
  marcherGrabs: grabs, handPinches: pinches, handPlacementDrafts: drafts,
  placementDrafts: new Map(), marcherPinchHands: new Set(),
  formationPull: null, fingerPath: null, sceneGesture: null,
  padHands: new Set(), fingerPushes: new Set(),
  WebXRHandJoint: { WRIST: 'wrist', MIDDLE_FINGER_PHALANX_PROXIMAL: 'palm',
    THUMB_TIP: 'thumb', INDEX_FINGER_TIP: 'index' },
  handTracking: { getHandByHandedness: hand => hands.get(hand) },
  findRobotRoot: mesh => robots.has(mesh.parent) ? mesh.parent : null,
  getHandFacingYaw: hand => hand === 'left' ? 0.3 : -0.6,
  getMarcherRenderingGroup: () => 0, setMarcherRenderingGroup() {},
  GRABBED_MARCHER_RENDERING_GROUP: 2,
  captureMarcherMove: () => () => {}, createMarcherDragGhost: () => ({ dispose() {} }),
  setRobotHeld() {}, selectRobot() {},
  tryManualMarcherPose: (robot, position, yaw) => {
    robot.position.copyFrom(position);
    robot.rotation.y = yaw;
    robot.computeWorldMatrix(true);
    return true;
  },
  finishMarcherGrab(hand) {
    releases++;
    grabs.delete(hand);
  },
  finishFingerPush() {}, activateHandMenuAtPoint: () => false,
  isFloatingPanelGrabbed: () => false,
  pickFloatingPanel: () => { panelPicks++; return null; },
  getFloatingPanelNear: () => null, pickMenuControl: () => null,
  getFloatingPanelButtonNearPoint: () => null,
  getHandMenuHitNearPoint: () => paletteHit,
  selectNewMarcherInstrument(instrument) { chosenInstrument = instrument; },
  updateFormationPullPreview() {},
  MARCHER_TWIST_COMMIT_RADIANS: 20 * Math.PI / 180,
  TURF_PRECISION_SCALE: 0.35,
  selectDrawingGuideNear: () => false,
  getRobotCounts: () => [{ rotationY: 0 }, { rotationY: 0 }],
  getGlobalCountIndex: () => 0,
  setRobotFacing: (robot, yaw) => { savedFacing = yaw; },
  createStandingMarcher(position) {
    creations++;
    const robot = new TransformNode('marcher', scene);
    robot.parent = pathRoot;
    robot.position.copyFrom(position);
    const body = MeshBuilder.CreateBox('body', { size: 0.1 }, scene);
    body.parent = robot;
    body.position.y = 0.1;
    robots.add(robot);
    return robot;
  },
});
const loopStart = source.indexOf('    sceneGesture = null;\n    for (const handedness', source.indexOf('const pinchesOutsideField'));
const loopEnd = source.indexOf('    updateFormationPullPreview();', loopStart);
assert.ok(loopStart >= 0 && loopEnd > loopStart);
const functions = [
  section('  function beginMarcherGrab(', '  // A deliberate wrist twist'),
  section('  function grabPaletteMarcher(', '  function restoreMarcherRendering('),
  section('  function commitMarcherTwist(', '  function finishMarcherGrab('),
  section('  function findMarcherNearHand(', '  function getFormationFieldPoint('),
  section('  function getSidelineDraftPosition(', '  function isHandMarcherInteraction('),
  section('  function transferDraftGrab(', '  function beginFormationPull('),
  `function update() {
    const pinchedPoints = new Map();
    for (const [side, hand] of hands) {
      if (hand.closed) pinchedPoints.set(side, hand.point);
    }
    ${section('    // Pinches that start on a floating panel', "    const left = pinchedPoints.get('left');")}
    transferTrackedHandGrabs(pinchedPoints);
    ${source.slice(loopStart, loopEnd)}
  }`,
].join('\n');
context.hands = hands;
vm.runInContext(stripTypeScriptTypes(functions, { mode: 'transform' }), context);

const handAt = (point, closed = true) => {
  const hand = {
    point, closed,
    xrController: { pointer: {
      getAbsolutePosition: () => point, getDirection: () => Vector3.Forward(),
    } },
    getJointMesh: joint => ({
      getAbsolutePosition: () => joint === 'wrist' || joint === 'palm'
        ? hand.point.add(new Vector3(0, joint === 'wrist' ? -0.08 : -0.04, 0))
        : hand.point.add(new Vector3(
        joint === 'thumb' ? -0.005 : 0.005,
        hand.closed ? 0 : (joint === 'thumb' ? -0.04 : 0.04), 0
      )),
    }),
  };
  return hand;
};
const near = (a, b, label) => assert.ok(a.equalsWithEpsilon(b, 1e-4), `${label}: ${a.toString()} vs ${b.toString()}`);
try {
  for (const scale of [1, 1 / 120]) {
    root.scaling.setAll(scale);
    root.position.set(4, 0.9, -3);
    root.rotation.y = 0.8;
    for (const localPoint of [new Vector3(0, 40, 0), new Vector3(30, 80, 0)]) {
      scene.incrementRenderId();
      const point = Vector3.TransformCoordinates(localPoint, root.computeWorldMatrix(true));
      const position = context.getSidelineDraftPosition(point);
      near(position, new Vector3(localPoint.x, -0.46, localPoint.z),
        'Creation projects to ground level, preserving horizontal placement inside field or on sideline');
    }
    const outside = Vector3.TransformCoordinates(new Vector3(100, 1, 0), root.computeWorldMatrix(true));
    assert.equal(context.getSidelineDraftPosition(outside), null, 'Outside stadium does not create a draft');
  }
  root.scaling.setAll(1);
  root.position.setAll(0);
  root.rotation.setAll(0);
  for (const from of ['left', 'right']) {
    for (const target of ['marcher', 'wrist', 'palm', 'index']) {
      for (const draft of [false, true]) {
        for (const releaseTogether of [false, true]) {
          const to = from === 'left' ? 'right' : 'left';
          grabs.clear(); pinches.clear(); hands.clear(); drafts.clear();
          scene.incrementRenderId();
          const robot = context.createStandingMarcher(new Vector3(0, -0.46, 0));
          if (draft) drafts.add(robot);
          const originalPoint = new Vector3(0, target === 'marcher' ? -0.36 : 1.5, 0);
          context.beginMarcherGrab(from, robot, originalPoint, 'hand', 0, 0.3);
          const originalGrab = grabs.get(from);
          pinches.set(from, true);
          hands.set(from, handAt(originalPoint, !releaseTogether));
          const contact = target === 'marcher' ? new Vector3(0.03, -0.35, 0)
            : hands.get(from).getJointMesh(target).getAbsolutePosition().add(new Vector3(0.03, 0, 0));
          hands.set(to, handAt(contact));
          if (target !== 'marcher') {
            assert.equal(context.findMarcherNearHand(contact, from), null,
              'Hand-only contact does not touch any part of the marcher');
          }
          const position = robot.position.clone();
          const beforeReleases = releases;
          const beforeCreations = creations;
          const beforePanelPicks = panelPicks;
          context.update();
          assert.equal(panelPicks, beforePanelPicks, 'Hand contact takes priority over panel rays');
          assert.ok(grabs.get(to) === originalGrab, 'Transfers existing grab state to receiving hand');
          assert.equal(grabs.has(from), false, 'Previous hand no longer owns marcher');
          near(robot.position, position, 'Handoff does not jump position');
          assert.equal(robot.rotation.y, 0, 'Handoff does not jump facing');
          assert.equal(releases, beforeReleases, 'Same-frame release never drops or commits transferred marcher');
          assert.equal(creations, beforeCreations, 'Handoff does not create a duplicate');
          assert.equal(context.formationPull, null, 'Tracked-hand handoff never starts formation pulling');
          hands.get(to).point.x += 0.2;
          context.update();
          near(robot.position, position.add(new Vector3(0.2 * 0.35, 0, 0)),
            `Receiver moves marcher from new contact offset (${from}, ${draft}, ${releaseTogether}; pinches ${JSON.stringify([...pinches])})`);
          hands.get(from).closed = false;
          context.update();
          assert.ok(grabs.get(to) === originalGrab, 'Releasing previous hand does not affect receiver');
          hands.get(to).closed = false;
          context.update();
          assert.equal(releases, beforeReleases + 1, 'Only receiver release finishes placement');
          robot.dispose();
          robots.delete(robot);
        }
      }
    }
  }
  grabs.clear(); pinches.clear(); hands.clear(); drafts.clear();
  hands.set('left', handAt(new Vector3(0, 1.5, 0)));
  const wrist = hands.get('left').getJointMesh('wrist').getAbsolutePosition();
  assert.equal(context.isPointNearHoldingHand(wrist.add(new Vector3(0.0449, 0, 0)), 'left'), true,
    'Hand target includes the 4.5 cm contact margin');
  assert.equal(context.isPointNearHoldingHand(wrist.add(new Vector3(0.0451, 0, 0)), 'left'), false,
    'Distant pinches do not count as hand contact');
  assert.equal(context.isPointNearHoldingHand(wrist, 'right'), false, 'Missing hand cannot receive contact');
  grabs.clear(); pinches.clear(); hands.clear(); drafts.clear();
  hands.set('left', handAt(new Vector3(10, 1.5, 0)));
  context.update();
  const draft = grabs.get('left').robot;
  near(draft.position, new Vector3(10, -0.46, 0), 'Actual empty pinch creates marcher with feet at turf level');
  const createdAt = draft.position.clone();
  hands.get('left').point.x += 0.3;
  context.update();
  near(draft.position, createdAt.add(new Vector3(0.3 * 0.35, 0, 0)),
    'Feet on the turf scale hand motion for precise placement without a height jump');
  const precise = draft.position.clone();
  hands.get('left').point.y += 0.5;
  context.update();
  near(draft.position, precise.add(new Vector3(0, 0.5, 0)), 'Lifting off the turf does not snap to the hand');
  hands.get('left').point.x += 0.4;
  context.update();
  near(draft.position, precise.add(new Vector3(0.4, 0.5, 0)), 'Above the turf the marcher follows the hand 1:1');
  hands.get('left').point.y -= 0.5;
  context.update();
  hands.get('left').point.z += 0.2;
  context.update();
  near(draft.position, precise.add(new Vector3(0.4, 0, 0.2 * 0.35)), 'Touching down again re-enters precision mode');
  root.scaling.setAll(1 / 120);
  scene.incrementRenderId();
  const tablePoint = draft.getAbsolutePosition().clone();
  const tableStart = draft.position.clone();
  grabs.get('left').offset = Vector3.Zero();
  grabs.get('left').turfAnchor = undefined;
  hands.get('left').point.copyFrom(tablePoint);
  context.update();
  hands.get('left').point.x += 0.01;
  context.update();
  near(draft.position, tableStart.add(new Vector3(1.2 * 0.35, 0, 0)), 'Tabletop turf contact also uses precision scaling');
  root.scaling.setAll(1);
  context.commitMarcherTwist({
    robot: draft, source: 'hand', initialRotationY: 0.8, originalRotationY: 0,
  }, 0.8);
  assert.equal(savedFacing, 0.8, 'Deliberate facing changes made before handoff still persist on drop');
  grabs.clear(); pinches.clear(); hands.clear(); drafts.clear();
  const paletteButton = new Vector3(2, 1.3, 0.4);
  paletteHit = { action: 'createMarcher', instrument: 'sousaphone' };
  hands.set('right', handAt(paletteButton.clone()));
  const paletteCreations = creations;
  context.update();
  paletteHit = null;
  const paletteGrab = grabs.get('right');
  assert.equal(chosenInstrument, 'sousaphone', 'Palette pinch picks that instrument for the new marcher');
  assert.equal(creations, paletteCreations + 1, 'Palette pinch creates exactly one marcher');
  assert.ok(paletteGrab && drafts.has(paletteGrab.robot), 'New palette marcher is held as a discardable draft');
  near(paletteGrab.robot.getAbsolutePosition(), paletteButton, 'New marcher appears in the grab at the palette');
  hands.get('right').point.x += 0.25;
  context.update();
  near(paletteGrab.robot.getAbsolutePosition(), paletteButton.add(new Vector3(0.25, 0, 0)),
    'Palette marcher follows the pinching hand');
  assert.equal(creations, paletteCreations + 1, 'Holding the pinch never creates more marchers');
  const paletteReleases = releases;
  hands.get('right').closed = false;
  context.update();
  assert.equal(releases, paletteReleases + 1, 'Releasing the pinch drops the palette marcher');
  hands.set('left', handAt(new Vector3(-2, 1.3, 0.4)));
  paletteHit = { action: 'drillChartPad' };
  context.update();
  paletteHit = null;
  assert.equal(chosenInstrument, 'sousaphone', 'Non-instrument buttons never pick a palette instrument');
  console.log('Hand marcher checks passed: left/right draft and placed handoffs via model/wrist/palm/fingertip, panel priority, 4.5 cm contact margin, same-frame release, no jumps/duplicates, receiver ownership, ground-level creation, turf precision placement, tabletop transforms, and stadium bounds.');
} finally {
  scene.dispose();
  engine.dispose();
}
