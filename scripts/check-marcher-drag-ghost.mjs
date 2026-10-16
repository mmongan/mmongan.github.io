import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const pathRoot = new TransformNode('pathRoot', scene);
const field = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
field.parent = pathRoot;
const robot = new TransformNode('pathRobot', scene);
robot.parent = pathRoot;
robot.position.set(2, 0.02, 3);
const template = MeshBuilder.CreateBox('template', {}, scene);
template.isVisible = false;
const body = template.createInstance('body');
body.parent = robot;
body.position.y = 1;
const originalMaterial = new StandardMaterial('original', scene);
template.material = originalMaterial;
const notices = [];
let placements = 0;
let reject = false;
let recordedMoves = 0;
const context = vm.createContext({
  scene, Mesh, InstancedMesh, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120,
  floorCalibrationToggle: { checked: false },
  getMarcherRenderingGroup: () => 0, setMarcherRenderingGroup() {}, setRobotHeld() {},
  tryManualMarcherPose: (node, position, yaw = node.rotation.y, validate = true) => {
    if (reject && validate) return false;
    node.position.copyFrom(position); node.rotation.y = yaw; return true;
  },
  placeRobot: () => { placements++; return Vector3.Zero(); },
  getRobotCounts: () => null,
});
for (const file of ['robot/marcherGhost', 'interaction/handInteraction']) {
  const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '').replace(/export /g, '');
  vm.runInContext(code, context);
}
const drafts = new Map();
const interaction = context.createHandInteraction({
  pathRoot, robotPaths: new Map(), robotPathLines: new Map(), storedPaths: [],
  pathSegmentByRobot: new Map(), segments: [], placementDrafts: drafts,
  selectRobot() {}, getSelectedRobot: () => null,
  rebuildFormationConnections() {},
  notifyPlacement: message => notices.push(message),
  captureMarcherMove: () => () => { recordedMoves++; },
});
const begin = source => interaction.beginMarcherGrab('left', robot, Vector3.Zero(), source);
const ghosts = () => scene.transformNodes.filter(node => node.name === 'marcherDragGhost');
try {
  for (const scale of [1, 0.05]) {
    pathRoot.scaling.setAll(scale);
    pathRoot.rotation.set(0.3, 0.4, -0.2);
    pathRoot.position.set(4, 1, -2);
    for (const source of ['hand', 'controller']) {
      robot.position.set(2, 0.02, 3);
      begin(source);
      assert.equal(ghosts().length, 1);
      const ghost = ghosts()[0];
      const part = ghost.getChildMeshes()[0];
      assert.ok(part instanceof Mesh && !(part instanceof InstancedMesh));
      assert.equal(part.isPickable, false);
      assert.equal(part.material.alpha, 0.28);
      const frozen = part.computeWorldMatrix(true).clone();
      interaction.moveMarcherGrab('left', Vector3.TransformCoordinates(
        new Vector3(8, 2, 9), pathRoot.computeWorldMatrix(true)));
      assert.ok(part.computeWorldMatrix(true).equals(frozen), 'Ghost stays at the pickup pose');
      interaction.finishMarcherGrab('left', true);
      assert.equal(placements, 0, 'Airborne release must not commit');
      assert.equal(recordedMoves, 0, 'Cancelled moves do not enter history');
      assert.ok(robot.position.equals(new Vector3(2, 0.02, 3)));
      assert.equal(ghosts().length, 0);
      assert.ok(notices.at(-1).includes('touching the turf'));
      begin(source);
      robot.position.set(8, 0.02, 9);
      interaction.finishMarcherGrab('left', true);
      assert.equal(ghosts().length, 0);
      assert.ok(robot.position.equalsWithEpsilon(new Vector3(8, 0.02, 9)));
      assert.equal(placements, 1, 'Turf contact commits at full and tabletop scale');
      assert.equal(recordedMoves, 1, 'Committed moves enter history once');
      recordedMoves = 0;
      placements = 0;
      begin(source);
      robot.position.y = -1;
      interaction.finishMarcherGrab('left', true);
      assert.equal(placements, 0, 'Below-turf release also cancels');
      begin(source);
      interaction.finishMarcherGrab('left', false);
      assert.equal(ghosts().length, 0, 'Cancellation cleans up the ghost');
    }
  }
  for (const scale of [1, 0.05]) {
    pathRoot.scaling.setAll(scale);
    robot.position.set(2, 0.02, 3);
    begin('controller');
    robot.position.y = 0.069;
    interaction.finishMarcherGrab('left', true);
    assert.equal(placements, 1, 'A 4.9 cm field-local gap is within turf contact tolerance');
    placements = 0; recordedMoves = 0;
    begin('controller');
    robot.position.y = 0.071;
    interaction.finishMarcherGrab('left', true);
    assert.equal(placements, 0, 'A 5.1 cm field-local gap exceeds scaled turf contact tolerance');
    assert.equal(recordedMoves, 0);
    begin('controller');
    robot.position.set(30, 0.02, 3);
    interaction.finishMarcherGrab('left', true);
    assert.equal(placements, 0, 'Dropping outside the turf cancels instead of clamping onto the field');
  }
  begin('controller');
  reject = true;
  interaction.finishMarcherGrab('left', true);
  assert.equal(ghosts().length, 0, 'Rejected placement cleans up the ghost');
  reject = false;
  drafts.set('left', robot);
  begin('controller');
  assert.equal(ghosts().length, 0, 'New placement drafts do not leave origin ghosts');
  interaction.finishMarcherGrab('left', false);
  drafts.clear();
  begin('controller');
  robot.dispose();
  assert.equal(ghosts().length, 0, 'Deleting the source disposes its ghost');
  interaction.moveMarcherGrab('left', Vector3.Zero());
  assert.equal(interaction.marcherGrabs.size, 0);
  assert.ok(scene.materials.includes(originalMaterial), 'Ghost cleanup preserves original materials');
  console.log('Marcher drag ghost/turf checks passed: frozen instanced body snapshots, hand/controller moves, turf-only commit, airborne/below-turf cancellation, rotated tabletop fields, draft exclusion, rejection and deletion cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
