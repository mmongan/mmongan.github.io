import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const constants = source.slice(source.indexOf('const MARCHER_BUILD_SCALE ='),
  source.indexOf('// Walks up from'));
const conversion = source.slice(source.indexOf('    const sin = Math.sin(legWorldRotation);'),
  source.indexOf('  const stepPhase ='));
const context = vm.createContext({ Math, Vector3 });
vm.runInContext(`${stripTypeScriptTypes(constants)}
globalThis.convert = (displacement, stepsPerCount, legWorldRotation) => {
  const localDisplacement = Vector3.Zero();
  ${conversion.slice(0, conversion.lastIndexOf('  }'))}
  return localDisplacement;
};
globalThis.scale = MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE;
globalThis.height = MARCHER_BODY_SCALE * MARCHER_MODEL_HEIGHT_YARDS * METERS_PER_YARD;
`, context);
assert.ok(Math.abs(context.height - 1.8) < 1e-9);
for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
  for (const cadence of [0.5, 1, 2]) {
    const travel = 0.625 * cadence;
    const local = context.convert(new Vector3(Math.sin(yaw) * travel, 0, Math.cos(yaw) * travel), cadence, yaw);
    assert.ok(Math.abs(local.z * context.scale * 36 - 22.5) < 1e-9);
    assert.ok(Math.abs(local.x) < 1e-9);
  }
}
console.log('Marcher scale checks passed: 1.8-meter adult height and 22.5-inch strides at normal, half, and double time in four directions.');
