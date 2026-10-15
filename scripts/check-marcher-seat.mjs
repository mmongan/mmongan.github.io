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
import { Matrix, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const context = vm.createContext({
  Mesh, InstancedMesh, Matrix, Vector4, MaterialPluginBase,
  VertexData, StandardMaterial, Color3, Color4, Vector3,
});
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
const clipping = load('jacketLegOcclusion',
  ['JacketLegOcclusion', 'updateJacketLegPlane', 'updateJacketLegPlanes', 'registerJacketLegSource', 'JACKET_LEG_CLIP_HEIGHT']);
Object.assign(context, clipping);
const { marcherShoeGroundDepth } = load('marcherLegPose', ['marcherShoeGroundDepth']);
const templates = load('marcherBodyModel', [
  'getMarcherTrimTemplate', 'getMarcherJacketTemplate', 'getMarcherUpperArmTemplate',
  'getMarcherForearmTemplate', 'getMarcherThighTemplate', 'getMarcherCalfTemplate',
  'getMarcherShoeTemplate', 'getMarcherGloveTemplate', 'getMarcherKneeTemplate',
]);
const { getMarcherTrimTemplate } = templates;
try {
  const body = new TransformNode('clipTestBody', scene);
  const legRoot = new TransformNode('clipTestLegRoot', scene);
  const leg = new TransformNode('clipTestLeg', scene);
  leg.parent = legRoot;
  const source = new Mesh('clipTestSource', scene);
  clipping.registerJacketLegSource(source);
  const instance = source.createInstance('clipTestInstance');
  instance.parent = leg;
  const clone = new Mesh('clipTestClone', scene);
  clone.parent = leg;
  const plugin = new clipping.JacketLegOcclusion(new StandardMaterial('clipTestMaterial', scene));
  for (const scale of [0.01, 1, 3]) {
    body.scaling.set(scale, scale * 1.5, scale);
    body.rotation.set(0.2, 1.1, -0.4);
    body.position.set(2, 3, -4);
    legRoot.scaling.setAll(scale * 1.5);
    legRoot.rotation.copyFrom(body.rotation);
    legRoot.position.copyFrom(body.position);
    leg.rotation.set(0.8, 0.6, 0);
    leg.position.set(0.09, 0.69, 0);
    const computeBodyWorld = body.computeWorldMatrix.bind(body);
    let bodyUpdates = 0;
    body.computeWorldMatrix = (...args) => { bodyUpdates++; return computeBodyWorld(...args); };
    clipping.updateJacketLegPlanes([instance, clone], body);
    assert.equal(bodyUpdates, 1, 'Batched clipping computes the body matrix once per marcher');
    body.computeWorldMatrix = computeBodyWorld;
    for (const part of [instance, clone]) {
      let plane;
      if (part === instance) plane = part.instancedBuffers.jacketLegPlane;
      else plugin.hardBindForSubMesh({
        updateFloat4: (_name, x, y, z, w) => { plane = new Vector4(x, y, z, w); },
      }, scene, engine, { getRenderingMesh: () => part });
      for (const point of [new Vector3(0, 0, 0), new Vector3(0, -0.4, 0), new Vector3(0, -0.2, 0.3)]) {
        const bodyPoint = Vector3.TransformCoordinates(point, leg.getWorldMatrix()
          .multiply(Matrix.Invert(body.getWorldMatrix())));
        const distance = point.x * plane.x + point.y * plane.y + point.z * plane.z + plane.w;
        assert.ok(Math.abs(distance - (bodyPoint.y - clipping.JACKET_LEG_CLIP_HEIGHT)) < 1e-5,
          'Clipping boundary stays at jacket hem for animated, rotated, and AR-scaled legs');
      }
    }
  }
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
      assert.ok(jacket[i + 1] >= 0.69 - 1e-6, `${detail}: jacket does not cover the thighs`);
      if (jacket[i + 1] < 0.71) hem.push(new Vector3(jacket[i], jacket[i + 1], jacket[i + 2]));
    }
    assert.ok(hem.length > 0, `${detail}: jacket has a hip-level hem`);
    assert.ok(Math.abs(Math.min(...hem.map(p => p.y)) - 0.69) < 1e-6,
      `${detail}: hem exposes the full leg from hip to shoe`);
    assert.ok(Math.max(...hem.map(p => p.x)) > 0.17, `${detail}: hem clears both hip joints`);
    assert.ok(Math.min(...hem.map(p => p.z)) < -0.14 &&
      Math.max(...hem.map(p => p.z)) > 0.14, `${detail}: hem encloses the hip joint front and back`);
    const colors = templates.getMarcherJacketTemplate(scene, detail).getVerticesData('color');
    const hemHeights = [];
    for (let i = 0; i < jacket.length / 3; i++) {
      assert.equal(colors[i * 4], 1, `${detail}: jacket has no exposed trouser band`);
      if (jacket[i * 3 + 1] < 0.71) hemHeights.push(jacket[i * 3 + 1]);
    }
    assert.ok(hemHeights.every(y => Math.abs(y - clipping.JACKET_LEG_CLIP_HEIGHT) < 1e-6),
      `${detail}: closed hem is flat and coincides with the leg clipping boundary`);
    const mesh = getMarcherTrimTemplate(scene, detail);
    const shoeVertices = templates.getMarcherShoeTemplate(scene, detail).getVerticesData('position');
    const modelToMeters = 1.8 / 1.372;
    const shoeAxis = axis => shoeVertices.filter((_, index) => index % 3 === axis);
    const shoeExtent = axis => Math.max(...shoeAxis(axis)) - Math.min(...shoeAxis(axis));
    assert.ok(Math.abs(shoeExtent(2) * modelToMeters - 0.249) < 0.001,
      `${detail}: adult shoe length is about 24.9 cm`);
    const heelOverhang = -(Math.min(...shoeAxis(2)) + 0.055) * modelToMeters;
    assert.ok(heelOverhang > 0.035 && heelOverhang < 0.04,
      `${detail}: heel extends less than 4 cm behind the ankle`);
    assert.ok(shoeExtent(0) * 0.64 * modelToMeters > 0.075 &&
      shoeExtent(0) * 0.64 * modelToMeters < 0.1, `${detail}: shoe width stays within 7.5-10 cm`);
    assert.ok(Math.abs(shoeExtent(1) * modelToMeters - 0.079) < 0.001,
      `${detail}: shoe height is about 7.9 cm, not an oversized boot`);
    for (const pitch of [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]) {
      let depth = 0;
      for (let vertex = 0; vertex < shoeVertices.length; vertex += 3) {
        depth = Math.max(depth, -shoeVertices[vertex + 1] * Math.cos(pitch) +
          shoeVertices[vertex + 2] * Math.sin(pitch));
      }
      assert.ok(Math.abs(depth - marcherShoeGroundDepth(pitch)) < 1e-6,
        `${detail}: toe/heel contact solver matches actual rolled shoe geometry`);
    }
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
