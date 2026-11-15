// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

// "Photorealistic marchers" is a Settings toggle (next to the low-polygon
// one, desktop Settings only) that forces high-detail marcher bodies,
// applies a reversible matte-shading preset — real wool and skin are not
// shiny, so specular drops to a faint tight remnant with no rim glow — to
// the shared marcher materials, and swaps the
// geometric robotEyes features for a painted face-skin plate (one UV-mapped
// template per skin tone, conforming to the skull front). Enabling is
// shared-material-wide, materials created while enabled inherit the preset,
// and disabling restores every registered material to its own base values
// and brings the classic face features back.

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

// Enabling applies the matte preset to every registered material: duller
// than even the default, with no emissive rim glow.
vm.runInContext('setMarcherShadingRealism(true)', context);
for (const material of [part, leg]) {
  assert.equal(material.specularPower, 24, `${material.name} gets the tight matte specular`);
  assert.ok(material.specularColor.r < 0.05, `${material.name} specular dims below the default`);
  assert.ok(material.emissiveColor.equals(Color3.Black()), `${material.name} stays unlit`);
  assert.ok(!material.emissiveFresnelParameters.isEnabled,
    `${material.name} has no rim Fresnel glow`);
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
assert.equal(tinted.specularPower, 24, 'Materials created while enabled inherit the preset');
assert.ok(tinted.specularColor.r < 0.05, 'Inherited preset is matte too');

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

// Face skin: the plate conforms to the skull's front, covers the feature
// region, carries UVs, and faces forward.
const faceContext = vm.createContext({
  StandardMaterial, Color3, Mesh, Scene, scene,
  VertexData: (await import('@babylonjs/core/Meshes/mesh.vertexData.js')).VertexData,
  // Node has no 2D canvas; the texture is checked visually in the live app.
  DynamicTexture: class {
    constructor() { this.onDisposeObservable = { addOnce: () => {} }; }
    getContext() {
      const noop = new Proxy({}, { get: (_, key) =>
        key === 'createRadialGradient' || key === 'createLinearGradient'
          ? () => ({ addColorStop: () => {} }) : () => {} });
      return new Proxy({}, {
        get: (_, key) => typeof noop[key] === 'function' ? noop[key] : noop[key],
        set: () => true,
      });
    }
    update() {}
  },
  cachedInstrumentTemplate: build => (buildScene) => build(buildScene),
  faceSkinPhotoInput: null, faceSkinPhotoClear: null, faceSkinPhotoStatus: null,
  FRONT_DEPTH: 1.15, HEAD_SIDES: 16,
  SKULL_PROFILE: [[0, 1.13], [0.065, 1.14], [0.105, 1.175], [0.132, 1.2], [0.14, 1.235],
    [0.144, 1.285], [0.14, 1.325], [0.125, 1.355], [0, 1.372]],
});
const faceSource = readFileSync(new URL('../src/robot/marcherFaceSkin.ts', import.meta.url), 'utf8');
vm.runInContext(stripTypeScriptTypes(faceSource, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, ''), faceContext);
const patch = vm.runInContext('buildFaceSkinPatch()', faceContext);
assert.equal(vm.runInContext('FACE_SKIN_TEMPLATES.length', faceContext), 3,
  'One face-skin template per skin tone');
for (let index = 0; index < patch.uvs.length; index++) {
  assert.ok(patch.uvs[index] >= 0 && patch.uvs[index] <= 1, 'UVs stay in [0,1]');
}
let maxX = 0;
let maxY = -Infinity;
let minY = Infinity;
for (let index = 0; index < patch.positions.length; index += 3) {
  maxX = Math.max(maxX, Math.abs(patch.positions[index]));
  minY = Math.min(minY, patch.positions[index + 1]);
  maxY = Math.max(maxY, patch.positions[index + 1]);
  assert.ok(patch.positions[index + 2] > 0, 'The plate stays on the face side of the head');
}
assert.ok(maxX > 0.067, 'The plate reaches past the brow tails');
assert.ok(maxX < 0.142, 'The plate stops short of the ears');
assert.ok(minY < 1.186 && maxY > 1.3175, 'The plate covers lips through brows');
// Winding: the center of the plate faces forward (+Z normals).
const faceMesh = vm.runInContext('FACE_SKIN_TEMPLATES[0](scene)', faceContext);
const normals = faceMesh.getVerticesData('normal');
const positions = faceMesh.getVerticesData('position');
let centerIndex = 0;
let centerScore = Infinity;
for (let index = 0; index < positions.length; index += 3) {
  const score = Math.abs(positions[index]) + Math.abs(positions[index + 1] - 1.25);
  if (score < centerScore) { centerScore = score; centerIndex = index; }
}
assert.ok(normals[centerIndex + 2] > 0.5, 'The plate faces forward, not into the skull');
assert.ok(!faceMesh.isEnabled(), 'Templates stay hidden like every shared template');
assert.ok(faceMesh.getVerticesData('uv'), 'The template mesh carries UVs');
const zombieFaceMesh = vm.runInContext('getZombieFaceSkinTemplate(scene)', faceContext);
assert.ok(zombieFaceMesh.getVerticesData('uv'), 'The zombie face plate carries UVs');
// The texture carries facial detail, so the plate costs no more vertices
// than the box-feature face it replaces.
assert.ok(faceMesh.getTotalVertices() <= 120,
  `The plate stays coarse (${faceMesh.getTotalVertices()} vertices)`);

// Profile photos: each complexion group wears one of the first three loaded
// photos; no photos keeps the painted face. The crop trims hair/neck bands
// and preserves a centered square.
assert.equal(vm.runInContext('photoForTone(0, 0)', faceContext), -1,
  'No photos keeps the painted face');
assert.deepEqual([0, 1, 2].map(tone => vm.runInContext(`photoForTone(${tone}, 2)`, faceContext)),
  [0, 1, 0], 'Photos distribute across complexion groups');
const crop = vm.runInContext('faceSkinPhotoCrop(400, 1000)', faceContext);
assert.equal(crop.sw, crop.sh, 'The photo crop is square');
assert.ok(crop.sy >= 1000 * 0.12 - 1e-9, 'The crop trims the likely hair band');
assert.ok(crop.sy + crop.sh <= 1000 * 0.86 + 1e-9, 'The crop trims the likely neck band');
assert.ok(crop.sx >= 0 && crop.sx + crop.sw <= 400, 'The crop stays inside the photo');
const faceModule = faceSource;
assert.match(faceModule, /FACE_PHOTO_MAX_BYTES = 16 \* 1024 \* 1024/,
  'Face photos share the 16 MB local-image limit');
assert.match(faceModule, /bitmap\.close\(\)/, 'Replaced and failed bitmaps are closed');
assert.match(faceModule, /faceSkinPhotoInput\?\.addEventListener\('change'/,
  'The Settings file input loads photos');
assert.match(faceModule, /faceSkinPhotoClear\?\.addEventListener\('click', clearFaceSkinPhotos\)/,
  'The clear button restores painted faces');
assert.match(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'),
  /<input id="faceSkinPhotoInput" type="file" accept="image\/png,image\/jpeg,image\/webp" multiple \/>/,
  'The face photo input accepts local PNG/JPEG/WebP files');

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
assert.match(robot, /part\(FACE_SKIN_TEMPLATES\[skin\], "marcherFaceSkin", body\)/,
  'Each marcher gets the face plate matching its skin tone');
assert.match(robot, /part\(getZombieFaceSkinTemplate, "marcherZombieFace", body\);\s*\r?\n\s*applyMarcherFaceParts\(robot\)/,
  'New marchers get face parts applied for the current realism and zombie state');
assert.match(robot, /mesh\.setEnabled\(!zombified && realistic\)/,
  'The realism face yields to zombification');
assert.match(robot, /applyFaceSkinVisibility\(\);/,
  'Toggling swaps eyes and face skin on existing marchers');
const povCamera = readFileSync(new URL('../src/camera/marcherPOVCamera.ts', import.meta.url), 'utf8');
assert.match(povCamera, /marcherTrim\|robotEyes\|marcherFaceSkin/,
  'Marcher POV hides the own face skin with the rest of the head');
const dom = readFileSync(new URL('../src/ui/dom.ts', import.meta.url), 'utf8');
assert.match(dom, /photorealMarchersToggle = document\.getElementById\("photorealMarchersToggle"\)/,
  'The DOM module exports the toggle');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(html, /<input id="photorealMarchersToggle" type="checkbox" checked \/>/,
  'The Settings checkbox exists and ships enabled by default');

scene.dispose();
engine.dispose();
console.log('Photorealistic marcher checks passed: shared/leg/tinted material registration, ' +
  'matte preset apply and exact per-material restore, inheritance while enabled, idempotent ' +
  'toggling with disposal cleanup, face-skin plate geometry/UVs/tones and eye swap wiring, ' +
  'detail override wiring, and the Settings checkbox.');
