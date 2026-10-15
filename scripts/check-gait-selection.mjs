import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/robot/gaitSelection.ts', import.meta.url), 'utf8');
const context = vm.createContext({ Math });
vm.runInContext(
  `${stripTypeScriptTypes(source, { mode: 'transform' }).replace(/export /g, '')}
globalThis.selectAutoGait = selectAutoGait;
globalThis.buildGaitStepPhaseOffsets = buildGaitStepPhaseOffsets;
globalThis.gaitPhaseAtBeat = gaitPhaseAtBeat;`,
  context
);
const { selectAutoGait, buildGaitStepPhaseOffsets, gaitPhaseAtBeat } = context;

const yard = 0.625; // 8-to-5
const deg = (value) => (value * Math.PI) / 180;
// yaw = atan2(dx, dz): facing 0 looks down +z, +x is to the marcher's right.
const move = (yaw, distance) => [Math.sin(yaw) * distance, Math.cos(yaw) * distance];
const pick = (facing, travelYaw, distance, style) =>
  selectAutoGait(facing, ...move(travelYaw, distance), style);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

let result = pick(0, 0, 0, 'Field March');
assert.equal(result.gait, 'Mark Time');
assert.equal(result.relation, 'in-place');
assert.equal(pick(0, 0, 0.01, 'High Step').gait, 'High Mark Time');
for (const style of ['Field March', 'High Step']) {
  const shortMove = selectAutoGait(0, 0, 0.02, style, 1, 1.25);
  assert.equal(shortMove.gait, style === 'High Step' ? 'High Mark Time' : 'Mark Time');
  assert.equal(shortMove.stepsPerCount, 2,
    'Short travel retains neighboring double-time cadence for shared footfalls');
  assert.equal(selectAutoGait(0, 0, 0.02, style, 1, 0.15).stepsPerCount, 1,
    'Ordinary mark time remains on the pulse rather than half time');
  assert.equal(selectAutoGait(0, 0, 0.02, style, 1.5, 0.75).stepsPerCount, 2,
    'Neighbor-aware mark time respects compound MIDI pulses');
}

result = pick(0, 0, yard);
assert.equal(result.gait, 'Field March');
assert.equal(result.stepsPerCount, 1);
assert.equal(result.label, 'Field March');
assert.equal(pick(0, deg(40), yard).relation, 'forward');
assert.equal(pick(0, 0, yard, 'Parade').gait, 'Parade');

result = pick(0, Math.PI, yard);
assert.equal(result.gait, 'Backward March');
assert.equal(result.legYawOffset, 0);
assert.equal(pick(deg(90), deg(-80), yard, 'Knee-Ankle March').gait, 'Backward High Step');

result = pick(0, deg(90), yard);
assert.equal(result.gait, 'Crab Walk');
assert.equal(result.relation, 'sideways');
near(result.legYawOffset, deg(90));
assert.match(result.label, /Right$/);
result = pick(deg(170), deg(-100), yard);
assert.equal(result.relation, 'sideways');
near(result.legYawOffset, deg(90));
assert.match(pick(0, deg(-90), yard).label, /Crab Walk Left$/);
assert.equal(pick(0, deg(60), yard).relation, 'sideways');
assert.equal(pick(0, deg(120), yard).relation, 'sideways');

// Small strides can half-time; longer strides double-time before exceeding leg reach.
result = pick(0, 0, 0.15);
assert.equal(result.stepsPerCount, 0.5);
near(result.strideYards, 0.3);
assert.equal(result.label, 'Half Time Field March');
result = pick(0, Math.PI, 5 / 4);
assert.equal(result.stepsPerCount, 2);
near(result.strideYards, yard);
assert.equal(result.label, 'Double Time Backward March');
assert.equal(pick(0, 0, 5 / 6).stepsPerCount, 2);
assert.equal(pick(0, 0, 5 / 12).stepsPerCount, 1);
assert.equal(selectAutoGait(0, 0, 0.625, 'Field March', 1.5).stepsPerCount, 2,
  'Compound MIDI pulses cover more route distance and require faster cadence');
for (const unit of [0.5, 1, 1.5, 2]) {
  for (const distance of [0.1, 0.2, 0.3, 0.4]) {
    const gait = selectAutoGait(0, 0, distance, 'Field March', unit);
    if (distance * unit <= 1.25) assert.ok(gait.strideYards <= 0.625 + 1e-9);
  }
}

assert.deepEqual(Array.from(buildGaitStepPhaseOffsets([0.5, 0.5, 2, 1])), [0, 0.5, 1, 3, 4]);

for (const cadence of [0.5, 1, 2]) {
  for (let step = 0; step < 16; step++) {
    const beat = step / cadence;
    const phase = gaitPhaseAtBeat(beat, cadence);
    assert.equal(phase.stepNumber, step);
    assert.equal(phase.progress, 0, 'Footfall lands on its MIDI beat subdivision');
    near(gaitPhaseAtBeat(beat + 0.5 / cadence, cadence).progress, 0.5);
  }
}

console.log('Gait selection checks passed: mark time, forward styles, backward, crab walk left/right, and half/double time cadence.');
