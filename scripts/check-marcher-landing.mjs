import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const engine = new NullEngine();
const scene = new Scene(engine);
const root = new TransformNode('tabletop', scene);
const pathRoot = new TransformNode('paths', scene);
pathRoot.parent = root;
const field = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
field.parent = root;
field.position.y = -0.48;
const grabs = new Map(), drafts = new Set(), notices = [];
const guides = [];
let placed;
const context = vm.createContext({
  scene, Matrix, Quaternion, Vector3, Color3, Observable, Mesh, InstancedMesh,
  TransformNode, StandardMaterial, pathRoot, guides,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120,
  marcherGrabs: grabs, handPlacementDrafts: drafts, placementDrafts: new Map(),
  formationPull: null, fingerPath: null,
  GRABBED_MARCHER_RENDERING_GROUP: 2, TURF_PRECISION_SCALE: 0.35,
  MARCHER_TWIST_COMMIT_RADIANS: 20 * Math.PI / 180,
  getMarcherRenderingGroup: () => 0, setMarcherRenderingGroup() {},
  captureMarcherMove: () => () => {}, setRobotHeld() {}, selectRobot() {}, setRobotFacing() {}, setPlacedMarcherFacing() {},
  getRobotCounts: () => null, getSelectedRobot: () => null,
  robotPaths: new Map(), robotPathLines: new Map(), storedPaths: [],
  pathSegmentByRobot: new Map(), segments: [],
  rebuildFormationConnections() {},
  notifyPlacement: message => notices.push(message),
  placeRobot(robot, position) {
    placed = position.clone();
    robot.position.copyFrom(position);
    return Vector3.Zero();
  },
});
vm.runInContext(transform(read('robot/manualPlacement.ts')), context);
vm.runInContext(transform(read('robot/marcherGhost.ts')), context);
vm.runInContext(transform(read('interaction/guideMarcherLayout.ts')), context);
const tools = read('interaction/fieldDrawingTools.ts');
vm.runInContext(transform(section(tools, 'export function closestPointOnGuide(', 'function createFieldDrawingTools(')) +
  stripTypeScriptTypes(section(tools, '  function snapToNearby(', '  function disposeGuide('), { mode: 'transform' }) +
  '\nfunction getNearbyDrawingGuidePose(point) { return snapToNearby(point, 0.25); }', context);
const hand = read('interaction/handInteraction.ts');
vm.runInContext(stripTypeScriptTypes(
  section(hand, '  function beginMarcherGrab(', '  // Grabbing an instrument button') +
  section(hand, '  function restoreMarcherRendering(', '  function findMarcherNearHand('),
  { mode: 'transform' }), context);
const near = (a, b, label) => assert.ok(a.equalsWithEpsilon(b, 1e-4), `${label}: ${a} vs ${b}`);
function marcher(name, position) {
  const robot = new TransformNode(name, scene);
  robot.parent = pathRoot;
  robot.position.copyFrom(position);
  const body = MeshBuilder.CreateBox(`${name}-body`, { width: 0.08, height: 0.5, depth: 0.08 }, scene);
  body.parent = robot;
  body.position.y = 0.25;
  context.registerManualPlacementMarcher(robot, () => [body]);
  return robot;
}
function begin(robot, source = 'hand', draft = false) {
  if (draft) drafts.add(robot);
  const point = robot.computeWorldMatrix(true).getTranslation();
  context.beginMarcherGrab('left', robot, point, source, -1, 0);
  return grabs.get('left');
}
function move(robot, position, yaw = 0) {
  const point = Vector3.TransformCoordinates(position, pathRoot.computeWorldMatrix(true));
  context.moveMarcherGrab('left', point, yaw);
}
try {
  for (const scale of [1, 1 / 120, 4]) {
    root.scaling.setAll(scale);
    root.position.set(3, 0.8, -2);
    root.rotation.y = 0.7;
    for (const source of ['hand', 'controller']) {
      for (const draft of [false, true]) {
        const robot = marcher('held', new Vector3(0, 0.5, 0));
        const grab = begin(robot, source, draft);
        assert.equal(grab.landingGhost, undefined, 'No landing preview far above the ground');
        move(robot, new Vector3(2, -0.21, 3), 0.4);
        assert.ok(grab.landingGhost?.isEnabled(), 'Quarter-yard ground tolerance shows a landing ghost');
        near(grab.landingGhost.position, new Vector3(2, -0.46, 3), 'Preview projects feet to turf');
        assert.ok(Math.abs(grab.landingGhost.rotation.y - 0.4) < 1e-6, 'Landing ghost follows facing');
        assert.ok(grab.landingGhost.getChildMeshes().length > 0, 'Preview contains actual marcher geometry');
        assert.ok(grab.landingGhost.getChildMeshes().every(mesh => !mesh.isPickable && !mesh.checkCollisions));
        if (!draft) near(grab.ghost.position, Vector3.Zero(), 'Original-position ghost is not moved');
        const expected = grab.landingGhost.position.clone();
        const ghost = grab.landingGhost;
        context.finishMarcherGrab('left', true);
        near(placed, expected, 'Release uses the exact preview target');
        assert.equal(ghost.isDisposed(), true, 'Release disposes landing preview');
        robot.dispose();
      }
    }
  }
  root.scaling.setAll(1);
  root.rotation.y = 0;
  root.position.setAll(0);
  const robot = marcher('guideHeld', new Vector3(0, 0.5, 0));
  let grab = begin(robot);
  guides.push({ points: [new Vector3(-5, 0, 0), new Vector3(5, 0, 0)],
    options: { spacing: 1, facing: 'fixed', facingAngle: 90 } });
  move(robot, new Vector3(1, -0.25, 0.2));
  near(grab.landingGhost.position, new Vector3(1, -0.46, 0), 'Nearby unselected guide attracts preview');
  assert.ok(Math.abs(grab.landingGhost.rotation.y - Math.PI / 2) < 1e-6, 'Preview uses configured guide facing');
  context.finishMarcherGrab('left', true);
  near(placed, new Vector3(1, -0.46, 0), 'Guide-snapped release matches preview');
  assert.ok(Math.abs(robot.rotation.y - Math.PI / 2) < 1e-6, 'Release applies configured guide facing');
  grab = begin(robot);
  move(robot, new Vector3(1, -0.25, 0.3));
  near(grab.landingGhost.position, new Vector3(1, -0.46, 0.3), 'Farther than 0.25 yards releases freely');
  move(robot, new Vector3(1, -0.25, 0.2));
  const obstacle = marcher('obstacle', new Vector3(1, -0.46, 0));
  context.updateMarcherLandingGhost(grab);
  near(grab.landingGhost.position, new Vector3(1, -0.46, 0.2), 'Blocked guide falls back to clear ground');
  context.finishMarcherGrab('left', true);
  near(placed, new Vector3(1, -0.46, 0.2), 'Blocked guide release matches ground fallback preview');
  assert.ok(notices.some(message => message.includes('Guide snap blocked')));
  robot.dispose();
  obstacle.dispose();
  guides.length = 0;
  const blocked = marcher('blockedLanding', new Vector3(2, -0.25, 0));
  const blocking = marcher('groundObstacle', new Vector3(2, -0.46, 0));
  const blockedGrab = begin(blocked, 'hand', true);
  assert.equal(blockedGrab.landingGhost, undefined, 'Blocked ground landing shows no preview');
  context.finishMarcherGrab('left', true);
  assert.equal(blocked.isDisposed(), true, 'Blocked draft is not committed');
  blocking.dispose();
  for (const y of [-0.209, -0.711]) {
    const outside = marcher('outside', new Vector3(0, y, 0));
    const held = begin(outside, 'hand', true);
    assert.equal(held.landingGhost, undefined, 'Above/below ground tolerance shows no ghost');
    context.finishMarcherGrab('left', true);
    assert.equal(outside.isDisposed(), true, 'Invalid new draft release is discarded');
  }
  const cancelled = marcher('cancelled', new Vector3(0, -0.46, 0));
  const held = begin(cancelled);
  const ghost = held.landingGhost;
  move(cancelled, new Vector3(30, -0.25, 0));
  assert.equal(ghost.isEnabled(), false, 'Moving beyond field bounds hides landing ghost');
  move(cancelled, new Vector3(0, 0.5, 0));
  assert.equal(ghost.isEnabled(), false, 'Lifting away hides landing ghost');
  context.finishMarcherGrab('left', false);
  assert.equal(ghost.isDisposed(), true, 'Cancellation disposes preview');
  near(cancelled.position, new Vector3(0, -0.46, 0), 'Cancellation restores original pose');
  cancelled.dispose();
  console.log('Marcher landing passed: hand/controller and new/existing grabs, scale-aware tolerance, exact preview/release parity, facing, nearby guides, collision fallback, bounds, lifting, cancellation, and cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
