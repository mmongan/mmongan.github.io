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
function load(file, names, transform = source => source) {
  const source = readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8');
  return vm.runInContext(`(() => {
    ${stripTypeScriptTypes(transform(source), { mode: 'transform' })
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
const { marcherShoeGroundDepth, marcherShoeRollOffset } = load('marcherLegPose',
  ['marcherShoeGroundDepth', 'marcherShoeRollOffset']);
const templates = load('marcherBodyModel', [
  'getMarcherTrimTemplate', 'getMarcherJacketTemplate', 'getMarcherUpperArmTemplate',
  'getMarcherForearmTemplate', 'getMarcherThighTemplate', 'getMarcherCalfTemplate',
  'getMarcherShoeTemplate', 'getMarcherGloveTemplate', 'getMarcherKneeTemplate',
]);
const { getMarcherTrimTemplate } = templates;
const partNames = Object.keys(templates);
const previousTemplates = load('marcherBodyModel', partNames,
  source => source.replace('const LEG_RADIAL_SIDES = 8;', 'const LEG_RADIAL_SIDES = 12;')
    .replace('geometry.low ? 16 : 12', '16'));
const baselineShared = load('lowPolyInstrument',
  ['InstrumentGeometry', 'cachedInstrumentTemplate', 'buildLowPolyTemplate'],
  source => source.replace('profile = this.simplifyBodyProfile(profile)', 'profile = profile'));
const optimizedShared = {
  InstrumentGeometry: context.InstrumentGeometry,
  cachedInstrumentTemplate: context.cachedInstrumentTemplate,
  buildLowPolyTemplate: context.buildLowPolyTemplate,
};
Object.assign(context, baselineShared);
const baselineTemplates = load('marcherBodyModel', partNames,
  source => source.replaceAll('geometry.low ? 12 : 8', '12')
    .replace('const LEG_RADIAL_SIDES = 8;', 'const LEG_RADIAL_SIDES = 12;')
    .replace('geometry.low ? 16 : 12', '16')
    .replace('new Vector3(x * 0.75, y, z * 0.75)', 'new Vector3(x, y, z)')
    .replace('new Vector3(x * 0.8, y, z * 0.8)', 'new Vector3(x, y, z)'));
const baselineMeshes = Object.fromEntries(['high', 'low'].map(detail => [detail,
  Object.fromEntries(partNames.map(name => [name, baselineTemplates[name](scene, detail)]))]));
Object.assign(context, optimizedShared);
try {
  for (let sample = -120; sample <= 120; sample++) {
    const pitch = sample / 100;
    const epsilon = 1e-5;
    const derivative = (marcherShoeRollOffset(pitch + epsilon) -
      marcherShoeRollOffset(pitch - epsilon)) / (2 * epsilon);
    assert.ok(Math.abs(derivative - marcherShoeGroundDepth(pitch)) < 1e-6,
      'Rolling translation derivative matches sole depth without slip');
  }
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
    for (const [name, jointY, capSide] of [
      ['getMarcherUpperArmTemplate', -0.3, -1],
      ['getMarcherForearmTemplate', 0, 1],
    ]) {
      const vertices = templates[name](scene, detail).getVerticesData('position');
      const normals = templates[name](scene, detail).getVerticesData('normal');
      for (let index = 0; index < vertices.length; index += 3) {
        const relativeY = vertices[index + 1] - jointY;
        if (relativeY * capSide < -1e-6) continue;
        const radius = Math.hypot(vertices[index], relativeY, vertices[index + 2]);
        assert.ok(Math.abs(radius - 0.045) < 1e-6,
          `${name} ${detail}: elbow caps share a slim 0.045-radius sphere at the same joint center`);
        const radial = new Vector3(vertices[index], relativeY, vertices[index + 2]).normalize();
        const normal = Vector3.FromArray(normals, index);
        for (const bend of [0, Math.PI / 4, Math.PI / 2, 2 * Math.PI / 3]) {
          const rotation = Matrix.RotationYawPitchRoll(0.4, bend, -0.2);
          assert.ok(Vector3.Distance(Vector3.TransformNormal(radial, rotation),
            Vector3.TransformNormal(normal, rotation)) < 1e-6,
          `${name} ${detail}: bent elbow shading follows the shared sphere, not the sleeve seam`);
        }
      }
    }
    const sleeve = templates.getMarcherForearmTemplate(scene, detail).getVerticesData('position');
    const glove = templates.getMarcherGloveTemplate(scene, detail);
    const gloveVertices = glove.getVerticesData('position');
    const gloveIndices = glove.getIndices();
    let gloveInradius = Infinity;
    for (let index = 0; index < gloveIndices.length; index += 3) {
      const a = Vector3.FromArray(gloveVertices, gloveIndices[index] * 3);
      const b = Vector3.FromArray(gloveVertices, gloveIndices[index + 1] * 3);
      const c = Vector3.FromArray(gloveVertices, gloveIndices[index + 2] * 3);
      const normal = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize();
      gloveInradius = Math.min(gloveInradius, Math.abs(Vector3.Dot(normal, a)));
    }
    const cuffY = Math.min(...sleeve.filter((_, index) => index % 3 === 1));
    assert.ok(Math.abs(cuffY + 0.39) < 1e-6, `${detail}: cuff stops before the wrist grip center`);
    for (let index = 0; index < sleeve.length; index += 3) {
      if (Math.abs(sleeve[index + 1] - cuffY) > 1e-6) continue;
      const radius = Math.hypot(sleeve[index], sleeve[index + 2]);
      assert.ok(radius <= 0.032 + 1e-6, `${detail}: cuff tapers inside the glove`);
      for (const stretch of [1, 1.04, 1.25]) {
        const wristDistance = Math.hypot(radius, (cuffY + 0.4) * stretch);
        assert.ok(wristDistance < gloveInradius,
          `${detail}: flat cuff stays inside the actual glove at any wrist orientation`);
      }
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
  for (const detail of ['high', 'low']) {
    let before = 0;
    let after = 0;
    let previous = 0;
    for (const name of partNames) {
      const oldMesh = baselineMeshes[detail][name];
      const mesh = templates[name](scene, detail);
      const copies = name === 'getMarcherTrimTemplate' || name === 'getMarcherJacketTemplate' ? 1 : 2;
      before += copies * oldMesh.getTotalVertices();
      after += copies * mesh.getTotalVertices();
      const previousMesh = previousTemplates[name](scene, detail);
      previous += copies * previousMesh.getTotalVertices();
      const previousBounds = previousMesh.getBoundingInfo().boundingBox;
      const currentBounds = mesh.getBoundingInfo().boundingBox;
      assert.ok(Vector3.Distance(previousBounds.minimum, currentBounds.minimum) < 1e-6 &&
        Vector3.Distance(previousBounds.maximum, currentBounds.maximum) < 1e-6,
      `${name} ${detail}: radial reduction preserves existing part bounds`);
      const oldBounds = oldMesh.getBoundingInfo().boundingBox;
      const bounds = mesh.getBoundingInfo().boundingBox;
      const radiusScale = name === 'getMarcherUpperArmTemplate' ? 0.75 :
        name === 'getMarcherForearmTemplate' ? 0.8 : 1;
      const scale = new Vector3(radiusScale, 1, radiusScale);
      assert.ok(Vector3.Distance(oldBounds.minimum.multiply(scale), bounds.minimum) < 1e-6 &&
        Vector3.Distance(oldBounds.maximum.multiply(scale), bounds.maximum) < 1e-6,
      `${name} ${detail}: arm radii slimmed without changing lengths; other bounds unchanged`);
      assert.ok(mesh.getTotalVertices() <= oldMesh.getTotalVertices(), `${name}: never adds vertices`);
    }
    assert.ok(after < before, `${detail}: marcher body vertex count reduced`);
    if (detail === 'high') assert.ok(after <= 1010, 'Full-detail body stays below the reduced vertex budget');
    else assert.equal(after, 384, 'Reduced-detail geometry is preserved');
    assert.equal(previous, detail === 'high' ? 1196 : 384, 'Measured previous topology matches its documented budget');
    assert.equal(after, detail === 'high' ? 1008 : previous);
    console.log(`Current reduction ${detail}: ${previous} -> ${after} vertices (${(100 * (1 - after / previous)).toFixed(1)}% fewer).`);
    console.log(`Marcher body ${detail}: ${before} -> ${after} vertices (${(100 * (1 - after / before)).toFixed(1)}% fewer, eyes/instrument excluded).`);
  }
  console.log('Marcher body checks passed: rounded joint ends, bounded XR geometry, cached body parts, and no buttock or pelvis geometry at both detail levels.');
} finally {
  scene.dispose();
  engine.dispose();
}
