import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const robot = read('robot/robot.ts');
const path = read('interaction/pathInteraction.ts');
const pad = read('menu/drillChartPad.ts');
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

const context = vm.createContext({ Vector3, Math, Infinity });
vm.runInContext(stripTypeScriptTypes(`
  ${section(robot, 'const CURVE_BULGE', '// Rewrites counts fromCount..toCount')}
  const ADJACENT_LINK_YARDS = 4.1;
  const ADJACENT_MAX_MARCHERS = 32;
  const STEP_YARDS = 0.625;
  ${section(robot, 'export function planAdjacentGuidePlacements(', '// Gesture action:').replace('export ', '')}
  globalThis.api = { transitionPaceProgress, transitionPathPolyline, polylineSample, planAdjacentGuidePlacements };
`.replace(/export function/g, 'function')), context);
const { transitionPaceProgress, transitionPathPolyline, polylineSample, planAdjacentGuidePlacements } = context.api;

// Paces.
assert.equal(transitionPaceProgress('even', 0.25), 0.25);
assert.equal(transitionPaceProgress('moveHold', 0.5), 1);
assert.equal(transitionPaceProgress('moveHold', 0.75), 1);
assert.equal(transitionPaceProgress('holdMove', 0.5), 0);
assert.equal(transitionPaceProgress('holdMove', 0.75), 0.5);
assert.equal(transitionPaceProgress('ease', 0.5), 0.5);
assert.ok(transitionPaceProgress('ease', 0.1) < 0.1);

// Path shapes keep both endpoints and bend to the expected side.
const from = new Vector3(0, 0, 0), to = new Vector3(0, 0, 10);
for (const shape of ['straight', 'curveLeft', 'curveRight', 'sCurve', 'lengthFirst', 'acrossFirst']) {
  const line = transitionPathPolyline(shape, from, to);
  assert.ok(Vector3.Distance(line[0], from) < 1e-9, shape);
  assert.ok(Vector3.Distance(line[line.length - 1], to) < 1e-9, shape);
}
// Travelling +z, left is -x.
assert.ok(polylineSample(transitionPathPolyline('curveLeft', from, to), 0.5).position.x < -2);
assert.ok(polylineSample(transitionPathPolyline('curveRight', from, to), 0.5).position.x > 2);
const s = transitionPathPolyline('sCurve', from, to);
assert.ok(polylineSample(s, 0.25).position.x < 0 && polylineSample(s, 0.75).position.x > 0);
const diagonalTo = new Vector3(4, 0, 6);
assert.deepEqual(transitionPathPolyline('lengthFirst', from, diagonalTo)[1].asArray(), [0, 0, 6]);
assert.deepEqual(transitionPathPolyline('acrossFirst', from, diagonalTo)[1].asArray(), [4, 0, 0]);

// Adjacent marchers: a previous-page line along x, spaced 2 yards, with a
// far-away marcher that is not adjacent.
const robots = ['a', 'b', 'c', 'd', 'far'].map(name => ({ name }));
const previous = {
  a: new Vector3(-4, 0, 0), b: new Vector3(-2, 0, 0), c: new Vector3(2, 0, 0), d: new Vector3(4, 0, 0),
  far: new Vector3(30, 0, 30),
};
const candidates = robots.map(r => ({ robot: r, previous: previous[r.name] }));
const guide = [new Vector3(10, 0, -10), new Vector3(10, 0, 10)];
const plan = planAdjacentGuidePlacements(new Vector3(0, 0, 0), new Vector3(10, 0.1, 0), candidates, guide);
assert.equal(plan.length, 4, 'far marcher is not adjacent');
const byName = Object.fromEntries(plan.map(entry => [entry.robot.name, entry.position]));
// Spacing rounds 2 yards to whole 0.625-yard steps (1.875) and the previous
// line's +x order follows the guide's +z direction.
for (const [name, z] of [['b', -1.875], ['a', -3.75], ['c', 1.875], ['d', 3.75]]) {
  assert.ok(Math.abs(byName[name].x - 10) < 1e-9, name);
  assert.ok(Math.abs(byName[name].z - z) < 1e-9, `${name} z ${byName[name].z}`);
  assert.equal(byName[name].y, 0.1);
}
// A guide that ends at the anchor overflows the other side onward.
const shortPlan = planAdjacentGuidePlacements(new Vector3(0, 0, 0), new Vector3(10, 0, 10),
  candidates, guide);
assert.equal(shortPlan.length, 4);
assert.ok(shortPlan.every(entry => entry.position.z < 10));
assert.equal(planAdjacentGuidePlacements(new Vector3(0, 0, 0), new Vector3(10, 0, 0),
  [{ robot: robots[4], previous: previous.far }], guide).length, 0);

// Palm sweep detector.
const sweepSource = read('interaction/palmSweepGesture.ts');
const sweepContext = vm.createContext({ Math, Number });
vm.runInContext(stripTypeScriptTypes(sweepSource).replace(/export /g, '') +
  '\nglobalThis.api = { createPalmSweepState, updatePalmSweep };', sweepContext);
const sweep = sweepContext.api;
let state = sweep.createPalmSweepState();
assert.equal(sweep.updatePalmSweep(state, 0, true, 0, 1, 0), false);
assert.equal(sweep.updatePalmSweep(state, 0.1, true, 0.1, 1, 0), false);
assert.equal(sweep.updatePalmSweep(state, 0.2, true, 0.2, 1, 0), true, 'fast sideways sweep');
assert.equal(sweep.updatePalmSweep(state, 0.3, true, 0.5, 1, 0), false, 'cooldown');
state = sweep.createPalmSweepState();
sweep.updatePalmSweep(state, 0, true, 0, 1, 0);
assert.equal(sweep.updatePalmSweep(state, 1, true, 0.3, 1, 0), false, 'slow drift is not a sweep');
state = sweep.createPalmSweepState();
sweep.updatePalmSweep(state, 0, true, 0, 1, 0);
sweep.updatePalmSweep(state, 0.1, false, 0.1, 1, 0);
assert.equal(sweep.updatePalmSweep(state, 0.2, true, 0.2, 1, 0), false, 'must stay palm-down');
state = sweep.createPalmSweepState();
sweep.updatePalmSweep(state, 0, true, 0, 1, 0);
assert.equal(sweep.updatePalmSweep(state, 0.2, true, 0.1, 1.3, 0.2), false, 'a lift is not a sweep');

// Wiring.
assert.match(robot, /setRobotTransition\(\[robot\], page\.previous, page\.count, activeChartTransition, scene\)/);
assert.match(robot, /state\.counts\[segmentStart\]\.styleIndex/);
assert.match(pad, /action: "drillChartTransition", kind: "shape"/);
assert.match(pad, /action: "drillChartApplyTransition"/);
assert.match(path, /case "drillChartApplyTransition":/);
assert.match(path, /updateAdjacentMarcherGestures\(\);/);
assert.match(path, /getComponentOfType\("thumbstick"\)\?\.pressed/);
// Media stepping/jogging scrubs the blank page's transition without ending it.
assert.match(robot, /transport\.beat < blankChartPage\.previous - 1e-6 \|\| transport\.beat > blankChartPage\.count \+ 1e-6/);
assert.match(robot, /globalPlayback\.countIndex = clampToBlankChartPageSpan\(/);
assert.match(robot, /if \(blankChartPage\) \{\n\s+\/\/ Jog the real band[^\n]*\n\s+seekToCount\(clampToBlankChartPageSpan\(/);
assert.match(pad, /count >= blank\.previous && count <= blank\.count/);
assert.match(pad, /if \(getBlankChartPageState\(\)\) endBlankChartPage\(\);\n\s+seekToCount\(setCounts\[target\]\)/);
// Grabbing a ghost leaves it behind as an ungrabbable reference; cancelling restores it.
assert.match(robot, /setBlankPageGhostWaiting\(robot, ghost, false\);\n\s+page\.leftBehind\.set\(robot, ghost\);/);
assert.match(robot, /setBlankPageGhostWaiting\(robot, ghost, true\);\n\s+page\.pending\.set\(robot, ghost\);/);
assert.match(robot, /page\.leftBehind\.values\(\)\]\.forEach\(\(ghost\) => ghost\.dispose\(\)\)/);
assert.doesNotMatch(robot, /page\.pending\.delete\(robot\);\n\s+ghost\.dispose\(\);/);

console.log('chart transition and adjacent marcher checks passed');
