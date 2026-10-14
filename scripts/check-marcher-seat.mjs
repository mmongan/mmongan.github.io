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
const context = vm.createContext({ Mesh, VertexData, StandardMaterial, Color3, Color4, Vector3 });
function load(file, names) {
  const source = readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8');
  return vm.runInContext(`(() => {
    ${stripTypeScriptTypes(source, { mode: 'transform' })
      .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
    return { ${names.join(', ')} };
  })()`, context);
}
Object.assign(context, load('lowPolyInstrument',
  ['InstrumentGeometry', 'cachedInstrumentTemplate', 'buildLowPolyTemplate']));
Object.assign(context, load('robotFaceModel', ['addRobotHead']));
const templates = load('marcherBodyModel', [
  'getMarcherTrimTemplate', 'getMarcherJacketTemplate', 'getMarcherUpperArmTemplate',
  'getMarcherForearmTemplate', 'getMarcherThighTemplate', 'getMarcherCalfTemplate',
  'getMarcherShoeTemplate', 'getMarcherGloveTemplate',
]);
const { getMarcherTrimTemplate } = templates;
try {
  for (const detail of ['high', 'low']) {
    for (const [name, template] of Object.entries(templates)) {
      const part = template(scene, detail);
      const vertices = part.getVerticesData('position');
      const normals = part.getVerticesData('normal');
      const indices = part.getIndices();
      assert.ok(vertices.length > 0 && vertices.every(Number.isFinite), `${name}: finite vertices`);
      assert.ok(normals.every(Number.isFinite), `${name}: finite normals`);
      assert.equal(normals.length, vertices.length);
      assert.ok(indices.every(i => i >= 0 && i < vertices.length / 3), `${name}: valid indices`);
      assert.equal(part, template(scene, detail), `${name}: shared cached template`);
    }
    for (const name of ['getMarcherUpperArmTemplate', 'getMarcherForearmTemplate',
      'getMarcherThighTemplate', 'getMarcherCalfTemplate']) {
      const part = templates[name](scene, detail);
      const vertices = part.getVerticesData('position');
      const bottom = Math.min(...vertices.filter((_, i) => i % 3 === 1));
      const top = Math.max(...vertices.filter((_, i) => i % 3 === 1));
      assert.ok(bottom < 0 && top > 0, `${name}: rounded ends enclose joint center`);
      assert.ok(part.getTotalVertices() <= 100, `${name}: bounded geometry for XR`);
    }
    const jacket = templates.getMarcherJacketTemplate(scene, detail).getVerticesData('position');
    const hem = [];
    for (let i = 0; i < jacket.length; i += 3) {
      if (jacket[i + 1] <= 0.61) hem.push(new Vector3(jacket[i], jacket[i + 1], jacket[i + 2]));
    }
    assert.ok(Math.min(...hem.map(p => p.y)) <= 0.48, `${detail}: jacket covers upper thighs`);
    assert.ok(Math.min(...hem.map(p => p.y)) > 0.4, `${detail}: jacket leaves knees visible`);
    assert.ok(Math.max(...hem.map(p => p.x)) > 0.2, `${detail}: hem clears both hip joints`);
    assert.ok(Math.min(...hem.map(p => p.z)) < -0.17 &&
      Math.max(...hem.map(p => p.z)) > 0.17, `${detail}: hem covers hip motion front and back`);
    const mesh = getMarcherTrimTemplate(scene, detail);
    const positions = mesh.getVerticesData('position');
    const normals = mesh.getVerticesData('normal');
    assert.ok(positions.every(Number.isFinite));
    assert.ok(normals.every(Number.isFinite));
    assert.ok(positions.filter((_, i) => i % 3 === 1).every(y => y > 0.71),
      `${detail}: trim contains no buttock or pelvis geometry`);
    assert.equal(mesh, getMarcherTrimTemplate(scene, detail), 'Trim uses a shared cached mesh');
  }
  console.log('Marcher body checks passed: rounded joint ends, bounded XR geometry, cached body parts, and no buttock or pelvis geometry at both detail levels.');
} finally {
  scene.dispose();
  engine.dispose();
}
