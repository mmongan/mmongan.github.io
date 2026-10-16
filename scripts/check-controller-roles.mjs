import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const dom = readFileSync(new URL('../src/ui/dom.ts', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const roles = dom.slice(dom.indexOf('export function getNavigationControllerHand'), dom.indexOf('export const sittingModeToggle'));
const scrub = interaction.slice(interaction.indexOf('const SCRUB_DEADZONE'), interaction.indexOf('function updateRobotPathLine'));
const toggle = { checked: false, addEventListener: (_, handler) => { toggle.change = handler; } };
const controllers = new Map();
const changes = [];
let menuVisible = true;
const context = vm.createContext({
  swapControllerRolesToggle: toggle,
  handThumbJogToggle: null,
  floorCalibrationToggle: null,
  resetThumbJog: (state) => { state.neutral = null; state.settlingSeconds = 0; },
  controllerRegistry: controllers,
  marcherGrabs: new Map(),
  isHandMenuVisible: () => menuVisible,
  jogGhostBandBy: (counts) => changes.push(counts),
  isFingerspellingNamingActive: () => false,
});
vm.runInContext(stripTypeScriptTypes(`${roles.replace(/export /g, '')}\n${scrub}`, { mode: 'transform' }), context);
const checkRoles = (navigation, media) => {
  assert.equal(vm.runInContext('getNavigationControllerHand()', context), navigation);
  assert.equal(vm.runInContext('getMediaControllerHand()', context), media);
};
const controller = (handedness, x) => ({
  inputSource: { handedness },
  motionController: { getComponentOfType: () => ({ axes: { x } }) },
});
const jog = (seconds) => vm.runInContext(`updateScrubFromControllers(${seconds})`, context);

controllers.set('left', controller('left', -1));
controllers.set('right', controller('right', 1));
checkRoles('left', 'right');
jog(0.0625);
assert.equal(changes.pop(), 1);
context.marcherGrabs.set('right', { source: 'controller' });
jog(1);
assert.equal(changes.length, 0, 'A held marcher consumes its controller stick instead of jogging playback');
context.marcherGrabs.clear();
toggle.checked = true;
toggle.change();
checkRoles('right', 'left');
jog(0.0625);
assert.equal(changes.pop(), -1);

controllers.get('left').motionController.getComponentOfType = () => ({ axes: { x: 0.1 } });
jog(1);
assert.equal(changes.length, 0);
controllers.get('left').motionController.getComponentOfType = () => ({ axes: { x: 1 } });
jog(0.05);
toggle.checked = false;
toggle.change();
jog(0.025);
assert.equal(changes.length, 0, "Swapping must discard the previous hand's partial count");
menuVisible = false;
jog(1);
assert.equal(changes.length, 0);
menuVisible = true;
controllers.delete('right');
controllers.set('unknown', controller('none', 1));
jog(1);
assert.equal(changes.length, 0, 'Navigation and unassigned controllers must not jog media');

console.log('Controller role checks passed: both assignments, exclusive jogging, deadzone, menu gating, and swap reset.');
