import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/xr/webXR.ts', import.meta.url), 'utf8');
const start = source.indexOf('  function getCameraSittingPosture(');
const end = source.indexOf('  function applyPostureHeight(', start);
assert.ok(start >= 0 && end > start);
let now = 0;
let updates = [];
const camera = { realWorldHeight: 1.7 };
const context = vm.createContext({
  detectedSitting: null, pendingSitting: null, pendingPostureSince: 0,
  playerFloorOffset: 0,
  floorCalibrationToggle: { checked: false },
  sittingModeToggle: { checked: false },
  xrExperience: { baseExperience: { sessionManager: { worldScalingFactor: 1 } } },
  performance: { now: () => now },
  getTrackedPlayerHeight: camera => camera.realWorldHeight - context.playerFloorOffset,
  getHeadsetFloorY: () => 3,
  setTableHeightForPosture: (sitting, height) => {
    context.sittingModeToggle.checked = sitting;
    updates.push({ sitting, height });
  },
});
vm.runInContext(stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' }), context);
const tick = (height, elapsed = 0) => {
  camera.realWorldHeight = height;
  now += elapsed;
  context.updateDetectedPosture(camera);
};
const expectHeight = height => assert.ok(Math.abs(updates.at(-1).height - height) < 1e-9);

tick(1.7);
tick(1.7, 1000);
assert.equal(context.detectedSitting, false);
expectHeight(4);
updates = [];
tick(1.1);
tick(1.7, 500);
tick(1.7, 600);
assert.equal(updates.length, 0, 'Brief crouching does not lower the table');
tick(1.1);
context.updateTableHeightFromCamera(camera);
assert.equal(updates.at(-1).sitting, true, 'Table entry uses current posture before debounce completes');
expectHeight(3.65);
tick(1.1, 1000);
assert.equal(context.detectedSitting, true);
tick(1.45, 1000);
assert.equal(context.detectedSitting, true, 'Hysteresis prevents flickering near the threshold');
tick(1.7);
tick(1.7, 1000);
assert.equal(context.detectedSitting, false, 'Standing restores standing table height');
expectHeight(4);
updates = [];
tick(1.1);
context.floorCalibrationToggle.checked = true;
tick(1.1, 2000);
assert.equal(updates.length, 0, 'Floor calibration pauses posture detection');
context.floorCalibrationToggle.checked = false;
tick(1.1);
tick(1.1, 999);
assert.equal(updates.length, 0, 'Calibration time does not count toward posture settling');
tick(1.1, 1);
assert.equal(context.detectedSitting, true);
updates = [];
tick(NaN, 2000);
tick(0, 2000);
assert.equal(updates.length, 0, 'Invalid poses do not move the table');
context.detectedSitting = null;
context.playerFloorOffset = 0.4;
camera.realWorldHeight = 1.6;
context.updateTableHeightFromCamera(camera);
assert.equal(updates.at(-1).sitting, true, 'Classification uses height above the calibrated floor');
expectHeight(4.15);
context.playerFloorOffset = 0;
context.xrExperience.baseExperience.sessionManager.worldScalingFactor = 2;
camera.realWorldHeight = 2.4;
context.updateTableHeightFromCamera(camera);
assert.equal(updates.at(-1).sitting, true, 'World scale does not alter posture classification');
expectHeight(4.5);
context.updateTableHeightFromCamera(camera, false);
assert.equal(updates.at(-1).sitting, false, 'Explicit posture override remains available');
expectHeight(4.5);
console.log('Table posture passed: current-pose entry, seated/standing transitions, debounce, hysteresis, calibration, invalid poses, floor offsets, world scale, and eye clearance.');
