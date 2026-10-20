import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = vm.createContext({ Vector3 });
vm.runInContext(stripTypeScriptTypes(read('../src/interaction/panelMenuGesture.ts'), { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, ''), context);
const state = context.createPanelMenuGestureState();
const update = (time, open) => context.updatePanelMenuGesture(state, time, open);
assert.equal(update(0, true), false);
assert.equal(update(.44, true), false, 'Brief palm poses do not summon panels');
assert.equal(update(.46, true), true, 'Holding an open palm summons the menu');
assert.equal(update(2, true), false, 'Holding the palm does not keep moving the menu');
assert.equal(update(2.1, false), false);
assert.equal(update(2.2, true), false, 'Brief tracking jitter does not rearm the gesture');
update(3, false);
update(3.3, false);
assert.equal(update(4, true), false);
assert.equal(update(4.5, true), true, 'Closing the hand rearms a deliberate new summon');
const wrist = Vector3.Zero();
const middle = new Vector3(0, 0, .08);
const tips = [-.04, -.015, .015, .04].map(x => new Vector3(x, 0, .18));
assert.equal(context.isOpenFlatPalm(wrist, middle, Vector3.Up(), tips), true);
assert.equal(context.isOpenFlatPalm(wrist, middle, Vector3.Down(), tips), false, 'Palm-down sweeps are not menu gestures');
assert.equal(context.isOpenFlatPalm(wrist, middle, Vector3.Right(), tips), false);
const curled = tips.map(tip => tip.scale(.5));
assert.equal(context.isOpenFlatPalm(wrist, middle, Vector3.Up(), curled), false);
const bent = tips.map(tip => tip.add(new Vector3(0, .05, 0)));
assert.equal(context.isOpenFlatPalm(wrist, middle, Vector3.Up(), bent), false, 'Bent fingers do not count as a flat palm');
assert.equal(context.isOpenFlatPalm(wrist, wrist, Vector3.Up(), tips), false);

// Run the actual hand-input adapter with simulated tracked joints and clock.
const source = read('../src/interaction/pathInteraction.ts');
const start = source.indexOf('const panelMenuGestureStates =');
const end = source.indexOf('// Deadzone shared', start);
const names = {
  WRIST: 'wrist', MIDDLE_FINGER_PHALANX_PROXIMAL: 'middle', INDEX_FINGER_PHALANX_PROXIMAL: 'index',
  PINKY_FINGER_PHALANX_PROXIMAL: 'pinky', THUMB_TIP: 'thumb',
  INDEX_FINGER_TIP: 'tip0', MIDDLE_FINGER_TIP: 'tip1', RING_FINGER_TIP: 'tip2', PINKY_FINGER_TIP: 'tip3',
};
let time = 0, present = true, up = true, grabbed = false, opens = 0;
const points = { wrist, middle, index: new Vector3(-.03, 0, .08),
  pinky: new Vector3(.03, 0, .08), thumb: new Vector3(-.1, 0, .07),
  ...Object.fromEntries(tips.map((tip, index) => [`tip${index}`, tip])) };
Object.assign(context, {
  performance: { now: () => time * 1000 }, WebXRHandJoint: names,
  scene: { useRightHandedSystem: false }, floorCalibrationToggle: { checked: false },
  marcherGrabs: new Map(), isFloatingPanelGrabbed: () => grabbed,
  getTrackedHandMenuPose: () => ({ normal: up ? Vector3.Up() : Vector3.Down() }),
  summonXRSettingsPanel: () => { opens++; },
  mediaHandTracking: { getHandByHandedness: hand => present && hand === 'left'
    ? { getJointMesh: name => ({ getAbsolutePosition: () => points[name] }) } : null },
});
vm.runInContext(stripTypeScriptTypes(source.slice(start, end)), context);
const frame = value => { time = value; context.updatePanelMenuFromHands(); };
frame(0); frame(.5); frame(1);
assert.equal(opens, 1);
up = false; frame(2); frame(2.3);
up = true; grabbed = true; frame(3); frame(3.5);
assert.equal(opens, 1, 'Held panels suppress the palm launcher');
grabbed = false; context.floorCalibrationToggle.checked = true; frame(4); frame(4.5);
assert.equal(opens, 1, 'Calibration suppresses the palm launcher');
context.floorCalibrationToggle.checked = false;
present = false; frame(5); frame(5.5);
present = true; frame(6); frame(6.5);
assert.equal(opens, 2, 'Tracking recovery permits a new deliberate palm gesture');
assert.match(source, /handInteraction\.updateTabletopHands\(\);\s*updatePanelMenuFromHands\(\);/);
console.log('Palm panel menu passed: flat/upward/open geometry, dwell, one-shot, rearm, jitter, hand-input wiring, grabs, calibration, and tracking recovery.');
