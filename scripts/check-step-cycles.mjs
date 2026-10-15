import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const context = vm.createContext({ Quaternion, Vector3 });
for (const name of ['marcherLegPose', 'marcherStepCycleModel', 'marcherStepCycles']) {
  let source = readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8');
  if (name === 'marcherStepCycles') {
    source = source.slice(0, source.indexOf('fetch(cycleUrl)')) +
      source.slice(source.indexOf('export function sharedMarcherStepPose'));
  }
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?from .*?;\r?$/gm, '').replace(/export /g, ''), context);
}
assert.equal(context.sharedMarcherStepPose(0.2, 0.5, false, 0.16), undefined, 'Live IK works until library loads');
const file = readFileSync(new URL('../src/robot/marcherStepCycles.bin', import.meta.url));
context.loadMarcherStepCycles(new Float32Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
assert.throws(() => context.loadMarcherStepCycles(new Float32Array(3)), /Invalid/);
const soleOf = pose => {
  const calf = pose.legRotation.multiply(pose.kneeRotation);
  const foot = calf.multiply(pose.ankleRotation);
  const pitch = foot.toEulerAngles().x;
  return new Vector3(0, 0.69, 0)
    .add(new Vector3(0, -0.315, 0).rotateByQuaternionToRef(pose.legRotation, Vector3.Zero()))
    .add(new Vector3(0, -0.315, 0).rotateByQuaternionToRef(calf, Vector3.Zero()))
    .add(new Vector3(0, -0.03, 0.055).rotateByQuaternionToRef(foot, Vector3.Zero()))
    .subtract(new Vector3(0, context.marcherShoeGroundDepth(pitch), context.marcherShoeRollOffset(pitch)));
};
let hits = 0;
let total = 0;
let maxError = 0;
for (const stride of [-0.39, -0.213, -0.02, 0, 0.013, 0.1394, 0.2, 0.333, 0.435]) {
  for (const lift of [0.04, 0.11, 0.16, 0.24]) {
    for (let sample = 0; sample <= 180; sample++) {
      const phase = sample / 180;
      for (const swing of [false, true]) {
        total++;
        const pose = context.sharedMarcherStepPose(stride, phase, swing, lift);
        if (!pose) continue;
        hits++;
        const exact = context.sampleStepCycle(stride, phase, swing, lift);
        const error = Vector3.Distance(soleOf(pose), soleOf(exact));
        maxError = Math.max(maxError, error);
        assert.ok(error <= 0.000101, 'Accepted cycles preserve actual contact to 0.1 mm in model units');
        assert.ok(pose.kneeAngle >= 0 && pose.kneeAngle <= 1.35, 'Knees retain humanoid limits');
        assert.ok(pose.legRotation.toEulerAngles().x <= 1.4, 'No invalid leg rotation');
      }
    }
  }
}
assert.ok(hits > total * 0.5, `Shared cycles must cover a majority, not just a token subset (${hits}/${total})`);
assert.equal(context.sharedMarcherStepPose(0.6, 0.5, false, 0.16), undefined, 'Unusual strides retain live IK');
console.log(`Shared cycles: ${hits}/${total} accepted (${(100 * hits / total).toFixed(1)}%), max sole error ${maxError}, ${file.byteLength} bytes.`);
