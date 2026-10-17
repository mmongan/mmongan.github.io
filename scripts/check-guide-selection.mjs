import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = file => readFileSync(new URL(`../src/interaction/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tools = read('fieldDrawingTools.ts');
const hand = read('handInteraction.ts');
const path = read('pathInteraction.ts');
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

const notices = [];
const yarnMaterial = { name: 'yarn' };
const selectedYarnMaterial = { name: 'selected' };
const context = vm.createContext({
  Vector3, FIELD_SURFACE_Y: -0.48, yarnRadius: 0.012, yarnMaterial, selectedYarnMaterial,
  floorCalibrationToggle: { checked: false }, takingPhoto: false,
  tableMode: false, updateTableStatus() {},
  deps: { notify: message => notices.push(message) },
});
vm.runInContext(stripTypeScriptTypes(`
  ${section(tools, 'export function closestPointOnGuide(', 'function createFieldDrawingTools(').replace('export ', '')}
  const guides = [];
  let selectedGuide = null;
  const activeGuide = () => selectedGuide ?? guides[guides.length - 1];
  ${section(tools, '  function highlightGuide(', '  function disposeGuide(')}
  function disposeGuide(guide) { if (guide === selectedGuide) selectedGuide = null; }
  this.api = { guides, closestPointOnGuide, selectNear, snapToSelected, activeGuide, disposeGuide,
    selected: () => selectedGuide };
`, { mode: 'transform' }), context);
const api = context.api;
const guide = (points, options = {}) => {
  const yarn = { name: 'drawingGuide', material: yarnMaterial };
  const entry = { points: points.map(([x, z]) => new Vector3(x, -0.46, z)), meshes: [yarn], options };
  api.guides.push(entry);
  return entry;
};
const near = (a, b, label) => assert.ok(a.equalsWithEpsilon(b, 1e-9), `${label}: ${a} vs ${b}`);

const line = guide([[0, 0], [10, 0]]);
const bent = guide([[0, 5], [5, 5], [5, 10]]);
const sticky = guide([[20, 20], [22, 20]], { sticky: true });

near(api.closestPointOnGuide(line.points, new Vector3(3, 1, 2)).point, new Vector3(3, 1, 0), 'Projects onto a segment, keeping height');
near(api.closestPointOnGuide(line.points, new Vector3(-4, 0, 1)).point, new Vector3(0, 0, 0), 'Clamps to the start');
near(api.closestPointOnGuide(bent.points, new Vector3(6, 0, 8)).point, new Vector3(5, 0, 8), 'Uses nearest polyline segment');
assert.equal(api.closestPointOnGuide([new Vector3(1, 0, 1)], Vector3.Zero()), null, 'Single-point guides do not snap');

assert.equal(api.snapToSelected(new Vector3(3, 0, 2)), null, 'No snapping without a selection');
assert.equal(api.activeGuide(), sticky, 'Drafting actions use the newest guide without a selection');
assert.equal(api.selectNear(new Vector3(3, -0.46, 2), 0.75, false), false, 'Taps outside the radius do not select');
assert.equal(api.selectNear(new Vector3(21, -0.46, 20), 0.75, false), false, 'Sticky notes are not selectable lines');
assert.equal(api.selectNear(new Vector3(3, -0.46, 0.5), 0.75, false), true, 'Tap near a guide selects it');
assert.equal(api.selected(), line);
assert.equal(line.meshes[0].material, selectedYarnMaterial, 'Selected yarn is highlighted');
assert.equal(api.activeGuide(), line, 'Drafting actions use the selected guide');
near(api.snapToSelected(new Vector3(7, -0.46, 4)), new Vector3(7, -0.46, 0), 'Release snaps to nearest point on selected guide');
near(api.snapToSelected(new Vector3(30, -0.46, -2)), new Vector3(10, -0.46, 0), 'Release beyond the end snaps to the endpoint');

assert.equal(api.selectNear(new Vector3(5.2, -0.46, 7), 0.75, false), true, 'Tap another guide switches selection');
assert.equal(api.selected(), bent);
assert.equal(line.meshes[0].material, yarnMaterial, 'Previous guide loses highlight');
assert.equal(bent.meshes[0].material, selectedYarnMaterial);
assert.equal(api.selectNear(new Vector3(5, -0.46, 7), 0.75, false), true, 'Tap selected guide again');
assert.equal(api.selected(), null, 'Second tap deselects');
assert.equal(bent.meshes[0].material, yarnMaterial);

assert.equal(api.selectNear(new Vector3(3, -0.2, 0), 0.03, true), false, 'Hand pinches above the yarn do not select');
assert.equal(api.selectNear(new Vector3(3, -0.466, 0.01), 0.03, true), true, 'Hand pinch on the yarn selects');
api.disposeGuide(line);
assert.equal(api.selected(), null, 'Erasing or clearing the selected guide clears selection');
context.floorCalibrationToggle.checked = true;
assert.equal(api.selectNear(new Vector3(5, -0.46, 7), 0.75, false), false, 'Floor calibration blocks selection');
assert.ok(notices.some(message => message.includes('snap')), 'Selection explains snapping');

const finish = section(hand, '  function finishMarcherGrab(', '    grab.robot.setEnabled(true);');
assert.ok(finish.indexOf('isTouchingTurf') < finish.indexOf('snapToSelectedDrawingGuide(position)'),
  'Snapping only happens after the release passes the turf-contact check');
assert.match(finish, /if \(placed\) position\.copyFrom\(snapped\);\s+else notifyPlacement/,
  'Blocked snaps fall back to the release point');
assert.match(hand, /selectDrawingGuideNear\(\s+Vector3\.TransformCoordinates\(point, Matrix\.Invert\(pathMatrix\)\), 0\.03 \/ pathScale, true\)\) continue;/,
  'Hand pinch on a guide selects instead of creating a marcher');
assert.match(path, /if \(!pickedRobot && selectDrawingGuideFromRay\(getControllerRay\(controller\)\)\) return;/,
  'Controller trigger selects guides when no marcher is aimed at');
assert.match(path, /if \(selectDrawingGuideFromRay\(getPointerRay\(\)\)\) return;\n    let fieldNode/,
  'Desktop tap selects guides before field-click handling');
assert.equal((path.match(/snapToSelectedDrawingGuide\(fieldPoint\) \?\? fieldPoint/g) ?? []).length, 2,
  'Desktop and controller placement mode snap to the selected guide');
console.log('Guide selection passed: nearest-point projection, tap/trigger/pinch selection, highlight, toggle, sticky exclusion, disposal, calibration guard, active-guide drafting, and release/placement snapping.');
