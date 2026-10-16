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

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const fieldRoot = new TransformNode('fieldRoot', scene);
fieldRoot.scaling.setAll(0.04);
fieldRoot.rotation.set(0.2, 0.5, -0.1);
const robots = [0, 1].map(index => {
  const robot = new TransformNode(`robot${index}`, scene);
  robot.parent = fieldRoot;
  robot.position.set(index * 2, 0.02, 3);
  const mesh = MeshBuilder.CreateBox(`body${index}`, {}, scene);
  mesh.parent = robot; mesh.position.y = 1;
  return robot;
});
const counts = robots.map(robot => [
  { position: robot.position.clone(), rotationY: Math.PI - 0.1 },
  { position: robot.position.add(new Vector3(4, 0, 2)), rotationY: -Math.PI + 0.1 },
]);
const context = vm.createContext({
  scene, Mesh, InstancedMesh, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Color3,
});
vm.runInContext(transform(read('../src/robot/marcherGhost.ts')), context);
vm.runInContext(transform(read('../src/robot/ghostBandPreview.ts')), context);
vm.runInContext('this.Preview = GhostBandPreview;', context);
try {
  const preview = new context.Preview(robots);
  const ghosts = () => scene.transformNodes.filter(node => node.name === 'ghostBandMarcher');
  assert.equal(ghosts().length, 2);
  const realPoses = robots.map(robot => robot.computeWorldMatrix(true).clone());
  robots.forEach((robot, index) => preview.update(robot, counts[index], 0.5));
  ghosts().forEach((ghost, index) => {
    assert.ok(ghost.position.equalsWithEpsilon(counts[index][0].position.add(new Vector3(2, 0, 1))));
    assert.ok(Math.abs(Math.abs(ghost.rotationQuaternion.toEulerAngles().y) - Math.PI) < 1e-6,
      'Facing follows the shortest arc across +/- pi');
    assert.equal(ghost.getChildMeshes()[0].isPickable, true);
    assert.equal(preview.owns(ghost.getChildMeshes()[0]), true);
    assert.equal(preview.owns(robots[index].getChildMeshes()[0]), false);
    assert.ok(robots[index].computeWorldMatrix(true).equals(realPoses[index]), 'Real band remains frozen');
  });
  preview.update(robots[0], counts[0], 100);
  assert.ok(ghosts()[0].position.equals(counts[0][1].position), 'Short routes hold their last count');
  preview.update(robots[0], counts[0], -10);
  assert.ok(ghosts()[0].position.equals(counts[0][0].position));
  preview.dispose();
  assert.equal(ghosts().length, 0);

  let beat = 2.5;
  let playing = true;
  const source = read('../src/robot/robot.ts');
  Object.assign(context, {
    allRobots: robots,
    getDrillTransportState: () => ({ beat }),
    pauseAll: () => { playing = false; },
    setDrillBeatPosition: value => { beat = value; },
    applyGlobalCountToAllRobots() {},
    notifyDrillTransport() {},
    globalPlayback: { countIndex: 2 },
    seekToCount: value => { beat = value; context.globalPlayback.countIndex = value; },
  });
  vm.runInContext(transform(source.slice(source.indexOf('let ghostBandPreview:'),
    source.indexOf('let sharedScene:'))), context);
  vm.runInContext('let repeatElapsed = null;', context);
  vm.runInContext(transform(source.slice(source.indexOf('export function scrubBy('),
    source.indexOf('export function getGlobalCountIndex('))), context);
  context.jogGhostBandBy(0);
  assert.equal(context.isGhostBandPreviewEnabled(), false, 'Neutral sticks never activate preview');
  context.jogGhostBandBy(1);
  assert.equal(context.isGhostBandPreviewEnabled(), true, 'Jogging automatically enables ghosts');
  assert.equal(playing, false);
  assert.equal(context.getGhostBandAnchorBeat(), 2.5, 'Entry captures a fractional paused reference count');
  context.jogGhostBandBy(1);
  assert.equal(context.getGhostBandAnchorBeat(), 2.5, 'Repeated jogs never recapture the reference count');
  const target = ghosts()[0].getChildMeshes()[0];
  const previewBeat = beat;
  assert.equal(context.jumpToGhostBandTime(robots[0].getChildMeshes()[0]), false);
  assert.equal(context.jumpToGhostBandTime(target), true);
  assert.equal(beat, previewBeat, 'Triggering a ghost commits the preview count instead of the reference count');
  assert.equal(playing, false);
  assert.equal(ghosts().length, 0);
  assert.equal(context.jumpToGhostBandTime(target), false, 'Disposed ghost cannot activate again');
  beat = 2.5;
  context.setGhostBandPreviewEnabled(true);
  beat = 6;
  context.setGhostBandPreviewEnabled(false);
  assert.equal(beat, 2.5, 'Exit restores the reference timeline count');
  assert.equal(playing, false);
  assert.equal(ghosts().length, 0);
  console.log('Ghost band preview passed: frozen real band, interpolated ghost positions/facing, rotated/scaled fields, short routes, automatic jog entry, stable reference count and exit cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
