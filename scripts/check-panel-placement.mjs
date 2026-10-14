import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const chartSource = readFileSync(new URL('../src/menu/drillChartPad.ts', import.meta.url), 'utf8');
const scoreSource = readFileSync(new URL('../src/menu/musicStand.ts', import.meta.url), 'utf8');
const chartPlace = chartSource.match(/function placeInFrontOfViewer\(\) \{[\s\S]*?\n\}/)[0];
const scorePlace = scoreSource.match(/  function place\(\) \{[\s\S]*?\n  \}/)[0];
const chartConstants = chartSource.match(/^const (?:DESKTOP_)?SPAWN_(?:DISTANCE|DROP) = .*;$/gm).join('\n');
const root = () => ({ position: Vector3.Zero(), lookAt() {}, setEnabled() {} });

for (const inXR of [false, true]) {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(forward.z, 0, -forward.x);
    const eye = new Vector3(7, 1.7, -3);
    const camera = {
      globalPosition: eye,
      getClassName: () => inXR ? 'WebXRCamera' : 'UniversalCamera',
      getDirection: () => forward.clone(),
      getForwardRay: () => ({ direction: forward.clone() }),
    };
    const chart = root();
    const score = root();
    const interaction = { userPlaced: true, release() {} };
    const context = vm.createContext({
      Vector3, Quaternion, scene: { activeCamera: camera },
      pad: { root: chart }, root: score, interaction,
      placedCamera: null, placed: false, enabled: true,
    });
    vm.runInContext(`${chartConstants}\n${chartPlace}\n${scorePlace}\nplaceInFrontOfViewer(); place();`, context);
    const chartOffset = chart.position.subtract(eye);
    const scoreOffset = score.position.subtract(eye);
    assert.ok(Math.abs(Vector3.Dot(chartOffset, right) + 0.35) < 1e-6, 'Chart opens on viewer left');
    assert.ok(Math.abs(Vector3.Dot(scoreOffset, right) - 0.6) < 1e-6, 'Score opens on viewer right');
    assert.ok(Math.abs(Vector3.Dot(chartOffset, forward) - (inXR ? 0.55 : 0.75)) < 1e-6);
    assert.ok(Math.abs(Vector3.Dot(scoreOffset, forward) - (inXR ? 1.15 : 1.35)) < 1e-6);
    assert.ok(Math.abs(chartOffset.y + (inXR ? 0.22 : 0.08)) < 1e-6);
    assert.ok(Math.abs(scoreOffset.y - (inXR ? -0.4 : 0.12)) < 1e-6);
    assert.equal(interaction.userPlaced, false, 'Explicit score placement resets user-positioned state');
  }
}
console.log('Panel placement checks passed: chart left, score right, four headings, desktop/XR, and preserved distances/heights.');
