import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const extract = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
const engine = new NullEngine();
const scene = new Scene(engine);
try {
  let clears = 0;
  const context = vm.createContext({
    Mesh, StandardMaterial, Color3, scene,
    pathRoot: new TransformNode('paths', scene),
    clearStepHandles: () => { clears++; },
    selectedRobot: {},
    pathsHiddenByFieldClick: false,
  });
  const code = [
    extract('function createTubeLine(', 'function setTubeLineAppearance('),
    extract('function refreshStepHandles()', 'showAllPathsToggle?.addEventListener'),
    extract('function createSegmentHandle(', 'function syncSegmentPointHandles('),
    extract('function updateSegmentHandleVisibility(', 'function getSegmentCenter('),
  ].join('\n');
  vm.runInContext(stripTypeScriptTypes(code, { mode: 'transform' }), context);
  const points = [Vector3.Zero(), new Vector3(4, 0, 3)];
  for (const name of ['robotPathLine', 'segmentLine']) {
    const line = context.createTubeLine(name, points, Color3.White());
    for (const enabled of [true, false, true]) {
      line.setEnabled(enabled);
      assert.equal(line.getTotalVertices(), 0, 'No route tube geometry is allocated');
      assert.equal(line.isVisible, false);
      assert.equal(line.isPickable, false, 'Routes cannot intercept controller or pointer picks');
    }
  }
  const handles = ['segmentMoveHandle', 'segmentPointHandle', 'segmentRotationHandle', 'segmentCopyHandle']
    .map(name => context.createSegmentHandle(name, 0.3, Color3.White()));
  context.updateSegmentHandleVisibility({
    moveHandle: handles[0], pointHandles: [handles[1]], rotationHandles: [handles[2]], copyHandle: handles[3],
  });
  for (const handle of handles) {
    assert.equal(handle.getTotalVertices(), 0);
    assert.equal(handle.isVisible, false);
    assert.equal(handle.isPickable, false);
    assert.equal(handle.isEnabled(), false);
  }
  const count = scene.meshes.length;
  context.refreshStepHandles();
  assert.equal(clears, 1);
  assert.equal(scene.meshes.length, count, 'Selecting marchers creates no step handles');
  console.log('Path visuals removed: no tube/handle geometry or picking, no step handles, and updates stay invisible.');
} finally {
  scene.dispose();
  engine.dispose();
}
