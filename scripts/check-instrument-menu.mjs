import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  const names = ['Trumpet', 'Mellophone', 'Trombone', 'Euphonium', 'Sousaphone', 'Saxophone',
    'BariSaxophone', 'Clarinet', 'Flute', 'Snare', 'Tenor', 'BassDrum', 'Glockenspiel',
    'GuardFlag', 'GuardRifle', 'GuardSabre', 'Cymbal'];
  const templates = {};
  names.forEach((name, i) => {
    const source = MeshBuilder.CreateBox(name, { width: 0.2 + i / 10, height: 0.5, depth: 0.3 }, scene);
    source.bakeTransformIntoVertices(Matrix.Translation(0.3, 1.2, 0.4));
    source.isVisible = false;
    templates[`get${name}Template`] = () => source;
  });
  const context = vm.createContext({ TransformNode, StandardMaterial, Color3, ...templates });
  const source = readFileSync(new URL('../src/menu/instrumentButtonModel.ts', import.meta.url), 'utf8');
  vm.runInContext(`${stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.add = addInstrumentButtonModel;globalThis.instruments = Object.keys(templates);`, context);
  for (const instrument of context.instruments) {
    const button = MeshBuilder.CreatePlane(`button-${instrument}`, { size: 0.022 }, scene);
    context.add(button, instrument, 0.022);
    const model = button.getChildMeshes()[0];
    model.computeWorldMatrix(true);
    const box = model.getBoundingInfo().boundingBox;
    const size = box.maximumWorld.subtract(box.minimumWorld);
    assert.ok(Math.max(size.x, size.y, size.z) <= 0.022 * 0.78 + 1e-6, 'Model fits button');
    assert.ok(Math.hypot(box.centerWorld.x, box.centerWorld.y) < 1e-6, 'Offset geometry is centered');
    assert.equal(model.isPickable, false, 'Button surface retains input ownership');
    assert.equal(model.isVisible, true);
    button.setEnabled(false);
    assert.equal(model.isEnabled(), false, 'Model hides with its menu button');
    button.setEnabled(true);
    assert.equal(model.isEnabled(), true);
    button.dispose();
  }
  const importer = readFileSync(new URL('../src/robot/openMarchUrl.ts', import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(importer.slice(importer.indexOf('const SECTION_INSTRUMENTS')), { mode: 'transform' })
    .replace(/export /g, ''), context);
  for (const [section, instrument] of [
    ['Color Guard', 'guardFlag'], ['Colour guard flags', 'guardFlag'], ['Flag line', 'guardFlag'],
    ['Color Guard Rifles', 'guardRifle'], ['Guard Sabres', 'guardSabre'], ['Saber line', 'guardSabre'],
    ['Trumpet', 'trumpet'], ['Bass drums', 'bassDrum'], ['Drum major', 'flute'],
    ['Marching Cymbals', 'cymbals'], ['Cymbal line', 'cymbals'], ['Snare', 'snare'],
  ]) {
    assert.equal(context.getOpenMarchSectionInstrument(section, 'flute'), instrument,
      'Specific guard equipment takes precedence while ordinary sections and fallback are preserved');
  }
  console.log('Instrument menu checks passed: all 17 instrument/guard choices, normalized rotated bounds, centering, button input ownership, section matching, and inherited visibility.');
} finally {
  scene.dispose();
  engine.dispose();
}
