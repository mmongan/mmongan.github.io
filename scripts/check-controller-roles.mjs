import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const dom = readFileSync(new URL('../src/ui/dom.ts', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const roles = dom.slice(dom.indexOf('export function getNavigationControllerHand'), dom.indexOf('export const sittingModeToggle'));
const scrub = source.slice(source.indexOf('const SCRUB_DEADZONE'), source.indexOf('function updateRobotPathLine'));
const controllers = new Map(), grabs = new Map(), changes = [];
const toggle = { checked: false, addEventListener: (_, handler) => { toggle.change = handler; } };
const calibration = { checked: false };
let axis = 0;
const context = vm.createContext({
  swapControllerRolesToggle: toggle, handThumbJogToggle: null, floorCalibrationToggle: calibration,
  resetThumbJog: state => { state.neutral = null; },
  controllerRegistry: controllers, marcherGrabs: grabs, jogGhostBandBy: count => changes.push(count),
  testAxis: () => axis,
});
vm.runInContext(stripTypeScriptTypes(`${roles.replace(/export /g, '')}\n${scrub}`, { mode: 'transform' }) +
  '\ngetHandThumbJogAxis = () => testAxis();', context);
const jog = () => context.updateHandThumbJog(.0625);
assert.equal(context.getMediaControllerHand(), 'right');
toggle.checked = true; toggle.change();
assert.equal(context.getMediaControllerHand(), 'left');
axis = 1;
controllers.set('right', { inputSource: { handedness: 'right' } });
jog();
assert.equal(changes.length, 0, 'Physical controllers never jog the timeline');
controllers.clear();
controllers.set('tracked', { inputSource: { hand: {} } });
jog();
assert.equal(changes.pop(), 1, 'Hand-input registry entries do not block tracked-thumb jogging');
grabs.set('left', {});
jog();
assert.equal(changes.length, 0, 'Holding with the media hand stops tracked-thumb jogging');
grabs.clear(); calibration.checked = true;
jog();
assert.equal(changes.length, 0, 'Calibration stops jogging');
calibration.checked = false; axis = .1; jog();
assert.equal(changes.length, 0, 'Deadzone prevents drift');
axis = -1; jog();
assert.equal(changes.pop(), -1);
console.log('Media-hand checks passed: role assignment, optional tracked-thumb jogging, controller navigation priority, grab/calibration guards, and deadzone.');
