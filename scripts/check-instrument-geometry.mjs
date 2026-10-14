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
  assert.equal(top, 12);
  instrument.cap(top, 3, Vector3.Up(), BRASS);
  assert.equal(instrument.positions.length / 3, 25);
  assert.equal(instrument.indices.length, 108, 'Tube cap covers all twelve sides');
  const flare = new InstrumentGeometry('instrument');
  flare.tube([Vector3.Zero(), Vector3.Up()], [0.01, 0.1], [3, 9], BRASS);
  assert.equal(flare.positions.length / 3, 48, 'Bells bridge twelve to thirty-six sides');
  assert.equal(flare.indices.length, 144);
  const drum = new InstrumentGeometry('instrument');
  drum.drum(Vector3.Zero(), Vector3.Up(), 0.1, 0.2, 12, BRASS, BRASS, true);
  assert.equal(drum.positions.length / 3, 194, 'Drum ring multiplier is applied only once');
  assert.equal(drum.indices.length, 576, 'Both drum heads and shell cover all forty-eight sides');
  verify(buildInstrumentTemplate('drumCheck', drum, scene));
  const reduced = cachedInstrumentTemplate(scene => {
    const geometry = new InstrumentGeometry('instrument');
    const [, top] = geometry.tube([Vector3.Zero(), Vector3.Up()], 0.1, 3, BRASS);
    geometry.cap(top, 3, Vector3.Up(), BRASS);
    return buildInstrumentTemplate('reducedCheck', geometry, scene);
  })(scene, 'low');
  assert.equal(reduced.getTotalVertices(), 13, 'Reduced instruments keep six-sided tubes and caps');
  verify(reduced);

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
  for (const [file, names] of models) {
    const current = load(file, names);
    const original = load(file, names, source => source
      .replaceAll('new InstrumentGeometry("instrument")', 'new InstrumentGeometry()')
      .replace('geometry.low ? 16 : 32', '8'));
    for (const name of names) {
      for (const detail of ['high', 'low']) {
        const mesh = current[name](scene, detail);
        const baseline = original[name](scene, detail);
        verify(mesh);
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
  console.log('Instrument geometry checks passed: tessellation, caps, drum shells, bell transitions, bounds, both detail levels, and shared templates.');
} finally {
  scene.dispose();
  engine.dispose();
}
