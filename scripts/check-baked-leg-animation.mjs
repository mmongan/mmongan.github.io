import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Quaternion } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/robot/bakedLegAnimation.ts', import.meta.url), 'utf8');
const context = vm.createContext({ Quaternion, MARCHER_THIGH_LENGTH: 0.315, console });
vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
const Bake = vm.runInContext('BakedLegAnimation', context);
const bytes = context.getBakedLegAnimationBytes;
const sample = beat => {
  const leg = {
    thighLength: 0.315, kneeAngle: 0.2,
    legRotation: Quaternion.FromEulerAngles(beat * 0.1, 0, 0),
    kneeRotation: Quaternion.Identity(), ankleRotation: Quaternion.Identity(),
  };
  return { legs: [leg, leg], hipHalfSpacing: 0.0576, limited: false };
};
const finish = table => { while (!table.complete) table.advance(); };
const first = new Bake(3, sample, 2);
while (first.completedCounts < 1) first.advance();
assert.ok(first.poseAt(2.5), 'Current count is baked before the beginning of the show');
assert.equal(first.poseAt(0.5), undefined, 'Unprepared counts explicitly request exact fallback');
assert.equal(first.fallbackReasonAt(0.5), 'pending');
finish(first);
assert.equal(first.completedCounts, 3);
const originalBytes = bytes();
assert.ok(originalBytes > 0);
const second = new Bake(3, sample);
finish(second);
assert.equal(bytes(), originalBytes, 'Identical sequences share packed buffers across shows/marchers');
assert.equal(first.poseAt(-0.1), undefined);
assert.equal(first.poseAt(3), undefined, 'A table never extrapolates past the route end');
for (let beat = 0; beat < 3; beat += 0.0073) {
  const actual = first.poseAt(beat);
  assert.ok(actual);
  const expected = sample(beat);
  assert.ok(Math.abs(Quaternion.Dot(actual.legs[0].legRotation, expected.legs[0].legRotation)) > 1 - 1e-10);
  assert.ok(Math.abs(actual.legs[0].legRotation.length() - 1) < 1e-10);
}
first.dispose();
assert.equal(bytes(), originalBytes, 'Disposing one owner preserves another owner’s shared sequence');
second.dispose();
assert.equal(bytes(), 0, 'Last owner releases shared buffers');
second.dispose();
assert.equal(bytes(), 0, 'Repeated disposal is safe');
const cancelled = new Bake(10, sample);
cancelled.advance();
cancelled.dispose();
cancelled.advance();
assert.equal(bytes(), 0, 'Cancelling unfinished baking releases its buffers and stops sampling');
const stationary = new Bake(1, () => undefined);
finish(stationary);
assert.equal(stationary.poseAt(0.5), undefined, 'Halts continue to use the existing attention pose');
assert.equal(stationary.byteLength, 0);
assert.equal(stationary.fallbackReasonAt(0.5), 'accuracy',
  'A processed count without usable interpolation differs from waiting for preparation');
stationary.dispose();
const warnings = [];
const limitedContext = vm.createContext({ Quaternion, MARCHER_THIGH_LENGTH: 0.315,
  console: { warn: message => warnings.push(message) } });
vm.runInContext(stripTypeScriptTypes(source.replace('128 * 1024 * 1024', '1024'), { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), limitedContext);
const LimitedBake = vm.runInContext('BakedLegAnimation', limitedContext);
const limited = new LimitedBake(3, sample);
finish(limited);
assert.equal(limited.memoryLimited, true);
assert.equal(limited.fallbackReasonAt(2.5), 'memory');
assert.equal(warnings.length, 1, 'Budget exhaustion explicitly reports live IK fallback');
assert.ok(limitedContext.getBakedLegAnimationBytes() <= 1024, 'Shared packed buffers respect their budget');
limited.dispose();
assert.equal(limitedContext.getBakedLegAnimationBytes(), 0);
const Pool = vm.runInContext('SharedLegBakePool', context);
const pool = new Pool();
let creations = 0;
let samples = 0;
let cancellations = 0;
const leases = Array.from({ length: 100 }, () => pool.acquire('same-route-and-timing', () => {
  creations++;
  return new Bake(3, beat => { samples++; return sample(beat); });
}, () => cancellations++));
assert.equal(creations, 1, 'One hundred equivalent routes create one bake producer');
assert.ok(leases.every(lease => lease.table === leases[0].table));
const table = leases[0].table;
table.advance();
const beforeJoin = samples;
const joined = pool.acquire('same-route-and-timing', () => { throw new Error('Must reuse active work'); },
  () => cancellations++);
assert.equal(samples, beforeJoin, 'Joining an unfinished bake does not resample it');
leases[0].release();
leases[0].release();
assert.equal(cancellations, 0, 'Removing the original owner does not cancel remaining owners');
finish(table);
const preparedSamples = samples;
const ready = pool.acquire('same-route-and-timing', () => { throw new Error('Must reuse completed work'); },
  () => cancellations++);
assert.ok(ready.table.poseAt(1.5));
assert.equal(samples, preparedSamples, 'Joining completed work requires no new IK sampling');
const different = pool.acquire('different-route', () => new Bake(1, sample), () => cancellations++);
assert.notEqual(different.table, table);
different.release();
leases.slice(1).forEach(lease => lease.release());
joined.release();
assert.ok(table.byteLength > 0, 'Shared table survives until its final owner is released');
ready.release();
assert.equal(table.byteLength, 0);
assert.equal(bytes(), 0);
assert.equal(cancellations, 2);
let cycleSamples = 0;
const cyclicSample = beat => { cycleSamples++; return sample(beat % 1); };
const cycleA = new Bake(8, cyclicSample, 0, () => 'repeat-cycle');
const cycleB = new Bake(8, cyclicSample, 0, () => 'repeat-cycle');
cycleA.advance();
cycleB.advance();
while (!cycleA.complete || !cycleB.complete) {
  cycleA.advance();
  cycleB.advance();
}
const reusedSampleCount = cycleSamples;
assert.equal(cycleA.reusedCycles + cycleB.reusedCycles, 15,
  'Sixteen equivalent cycle sections share one producer, including unfinished work');
const standalone = new Bake(1, cyclicSample);
finish(standalone);
assert.equal(cycleSamples - reusedSampleCount, reusedSampleCount,
  'All shared cycles combined perform exactly one standalone cycle worth of sampling');
for (let beat = 0.01; beat < 8; beat += 0.137) {
  const actual = cycleA.poseAt(beat);
  const expected = standalone.poseAt(beat % 1);
  assert.ok(Math.abs(Quaternion.Dot(actual.legs[0].legRotation, expected.legs[0].legRotation)) > 1 - 1e-10);
}
cycleA.dispose();
assert.ok(cycleB.poseAt(2.5), 'Releasing the original cycle owner preserves other marchers');
cycleB.dispose();
standalone.dispose();
assert.equal(bytes(), 0, 'Final cycle owner releases shared storage');
console.log('Baked animation table checks passed: cooperative progress, cubic rotations, normalization, shared buffers, cancellation, bounds, and halt fallback.');
