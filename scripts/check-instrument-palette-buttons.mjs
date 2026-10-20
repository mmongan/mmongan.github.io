import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const start = source.indexOf('const panelMenuButtonHeld =');
const end = source.indexOf('// In placement mode,', start);
assert.ok(start >= 0 && end > start);
const controllers = new Map();
let opens = 0;
const context = vm.createContext({
  controllerRegistry: controllers, summonXRSettingsPanel: () => { opens++; },
});
vm.runInContext(stripTypeScriptTypes(source.slice(start, end)), context);
const update = () => context.updatePanelMenuFromControllers();
for (const [hand, button] of [['right', 'a-button'], ['right', 'b-button'],
  ['left', 'x-button'], ['left', 'y-button']]) {
  let pressed = false;
  controllers.clear();
  controllers.set(hand, {
    inputSource: {},
    motionController: { getComponent: id => id === button ? { pressed } : undefined },
  });
  update();
  const before = opens;
  pressed = true;
  update();
  update();
  assert.equal(opens, before + 1, `${button} opens the panel menu only once while held`);
  pressed = false;
  update();
  pressed = true;
  update();
  assert.equal(opens, before + 2, 'Releasing and pressing again recalls the same menu');
}
for (const index of [4, 5]) {
  controllers.clear();
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false }));
  controllers.set(`raw-${index}`, { inputSource: { gamepad: { buttons } } });
  update();
  const before = opens;
  buttons[index].pressed = true;
  update();
  update();
  assert.equal(opens, before + 1, `Raw xr-standard face button ${index} opens the menu once`);
  controllers.clear();
  controllers.set('tracked', { inputSource: { hand: {}, gamepad: { buttons } } });
  update();
  assert.equal(opens, before + 1, 'Tracked hands do not consume controller shortcuts');
}
assert.ok(source.includes('panelMenuButtonHeld.delete(handedness);'),
  'Disconnect clears button state for replacement controllers');
assert.ok(source.includes('  updatePanelMenuFromControllers();'), 'Controller update runs the launcher');
console.log('Panel shortcuts passed: X/Y/A/B open one shared menu, press edges, raw fallback, tracked-hand exclusion, and disconnect cleanup.');
