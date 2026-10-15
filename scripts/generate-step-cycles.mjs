import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const context = vm.createContext({ Quaternion, Vector3 });
for (const name of ['marcherLegPose', 'marcherStepCycleModel']) {
  const source = readFileSync(new URL(`../src/robot/${name}.ts`, import.meta.url), 'utf8');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/^import[\s\S]*?from .*?;\r?$/gm, '').replace(/export /g, ''), context);
}
const { phases, strides, increment, lifts } = vm.runInContext(
  '({ phases: CYCLE_PHASE_SAMPLES, strides: CYCLE_STRIDE_SAMPLES, increment: CYCLE_STRIDE_INCREMENT, lifts: CYCLE_LIFTS })', context);
const data = [];
for (const lift of lifts) {
  for (let stride = 0; stride < strides; stride++) {
    for (let phase = 0; phase <= phases; phase++) {
      for (const swing of [false, true]) {
        const pose = context.sampleStepCycle((stride - (strides - 1) / 2) * increment, phase / phases, swing, lift);
        data.push(...pose.legRotation.asArray(), ...pose.kneeRotation.asArray(), ...pose.ankleRotation.asArray(), pose.kneeAngle);
      }
    }
  }
}
const values = Float32Array.from(data);
writeFileSync(new URL('../src/robot/marcherStepCycles.bin', import.meta.url), new Uint8Array(values.buffer));
console.log(`Generated ${strides * lifts.length} shared cycles: ${values.byteLength} bytes.`);
