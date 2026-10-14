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

// 16-to-5 marches half time at a standard 8-to-5 stride; 4-to-5 double times.
result = pick(0, 0, 5 / 16);
assert.equal(result.stepsPerCount, 0.5);
near(result.strideYards, yard);
assert.equal(result.label, 'Half Time Field March');
result = pick(0, Math.PI, 5 / 4);
assert.equal(result.stepsPerCount, 2);
near(result.strideYards, yard);
assert.equal(result.label, 'Double Time Backward March');
assert.equal(pick(0, 0, 5 / 6).stepsPerCount, 1);
assert.equal(pick(0, 0, 5 / 12).stepsPerCount, 1);

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
