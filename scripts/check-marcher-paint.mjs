import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
class Control extends EventTarget { checked = false; value = ''; textContent = ''; }
const controls = Object.fromEntries(['marcherPaletteButton', 'marcherPaintToggle', 'marcherPaintColor',
  'marcherPaintSelectedButton', 'marcherPaintStatus', 'floorCalibrationToggle'].map(name => [name, new Control()]));
const engine = new NullEngine(), scene = new Scene(engine);
const robot = new TransformNode('marcher', scene), other = new TransformNode('otherMarcher', scene);
const source = MeshBuilder.CreateBox('uniformSource', {}, scene);
source.registerInstancedBuffer('color', 4);
const uniform = source.createInstance('uniform'); uniform.parent = robot;
const prop = source.createInstance('equipment'); prop.parent = robot;
prop.instancedBuffers.color = new Color4(.8, .8, .8, 1);
const marker = source.createInstance('robotTopDownMarker'); marker.parent = robot;
const uniformMaterial = new StandardMaterial('heldUniform', scene);
const robotColors = new Map([[robot, Color3.Red()], [other, Color3.Green()]]);
const modelPartInfo = new Map([[uniform, { tinted: true }], [prop, { tinted: false }]]);
const tintedPartMaterials = new Map([[robot, uniformMaterial]]);
const registered = new Map();
let placements = 0, releases = 0, prepares = 0, selected = robot, changes = 0;
const notices = [];
const context = vm.createContext({
  scene, MeshBuilder, Mesh, VertexData, InstancedMesh, TransformNode, StandardMaterial, Vector3, Color3, Color4,
  robotColors, modelPartInfo, tintedPartMaterials, ...controls,
  document: { createElement: () => ({ getContext: () => ({
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  }) }) },
  DynamicTexture: class { update() {} dispose() {} },
  drawPanelButton() {},
  registerMenuButton: (mesh, hit) => registered.set(mesh, hit),
  FloatingPanel: class {
    showForViewer() { placements++; }
    release() { releases++; }
  },
});
try {
  const robotCode = read('../src/robot/robot.ts');
  vm.runInContext(transform(robotCode.slice(robotCode.indexOf('export function getRobotColor('),
    robotCode.indexOf('// Robots are tiny'))), context);
  const hex = '#8e24aa', color = Color3.FromHexString(hex);
  context.setRobotColor(robot, color);
  assert.ok(context.getRobotColor(robot).equals(color));
  assert.notEqual(context.getRobotColor(robot), color, 'Caller cannot mutate the stored color through its input');
  assert.ok(uniform.instancedBuffers.color.equals(Color4.FromColor3(color)), 'Uniform instances update');
  assert.ok(marker.instancedBuffers.color.equals(Color4.FromColor3(color)), 'Top-down marker updates');
  assert.ok(uniformMaterial.diffuseColor.equals(color), 'Held marcher clone material updates');
  assert.ok(prop.instancedBuffers.color.equals(new Color4(.8, .8, .8, 1)), 'Equipment is untouched');
  assert.ok(context.getRobotColor(other).equals(Color3.Green()), 'Other marcher stays unchanged');
  assert.throws(() => context.setRobotColor(robot, new Color3(NaN, 0, 0)), /between/);
  assert.throws(() => context.setRobotColor(other, new Color3(2, 0, 0)), /between/);
  vm.runInContext(transform(read('../src/interaction/marcherPaint.ts')), context);
  context.initMarcherPaint({
    getSelected: () => selected, prepare: () => { prepares++; },
    changed: value => { assert.equal(value, robot); changes++; },
    notify: message => notices.push(message),
  });
  const root = scene.getTransformNodeByName('marcherPaintPalette');
  assert.equal(root.isEnabled(), false);
  assert.equal(context.isMarcherPainting(), false);
  assert.equal(context.tryPaintMarcher(robot), false);
  controls.marcherPaletteButton.dispatchEvent(new Event('click'));
  assert.equal(root.isEnabled(), true);
  assert.equal(placements, 1);
  const backing = scene.getMeshByName('marcherPaintPaletteBacking');
  backing.computeWorldMatrix(true);
  const boardBounds = backing.getBoundingInfo().boundingBox;
  assert.ok(boardBounds.maximum.z - boardBounds.minimum.z >= .019, 'Wood board has real thickness');
  assert.ok(backing.getVerticesData('position').every(Number.isFinite));
  assert.ok(backing.getVerticesData('normal').every(Number.isFinite));
  assert.ok(backing.material.diffuseTexture, 'Wood grain is visible on the board');
  assert.equal(scene.pickWithRay(new Ray(new Vector3(-.23, -.045, -1), Vector3.Forward()),
    mesh => mesh === backing).hit, false, 'Thumb hole passes through the complete board');
  assert.equal(scene.pickWithRay(new Ray(new Vector3(0, 0, -1), Vector3.Forward()),
    mesh => mesh === backing).hit, true, 'Front wood surface is pickable outside the thumb hole');
  const swatches = [...registered.values()].filter(hit => hit.action === 'marcherPaintColor');
  assert.equal(swatches.length, 10);
  assert.equal(new Set(swatches.map(hit => hit.color)).size, 10);
  const blobs = scene.meshes.filter(mesh => mesh.name === 'marcherPaintSwatch');
  for (const blob of blobs) {
    const bounds = blob.getBoundingInfo().boundingBox;
    assert.ok(bounds.maximum.z - bounds.minimum.z >= .025, 'Paint is a raised 3D mound, not a flat disc');
    assert.ok(blob.getTotalVertices() > 100);
    assert.ok(blob.getVerticesData('position').every(Number.isFinite));
    assert.ok(blob.getVerticesData('normal').every(Number.isFinite));
    assert.equal(blob.material.disableLighting, false, 'Paint responds to scene lighting');
    assert.ok(blob.material.specularPower >= 32, 'Oil paint has a glossy highlight');
  }
  assert.notDeepEqual(blobs[0].getVerticesData('position'), blobs[1].getVerticesData('position'),
    'Each paint blob has a distinct sculpted edge and ridge pattern');
  context.executeMarcherPaintAction(swatches[0]);
  assert.equal(context.isMarcherPainting(), true);
  assert.equal(controls.marcherPaintToggle.checked, true);
  assert.equal(controls.marcherPaintColor.value, swatches[0].color);
  const position = robot.position.clone(), rotation = robot.rotation.clone();
  context.tryPaintMarcher(robot);
  assert.ok(context.getRobotColor(robot).equals(Color3.FromHexString(swatches[0].color)));
  assert.ok(robot.position.equals(position) && robot.rotation.equals(rotation), 'Painting cannot move marcher');
  assert.equal(changes, 1);
  selected = null;
  controls.marcherPaintSelectedButton.dispatchEvent(new Event('click'));
  assert.match(controls.marcherPaintStatus.textContent, /Choose a visible marcher/);
  assert.equal(changes, 1, 'Missing selection is explicitly reported, not painted');
  selected = robot;
  controls.marcherPaintColor.value = '#123456';
  controls.marcherPaintColor.dispatchEvent(new Event('change'));
  controls.marcherPaintSelectedButton.dispatchEvent(new Event('click'));
  assert.ok(context.getRobotColor(robot).equals(Color3.FromHexString('#123456')));
  controls.floorCalibrationToggle.checked = true;
  context.tryPaintMarcher(robot);
  assert.equal(changes, 2, 'Calibration blocks paint');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(context.isMarcherPainting(), false);
  context.executeMarcherPaintAction(swatches[1]);
  assert.equal(context.isMarcherPainting(), false);
  controls.floorCalibrationToggle.checked = false;
  context.executeMarcherPaintAction(swatches[1]);
  context.executeMarcherPaintAction({ action: 'marcherPaint', command: 'done' });
  assert.equal(context.isMarcherPainting(), false);
  assert.equal(root.isEnabled(), false);
  assert.equal(releases, 1);
  assert.ok(prepares >= 3 && notices.length > 0);
  const interaction = read('../src/interaction/pathInteraction.ts');
  assert.match(interaction, /case "marcherPaint":\s*case "marcherPaintColor":\s*executeMarcherPaintAction\(hit\)/);
  assert.match(interaction, /if \(isMarcherPainting\(\)\) \{[\s\S]*?tryPaintMarcher/);
  const hands = read('../src/interaction/handInteraction.ts');
  assert.match(hands, /if \(paths\.isPainting\?\.\(\)\) \{[\s\S]*?paths\.paintMarcher\?\./);
  scene.dispose();
  const previousPlacements = placements;
  controls.marcherPaletteButton.dispatchEvent(new Event('click'));
  assert.equal(placements, previousPlacements, 'Disposal removes DOM listeners');
  assert.equal(scene.meshes.length, 0);
  console.log('Marcher paint checks passed: individual instance/held uniform and marker colors, unchanged equipment/other marchers, palette/custom/selected actions, mode/calibration guards, input wiring, and cleanup.');
} finally { scene.dispose(); engine.dispose(); }
