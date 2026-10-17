import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/xr/webXR.ts', import.meta.url), 'utf8');
const start = source.indexOf('  type NavigationHands =');
const end = source.indexOf('  scene.onBeforeRenderObservable.add(syncNavigationHandedness);', start);
assert.ok(start >= 0 && end > start, 'Thumbstick navigation routing exists');

let watchVisible = false;
let navigationHand = 'left';
const grabbing = new Set();
let detaches = 0;
let availabilityUpdates = 0;
const teleportation = { attached: true, detach() { this.attached = false; detaches++; } };
const context = vm.createContext({
  isHandMenuVisible: () => watchVisible,
  getNavigationControllerHand: () => navigationHand,
  isControllerGrabbing: hand => grabbing.has(hand),
  navigationOptions: { forceHandedness: undefined },
  xrExperience: { teleportation },
  teleportGrid: { setEnabled() {} },
  updateTeleportationAvailability: () => { availabilityUpdates++; teleportation.attached = true; },
});
vm.runInContext(stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' }) +
  '\nthis.sync = syncNavigationHandedness; this.state = () => [navigationHands, navigationOptions.forceHandedness];',
  context);

context.sync();
assert.deepEqual([...context.state()], ['both', undefined], 'Both thumbsticks navigate while the media watch is hidden');
assert.equal(detaches, 0, 'No reattach without a change');

watchVisible = true;
context.sync();
assert.deepEqual([...context.state()], ['left', 'left'], 'Visible media watch reserves the media thumbstick for jogging');
assert.equal(detaches, 1, 'Teleportation reattaches with the new handedness');

navigationHand = 'right';
context.sync();
assert.deepEqual([...context.state()], ['right', 'right'], 'Swapped controller roles move navigation to the other hand');

grabbing.add('right');
context.sync();
assert.deepEqual([...context.state()], ['none', undefined], 'Grabbing with the only navigation hand disables teleporting');
assert.ok(source.includes('isTeleportationEnabled() && navigationHands !== "none"'),
  'Teleportation stays detached when no thumbstick is free');

watchVisible = false;
context.sync();
assert.deepEqual([...context.state()], ['left', 'left'], 'The free hand navigates while the other positions a grabbed marcher or panel');

grabbing.clear();
context.sync();
assert.deepEqual([...context.state()], ['both', undefined], 'Hiding the watch returns both thumbsticks to navigation');
const updates = availabilityUpdates;
context.sync();
assert.equal(availabilityUpdates, updates, 'Steady state does not churn teleportation');

const interaction = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
assert.ok(interaction.includes('if (!isHandMenuVisible() || floorCalibrationToggle?.checked)'),
  'Media thumbstick only jogs while the watch is visible');
console.log('Thumbstick navigation checks passed: both sticks navigate by default, media watch reserves the jog stick, role swap, marcher-grab exclusion, and no steady-state churn.');
