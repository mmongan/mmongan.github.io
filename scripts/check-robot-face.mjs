import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const context = vm.createContext({ Scene, Mesh, VertexData, StandardMaterial, Color3, Color4, Vector3 });
const load = (file, exports) => vm.runInContext(`(() => {
${stripTypeScriptTypes(readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '')}
return { ${exports} };
})()`, context);
Object.assign(context, load('lowPolyInstrument', 'InstrumentGeometry, cachedInstrumentTemplate, buildLowPolyTemplate'));
const face = load('robotFaceModel', 'addRobotHead, getRobotEyesTemplate');
context.addRobotHead = face.addRobotHead;
const heads = vm.runInContext(`cachedInstrumentTemplate(scene => {
  const geometry = new InstrumentGeometry();
  addRobotHead(geometry);
  return buildLowPolyTemplate('headTest', geometry, new StandardMaterial('headTestMaterial', scene), scene);
})`, context);
try {
  const counts = [];
  for (const detail of ['high', 'low']) {
    const head = heads(scene, detail);
    const eyes = face.getRobotEyesTemplate(scene, detail);
    for (const mesh of [head, eyes]) {
      const positions = mesh.getVerticesData('position');
      assert.ok(positions.every(Number.isFinite));
      assert.ok(mesh.getVerticesData('normal').every(Number.isFinite));
      assert.ok(mesh.getIndices().every(index => index >= 0 && index < positions.length / 3));
      assert.equal(mesh.isPickable, false);
      assert.equal(mesh.isEnabled(), false);
    }
    const positions = head.getVerticesData('position');
    const skinColors = head.getVerticesData('color');
    assert.ok(skinColors[0] > skinColors[1] && skinColors[1] > skinColors[2],
      'Head has warm human skin instead of a silver robot shell');
    const nose = [];
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i]) <= .019 && positions[i + 1] >= 1.225 &&
        positions[i + 1] <= 1.281) nose.push(positions[i + 2]);
    }
    assert.ok(nose.some(z => z > (detail === 'high' ? .17 : .13)), `${detail}: nose projects from face`);
    assert.equal(eyes.material.disableLighting, false, 'Eyes are shaded instead of glowing');
    const colors = eyes.getVerticesData('color');
    assert.ok(colors.some(value => value < .1), 'Eyes include dark pupils');
    assert.equal(face.getRobotEyesTemplate(scene, detail), eyes, 'Eye geometry is shared');
    assert.ok(head.getTotalVertices() < 500, `${detail}: head stays within a small vertex budget`);
    counts.push(head.getTotalVertices());
  }
  assert.ok(counts[1] < counts[0], 'Low-detail heads use fewer vertices');
  console.log(`Robot faces passed: humanoid nose, separate shaded eyes, shared templates, valid geometry (${counts.join('/')} vertices high/low).`);
} finally {
  scene.dispose();
  engine.dispose();
}
