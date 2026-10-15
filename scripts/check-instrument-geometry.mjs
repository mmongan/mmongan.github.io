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

function load(file, names, transform = source => source) {
  const source = readFileSync(new URL(`../src/robot/${file}.ts`, import.meta.url), 'utf8');
  return vm.runInContext(`(() => {
    ${stripTypeScriptTypes(transform(source), { mode: 'transform' })
      .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
    return { ${names.join(', ')} };
  })()`, context);
}

const shared = load('lowPolyInstrument', [
  'InstrumentGeometry', 'cachedInstrumentTemplate', 'buildInstrumentTemplate',
  'BRASS', 'SILVER', 'PEARL', 'EBONY',
]);
Object.assign(context, shared);
const { InstrumentGeometry, cachedInstrumentTemplate, buildInstrumentTemplate, BRASS } = shared;

function verify(mesh) {
  const positions = mesh.getVerticesData('position');
  const normals = mesh.getVerticesData('normal');
  const colors = mesh.getVerticesData('color');
  const indices = mesh.getIndices();
  assert.ok(positions.length > 0);
  assert.ok(positions.every(Number.isFinite), `${mesh.name}: finite positions`);
  assert.ok(normals.every(Number.isFinite), `${mesh.name}: finite normals`);
  assert.equal(normals.length, positions.length);
  assert.equal(colors.length, positions.length / 3 * 4);
  assert.equal(indices.length % 3, 0);
  assert.ok(indices.every(index => Number.isInteger(index) && index >= 0 && index < positions.length / 3),
    `${mesh.name}: valid indices`);
  assert.equal(mesh.isEnabled(), false);
  assert.equal(mesh.isPickable, false);
}

try {
  const body = new InstrumentGeometry();
  body.tube([Vector3.Zero(), Vector3.Up()], 0.1, 3, BRASS);
  assert.equal(body.positions.length / 3, 6, 'Body tubes keep their original tessellation');
  const instrument = new InstrumentGeometry('instrument');
  const [, top] = instrument.tube([Vector3.Zero(), Vector3.Up()], 0.1, 3, BRASS);
  assert.equal(top, 9);
  instrument.cap(top, 3, Vector3.Up(), BRASS);
  assert.equal(instrument.positions.length / 3, 19);
  assert.equal(instrument.indices.length, 81, 'Tube cap covers all nine sides');
  const flare = new InstrumentGeometry('instrument');
  flare.tube([Vector3.Zero(), Vector3.Up()], [0.01, 0.1], [3, 9], BRASS);
  assert.equal(flare.positions.length / 3, 36, 'Bells bridge nine to twenty-seven sides');
  assert.equal(flare.indices.length, 108);
  const elbowPath = [Vector3.Zero(), Vector3.Up(), new Vector3(0, 1, 1)];
  const elbow = new InstrumentGeometry('instrument');
  const elbowRings = elbow.tube(elbowPath, 0.01, 3, BRASS);
  assert.equal(elbowRings.length, elbowPath.length, 'Tube callers retain one returned ring per original point');
  assert.equal(elbow.positions.length / 3, 99, 'A ninety-degree bend retains eight curved segments plus straight ends');
  const ringCenter = (geometry, ring, sides) => {
    const center = Vector3.Zero();
    for (let side = 0; side < sides; side++) {
      center.addInPlace(Vector3.FromArray(geometry.positions, (ring + side) * 3));
    }
    return center.scale(1 / sides);
  };
  assert.ok(Vector3.Distance(ringCenter(elbow, elbowRings[0], 9), elbowPath[0]) < 1e-6);
  assert.ok(Vector3.Distance(ringCenter(elbow, elbowRings[2], 9), elbowPath[2]) < 1e-6);
  assert.ok(Vector3.Distance(ringCenter(elbow, elbowRings[1], 9), new Vector3(0, 0.925, 0.075)) < 1e-6,
    'The corner is rounded inward rather than merely subdividing the original straight segments');
  elbow.cap(elbowRings[2], 3, elbowPath[2], BRASS);
  verify(buildInstrumentTemplate('elbowCheck', elbow, scene));
  const lowElbow = cachedInstrumentTemplate(scene => {
    const geometry = new InstrumentGeometry('instrument');
    geometry.tube(elbowPath, 0.01, 3, BRASS);
    return buildInstrumentTemplate('lowElbowCheck', geometry, scene);
  })(scene, 'low');
  assert.equal(lowElbow.getTotalVertices(), 42, 'Reduced detail still rounds a ninety-degree bend with four segments');
  verify(lowElbow);
  const drum = new InstrumentGeometry('instrument');
  drum.drum(Vector3.Zero(), Vector3.Up(), 0.1, 0.2, 12, BRASS, BRASS, true);
  assert.equal(drum.positions.length / 3, 146, 'Drum ring multiplier is applied only once');
  assert.equal(drum.indices.length, 432, 'Both drum heads and shell cover all thirty-six sides');
  verify(buildInstrumentTemplate('drumCheck', drum, scene));
  const reduced = cachedInstrumentTemplate(scene => {
    const geometry = new InstrumentGeometry('instrument');
    const [, top] = geometry.tube([Vector3.Zero(), Vector3.Up()], 0.1, 3, BRASS);
    geometry.cap(top, 3, Vector3.Up(), BRASS);
    return buildInstrumentTemplate('reducedCheck', geometry, scene);
  })(scene, 'low');
  assert.equal(reduced.getTotalVertices(), 13, 'Reduced instruments keep six-sided tubes and caps');
  verify(reduced);

  const tubeEnds = [];
  class HandednessGeometry extends InstrumentGeometry {
    tube(...args) {
      const rings = super.tube(...args);
      const sides = Array.isArray(args[2]) ? args[2].at(-1) : args[2];
      tubeEnds.push(ringCenter(this, rings.at(-1), sides * (this.low ? 2 : 3)));
      return rings;
    }
  }
  context.InstrumentGeometry = HandednessGeometry;
  for (const [file, name, offset, mouthHeight] of [
    ['trumpetModel', 'getTrumpetTemplate', 0.018, 0.25],
    ['mellophoneModel', 'getMellophoneTemplate', 0.02, 0.3],
    ['euphoniumModel', 'getEuphoniumTemplate', 0.032, 0.27],
  ]) {
    const horn = load(file, [name]);
    for (const detail of ['high', 'low']) {
      tubeEnds.length = 0;
      verify(horn[name](scene, detail));
      assert.ok(Vector3.Distance(tubeEnds[0], new Vector3(0, mouthHeight, 0)) < 1e-9,
        `${name} ${detail}: mouthpiece remains centered at the lips`);
      assert.ok(Math.abs(tubeEnds[1].x - offset) < 1e-9,
        `${name} ${detail}: leadpipe is on the player's right`);
      assert.ok(Math.abs(tubeEnds[2].x + offset) < 1e-9,
        `${name} ${detail}: bell bow is on the player's left`);
    }
  }
  context.InstrumentGeometry = InstrumentGeometry;

  const models = [
    ['trumpetModel', ['getTrumpetTemplate']],
    ['mellophoneModel', ['getMellophoneTemplate']],
    ['baritoneModel', ['getBaritoneTemplate']],
    ['euphoniumModel', ['getEuphoniumTemplate']],
    ['tromboneModel', ['getTromboneTemplate']],
    ['sousaphoneModel', ['getSousaphoneTemplate']],
    ['saxophoneModel', ['getSaxophoneTemplate']],
    ['bariSaxophoneModel', ['getBariSaxophoneTemplate']],
    ['clarinetModel', ['getClarinetTemplate']],
    ['fluteModel', ['getFluteTemplate']],
    ['percussionModels', ['getSnareTemplate', 'getTenorTemplate', 'getBassDrumTemplate', 'getGlockenspielTemplate']],
  ];
  const denseShared = load('lowPolyInstrument', Object.keys(shared),
    source => source.replace('this.low ? 2 : 3', 'this.low ? 2 : 4'));
  let denseVertices = 0;
  let optimizedVertices = 0;
  for (const [file, names] of models) {
    const current = load(file, names);
    const original = load(file, names, source => source
      .replaceAll('new InstrumentGeometry("instrument")', 'new InstrumentGeometry()')
      .replace('geometry.low ? 16 : 32', '8'));
    Object.assign(context, denseShared);
    const dense = load(file, names);
    // Build while the prior builder is installed; model factories resolve these shared bindings lazily.
    const denseMeshes = names.map(name => dense[name](scene, 'high'));
    Object.assign(context, shared);
    for (const name of names) {
      for (const detail of ['high', 'low']) {
        const mesh = current[name](scene, detail);
        const baseline = original[name](scene, detail);
        verify(mesh);
        if (detail === 'high') {
          const previousDense = denseMeshes[names.indexOf(name)];
          denseVertices += previousDense.getTotalVertices();
          optimizedVertices += mesh.getTotalVertices();
          assert.ok(mesh.getTotalVertices() <= previousDense.getTotalVertices());
          const denseBounds = previousDense.getBoundingInfo().boundingBox;
          const optimizedBounds = mesh.getBoundingInfo().boundingBox;
          assert.ok(Vector3.Distance(denseBounds.minimum, optimizedBounds.minimum) < .003 &&
            Vector3.Distance(denseBounds.maximum, optimizedBounds.maximum) < .003,
          `${name}: silhouette bounds change by less than 3mm in model coordinates`);
        }
        assert.ok(mesh.getTotalVertices() > baseline.getTotalVertices(), `${name} ${detail}: increased tessellation`);
        const bounds = mesh.getBoundingInfo().boundingBox;
        const previous = original[name](scene, 'high').getBoundingInfo().boundingBox;
        assert.ok(Vector3.Distance(bounds.minimum, previous.minimum) < 0.04, `${name}: minimum extent preserved`);
        assert.ok(Vector3.Distance(bounds.maximum, previous.maximum) < 0.04, `${name}: maximum extent preserved`);
        assert.equal(current[name](scene, detail), mesh, `${name}: cached template reused`);
        const copy = mesh.clone('geometryCheckClone');
        assert.equal(copy.geometry, mesh.geometry, `${name}: clones share geometry`);
        copy.dispose();
        console.log(`${name} ${detail}: ${baseline.getTotalVertices()} -> ${mesh.getTotalVertices()} vertices`);
      }
    }
  }
  assert.ok(optimizedVertices < denseVertices * .8, 'Full-detail instrument library saves at least 20% of vertices');
  console.log(`Full-detail library: ${denseVertices} -> ${optimizedVertices} vertices (${(100 * (1 - optimizedVertices / denseVertices)).toFixed(1)}% fewer).`);
  console.log('Instrument geometry checks passed: tessellation, caps, drum shells, bell transitions, bounds, both detail levels, and shared templates.');
} finally {
  scene.dispose();
  engine.dispose();
}
