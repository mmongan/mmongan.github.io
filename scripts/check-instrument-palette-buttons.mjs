import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction/pathInteraction.ts', import.meta.url), 'utf8');
const start = source.indexOf('const instrumentPaletteButtonHeld =');
const end = source.indexOf('// In placement mode,', start);
assert.ok(start >= 0 && end > start);
const controllers = new Map();
let opens = 0;
const context = vm.createContext({
  controllerRegistry: controllers, summonInstrumentPanel: () => { opens++; },
});
vm.runInContext(stripTypeScriptTypes(source.slice(start, end)), context);
const update = () => context.updateInstrumentPaletteFromControllers();
for (const [hand, button] of [['left', 'x-button'], ['right', 'a-button']]) {
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
  assert.equal(opens, before + 1, `${button} opens the palette`);
  update();
  assert.equal(opens, before + 1, 'Holding a button does not repeatedly summon the palette');
  pressed = false;
  update();
  pressed = true;
  update();
  assert.equal(opens, before + 2, 'A new press summons it again');
}
controllers.clear();
const buttons = Array.from({ length: 6 }, () => ({ pressed: false }));
controllers.set('raw', { inputSource: { gamepad: { buttons } } });
update();
const beforeRaw = opens;
buttons[5].pressed = true;
update();
assert.equal(opens, beforeRaw, 'B/Y does not open the palette');
buttons[4].pressed = true;
update();
assert.equal(opens, beforeRaw + 1, 'Standard xr-standard A/X button works without a profile');
controllers.clear();
controllers.set('tracked', { inputSource: { hand: {}, gamepad: { buttons } } });
update();
assert.equal(opens, beforeRaw + 1, 'Tracked hands do not consume controller shortcuts');
assert.ok(source.includes('instrumentPaletteButtonHeld.delete(handedness);'),
  'Disconnect clears the edge state for replacement controllers');
const draftingStart = source.indexOf('const draftingToolsButtonHeld =');
const draftingEnd = source.indexOf('// Deflecting the media controller', draftingStart);
assert.ok(draftingStart >= 0 && draftingEnd > draftingStart);
let draftingOpens = 0;
context.executeDrawingToolAction = action => {
  assert.equal(action.action, 'drawingTool');
  assert.equal(action.tool, 'drafting');
  draftingOpens++;
};
vm.runInContext(stripTypeScriptTypes(source.slice(draftingStart, draftingEnd)), context);
for (const [hand, button] of [['left', 'y-button'], ['right', 'b-button']]) {
  let pressed = false;
  controllers.clear();
  controllers.set(hand, {
    inputSource: {},
    motionController: { getComponent: id => id === button ? { pressed } : undefined },
  });
  context.updateDraftingToolsFromControllers();
  const before = draftingOpens;
  pressed = true;
  context.updateDraftingToolsFromControllers();
  assert.equal(draftingOpens, before + 1, `${button} opens drafting tools`);
  context.updateDraftingToolsFromControllers();
  assert.equal(draftingOpens, before + 1, 'Holding Y/B does not repeatedly recall the tray');
  pressed = false;
  context.updateDraftingToolsFromControllers();
  pressed = true;
  context.updateDraftingToolsFromControllers();
  assert.equal(draftingOpens, before + 2);
}
controllers.clear();
buttons[4].pressed = true;
buttons[5].pressed = false;
controllers.set('rawDrafting', { inputSource: { gamepad: { buttons } } });
const beforeDrafting = draftingOpens;
context.updateDraftingToolsFromControllers();
assert.equal(draftingOpens, beforeDrafting, 'A/X does not open drafting tools');
buttons[5].pressed = true;
context.updateDraftingToolsFromControllers();
assert.equal(draftingOpens, beforeDrafting + 1, 'Raw B/Y opens drafting tools without a profile');
controllers.clear();
controllers.set('trackedDrafting', { inputSource: { hand: {}, gamepad: { buttons } } });
context.updateDraftingToolsFromControllers();
assert.equal(draftingOpens, beforeDrafting + 1, 'Tracked hands do not activate Y/B shortcuts');
assert.ok(source.includes('draftingToolsButtonHeld.delete(handedness);'));
console.log('Instrument palette shortcuts passed: X, A, hold/repress, raw gamepad fallback, and tracked-hand exclusion.');
console.log('Drafting shortcuts passed: Y, B, hold/repress, raw fallback, and no A/X or tracked-hand conflict.');
