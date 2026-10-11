import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('const thighDirection ='),
  source.indexOf('function hornRotationMatrix'));
const context = vm.createContext({ Vector3, Quaternion, Math });
vm.runInContext(`${stripTypeScriptTypes(helper)};globalThis.attach = attachMarcherThigh;`, context);
let poses = 0;
for (const side of [-1, 1]) {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2]) {
    for (const pitch of [-1.2, -0.4, 0, 0.4, 1.2]) {
      for (const height of [0.4, 0.55, 0.69, 0.8, 0.93]) {
        const hipX = side * 0.115;
        const leg = {
          position: new Vector3(hipX + 0.015, height, -0.015),
          rotation: new Vector3(pitch, yaw, 0),
        };
        const thigh = {
          position: Vector3.Zero(),
          scaling: Vector3.One(),
          rotationQuaternion: Quaternion.Identity(),
        };
        context.attach(thigh, leg, hipX);
        const thighMatrix = Matrix.Compose(thigh.scaling, thigh.rotationQuaternion, thigh.position);
        const legMatrix = Matrix.Compose(Vector3.One(),
          Quaternion.FromEulerAngles(pitch, yaw, 0), leg.position);
        const world = thighMatrix.multiply(legMatrix);
        const hip = Vector3.TransformCoordinates(new Vector3(0, 0.16, 0), world);
        const knee = Vector3.TransformCoordinates(new Vector3(0, -0.21, 0), world);
        const expectedKnee = Vector3.TransformCoordinates(new Vector3(0, -0.37, 0), legMatrix);
        assert.ok(Vector3.Distance(hip, new Vector3(hipX, 0.69, 0)) < 1e-6);
        assert.ok(Vector3.Distance(knee, expectedKnee) < 1e-6);
        poses++;
      }
    }
  }
}
console.log(`Thigh attachment checks passed: ${poses} lifted, bent, and sideways poses keep both hip and knee attached.`);
