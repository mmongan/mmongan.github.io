import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const board = read('../src/field/videoBoard.ts');
assert.doesNotMatch(board, /createVideoBoardSettings|videoBoardSettingsBank/,
  'The video board must not create side-mounted tool/settings banks');
assert.match(board, /createVideoBoardButtons\(/, 'The video board keeps its media controls');

const xr = read('../src/xr/webXR.ts');
assert.doesNotMatch(xr, /summonXRSettingsPanel/,
  'Entering XR must not automatically open the Settings panel');
assert.match(xr, /placeAutomaticFloatingPanels\(\)/,
  'Already-open panels retain their XR placement migration');

const html = read('../src/index.html');
for (const id of ['drillChartPadToggle', 'musicStandToggle', 'instrumentPanelToggle', 'xrSettingsPanelToggle']) {
  const input = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
  assert.ok(input, `${id} remains available`);
  assert.doesNotMatch(input, /\bchecked\b/, `${id} defaults closed`);
}
const interaction = read('../src/interaction/pathInteraction.ts');
assert.match(interaction, /summonXRSettingsPanel\(\)/,
  'Settings remains available through explicit launch actions');
console.log('Panel defaults passed: side banks removed, workspace panels default closed, no automatic XR Settings, and explicit launchers retained.');
