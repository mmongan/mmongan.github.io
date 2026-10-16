import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';

const source = readFileSync(new URL('../src/interaction/handInteraction.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
let now = 0;
let previews = 0;
let finishedGrabs = 0;
const robot = {
  rotation: { y: 0 }, position: Vector3.Zero(),
  getAbsolutePosition: () => Vector3.Zero(), isDisposed: () => false,
};
const grabs = new Map();
const context = vm.createContext({
  Vector3, performance: { now: () => now },
  FORMATION_PULL_HOLD_MS: 500, formationPull: null, pendingFormationGlow: null,
  marcherGrabs: grabs, marcherPinchHands: new Set(),
  otherHand: hand => hand === 'left' ? 'right' : 'left',
  findMarcherNearHand: () => robot,
  highlightPendingMarcher: () => { context.pendingFormationGlow = { isEnabled: true, dispose() {} }; },
  getFormationPullControlPoints: () => [Vector3.Zero(), new Vector3(1, 0, 0)],
  getFormationPoints: points => { previews++; return points; },
  createStandingMarcher: () => ({ setEnabled() {}, getChildMeshes: () => [], dispose() {} }),
  setMarcherRenderingGroup() {}, GRABBED_MARCHER_RENDERING_GROUP: 1,
  tryManualMarcherPose: () => true,
  finishMarcherGrab: () => { finishedGrabs++; },
});
const functions = [
  section('  function beginFormationPull(', '  function getFormationPullControlPoints('),
  section('  function finishFormationShaping()', '  function finishCircleResize('),
].join('\n');
vm.runInContext(stripTypeScriptTypes(functions, { mode: 'transform' }), context);
for (const input of ['hand', 'controller']) {
  for (const releaseHand of ['left', 'right']) {
    now = 0;
    grabs.clear();
    const grab = { robot, source: input };
    grabs.set('left', grab);
    assert.equal(context.beginFormationPull('right', Vector3.Zero(), input), true);
    const initialPreviews = previews;
    now = 100;
    context.updateFormationPullPreview();
    assert.equal(context.pendingFormationGlow.isEnabled, true);
    now = 200;
    context.updateFormationPullPreview();
    assert.equal(context.pendingFormationGlow.isEnabled, false, 'Warning visibly flashes');
    now = 499;
    context.updateFormationPullPreview();
    assert.equal(previews, initialPreviews, 'No formation geometry before 500 ms');
    if (input === 'controller') context.updateControllerFormationPull(releaseHand, false, Vector3.Zero());
    else if (releaseHand === 'right') context.finishFormationShaping();
    else context.finishFormationPull(false);
    assert.equal(context.formationPull, null, 'Early release cancels warning');
    assert.equal(context.pendingFormationGlow, null, 'Cancellation clears flashing');
    assert.equal(grabs.get('left'), grab, 'Warning cancellation preserves the original grab');
  }
  now = 0;
  grabs.set('left', { robot, source: input });
  context.beginFormationPull('right', Vector3.Zero(), input);
  now = 500;
  const before = previews;
  context.updateFormationPullPreview();
  assert.equal(context.formationPull.activationTime, null, 'Activates at exactly 500 ms');
  assert.equal(previews, before + 1);
  assert.equal(context.pendingFormationGlow.isEnabled, true, 'Active formation keeps steady highlight');
  context.formationPull.activationTime = 501;
  context.finishFormationPull(false);
}
assert.equal(finishedGrabs, 0, 'Cancelling the warning never places or deletes the held marcher');
console.log('Formation pull delay passed: both inputs, 500 ms boundary, flashing, early release, and grab preservation.');
