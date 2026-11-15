// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Photorealistic marchers" is a Settings toggle (next to the low-polygon
// one, desktop Settings only) that forces high-detail marcher bodies and
// applies a reversible satin-shading preset — tighter bright specular plus a
// Fresnel rim sheen — to the shared marcher materials. It is a material
// preset, never a second set of meshes or a texture pipeline. Enabling is
// shared-material-wide, materials created while enabled inherit the preset,
// and disabling restores every registered material to its own base values.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const engine = new NullEngine();
const scene = new Scene(engine);

// Stub the geometry builders: this check exercises material ownership, not
// lathe geometry (check-marcher-seat covers body topology).
const context = vm.createContext({
  StandardMaterial, FresnelParameters, Color3, Color4, Vector3, Scene, scene,
  cachedInstrumentTemplate: build => (buildScene) => build(buildScene),
  InstrumentGeometry: class {
    low = false;
    positions = [];
    lathe() {}
    box() {}
    fine() {}
  },
  buildLowPolyTemplate: (name, geometry, material, buildScene) => {
    const mesh = new Mesh(name, buildScene);
    mesh.material = material;
    return mesh;
  },
  addRobotHead: () => {},
  JacketLegOcclusion: class {},
  JACKET_LEG_CLIP_HEIGHT: 0.56,
});
const source = readFileSync(new URL('../src/robot/marcherBodyModel.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), context);

// Building body templates creates the shared part material and the cloned
// leg material (jacket occlusion), both registered for the preset.
vm.runInContext('getMarcherTrimTemplate(scene); getMarcherThighTemplate(scene);', context);
const part = scene.materials.find(material => material.name === 'marcherPartMaterial');
const leg = scene.materials.find(material => material.name === 'marcherLegMaterial');
assert.ok(part && leg, 'Shared part and leg materials exist');
assert.equal(part.specularPower, 12, 'Default shading starts with the broad dull specular');
assert.ok(part.emissiveColor.equals(Color3.Black()), 'Default shading has no rim emissive');
assert.equal(vm.runInContext('isMarcherShadingRealistic()', context), false,
  'Realism starts disabled');

// Enabling applies the satin preset to every registered material.
vm.runInContext('setMarcherShadingRealism(true)', context);
for (const material of [part, leg]) {
  assert.equal(material.specularPower, 52, `${material.name} gets the tighter satin specular`);
  assert.ok(material.specularColor.r > 0.2, `${material.name} specular brightens`);
  assert.ok(material.emissiveColor.r > 0, `${material.name} gains the rim emissive`);
  assert.ok(material.emissiveFresnelParameters.isEnabled,
    `${material.name} rim Fresnel is enabled`);
  assert.ok(material.emissiveFresnelParameters.leftColor.equals(Color3.White()),
    `${material.name} rim catches light at grazing angles`);
}

// A material registered while the preset is on (a held marcher's tinted
// clone material) inherits it immediately, with its own restore base.
const tinted = new StandardMaterial('robotBodyMaterial', scene);
const tintedBase = new Color3(0.3, 0.3, 0.32);
tinted.specularColor = tintedBase.clone();
tinted.specularPower = 32;
context.tinted = tinted;
context.tintedBase = tintedBase;
vm.runInContext('registerMarcherShadedMaterial(tinted, tintedBase, 32)', context);
assert.equal(tinted.specularPower, 52, 'Materials created while enabled inherit the preset');
assert.ok(tinted.emissiveFresnelParameters.isEnabled, 'Inherited preset includes the rim');

// Disabling restores each material to its own base exactly.
vm.runInContext('setMarcherShadingRealism(false)', context);
assert.equal(part.specularPower, 12, 'The shared material restores its base specular power');
assert.ok(part.specularColor.equals(new Color3(0.12, 0.12, 0.13)),
  'The shared material restores its base specular color');
assert.equal(tinted.specularPower, 32, 'The tinted material restores its own base power');
assert.ok(tinted.specularColor.equals(tintedBase), 'The tinted material restores its own specular');
for (const material of [part, leg, tinted]) {
  assert.ok(material.emissiveColor.equals(Color3.Black()), `${material.name} rim emissive clears`);
  assert.ok(!material.emissiveFresnelParameters.isEnabled, `${material.name} rim Fresnel disables`);
}

// Toggling is idempotent, and disposed materials drop out of the registry.
vm.runInContext('setMarcherShadingRealism(false)', context);
assert.equal(tinted.specularPower, 32, 'Disabling twice changes nothing');
tinted.dispose();
vm.runInContext('setMarcherShadingRealism(true); setMarcherShadingRealism(false);', context);
assert.equal(part.specularPower, 12, 'A disposed material no longer participates');

// Wiring: the toggle forces high-detail bodies (shrunk fields still reduce),
// refreshes shading and detail on change, registers tinted clone materials,
// and ships as an unchecked Settings checkbox.
const robot = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
assert.match(robot, /lowPolygonMarchersToggle\?\.checked && !photorealMarchersToggle\?\.checked/,
  'Photorealistic marchers override the low-polygon body preference');
assert.match(robot, /preferLow \|\| isFieldShrunk\(\)/,
  'The shrunk-field reduction still wins over photorealistic detail');
assert.match(robot, /photorealMarchersToggle\?\.addEventListener\("change"/,
  'The toggle listens for changes');
assert.match(robot, /setMarcherShadingRealism\(!!photorealMarchersToggle\?\.checked\);\s*\r?\n\s*setMarcherDetail\(getMarcherDetail\(\)\)/,
  'A change refreshes both shading and body detail');
assert.match(robot, /registerMarcherShadedMaterial\(material, TINTED_PART_SPECULAR, 32\)/,
  'Held-clone tinted materials register for the preset');
const dom = readFileSync(new URL('../src/ui/dom.ts', import.meta.url), 'utf8');
assert.match(dom, /photorealMarchersToggle = document\.getElementById\("photorealMarchersToggle"\)/,
  'The DOM module exports the toggle');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(html, /<input id="photorealMarchersToggle" type="checkbox" checked \/>/,
  'The Settings checkbox exists and ships enabled by default');

scene.dispose();
engine.dispose();
console.log('Photorealistic marcher checks passed: shared/leg/tinted material registration, ' +
  'satin preset apply and exact per-material restore, inheritance while enabled, idempotent ' +
  'toggling with disposal cleanup, detail override wiring, and the Settings checkbox.');
