import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/robot/robot.ts', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('const thighDirection ='),
  source.indexOf('function hornRotationMatrix'));
const context = vm.createContext({ Vector3, Quaternion, Math, MAX_KNEE_BEND_RADIANS: 1.35,
  MARCHER_THIGH_LENGTH: 0.315 });
vm.runInContext(`${stripTypeScriptTypes(helper)};
globalThis.attach = attachMarcherThigh;
globalThis.alignKnee = alignMarcherKnee;`, context);
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
        const knee = Vector3.TransformCoordinates(new Vector3(0, -0.155, 0), world);
        const expectedKnee = Vector3.TransformCoordinates(new Vector3(0, -0.315, 0), legMatrix);
        assert.ok(Vector3.Distance(hip, new Vector3(hipX, 0.69, 0)) < 1e-6);
        assert.ok(Vector3.Distance(knee, expectedKnee) < 1e-6);
        for (const flexion of [-0.5, 0, 0.36, 1.35, 2.5]) {
          const joint = { rotation: new Vector3(flexion, 0, 0), rotationQuaternion: null };
          context.alignKnee(thigh, joint);
          const thighDown = Vector3.TransformNormal(Vector3.Down(),
            Matrix.Compose(Vector3.One(), thigh.rotationQuaternion, Vector3.Zero()));
          const calfDown = Vector3.TransformNormal(Vector3.Down(),
            Matrix.Compose(Vector3.One(), joint.rotationQuaternion, Vector3.Zero()));
          const cosine = Vector3.Dot(thighDown.normalize(), calfDown.normalize());
          assert.ok(Math.abs(cosine - Math.cos(Math.max(0, Math.min(1.35, flexion)))) < 1e-6,
            'Actual knee flexion is limited relative to the visible thigh at every hip pitch');
        }
        poses++;
      }
    }
  }
}
console.log(`Thigh attachment checks passed: ${poses} lifted, bent, and sideways poses keep both hip and knee attached.`);
