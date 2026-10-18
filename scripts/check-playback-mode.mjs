import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const notices = [], actions = [], modes = [];
const context = vm.createContext({
  Observable,
  showPlacementNotice: message => notices.push(message),
  executeDrawingToolAction: hit => actions.push(hit.tool),
  toggleAllPlayback: () => actions.push('playPause'),
  seekAll: fraction => actions.push(fraction),
  isMarcherPOVActive: () => false,
  setMarcherPOVEnabled: enabled => actions.push(enabled),
  executeXRSetting: setting => actions.push(setting),
});
vm.runInContext(compile(read('../src/interaction/editingMode.ts')), context);
vm.runInContext('onEditingModeChangedObservable.add(enabled => globalThis.modeChanged(enabled));', context);
context.modeChanged = enabled => modes.push(enabled);
const source = read('../src/interaction/pathInteraction.ts');
const start = source.indexOf('function executeMenuAction(');
const end = source.indexOf('\nconst handInteraction =', start);
vm.runInContext(compile(source.slice(start, end)), context);
const editing = [
  { action: 'drawingTool', tool: 'table' }, { action: 'drawingTool', tool: 'show' },
  { action: 'chartDraftingMode' }, { action: 'drillChartInsertPage' },
  { action: 'drillChartTransition', kind: 'shape' }, { action: 'drillChartApplyTransition' },
  { action: 'drillChartSaveDraft' }, { action: 'drillChartResumeDraft' },
  { action: 'createMarcher', instrument: 'trumpet' }, { action: 'instrumentPanelSummon' },
  { action: 'instrument', instrument: 'trumpet' }, { action: 'eraseMode' },
  { action: 'undoErase' }, { action: 'redoErase' }, { action: 'commitFormation' },
  { action: 'marcherPaint', command: 'show' }, { action: 'marcherPaintColor', color: '#ffffff' },
  { action: 'fieldProjector', command: 'show' }, { action: 'formationRotate', radians: 1 },
  { action: 'xrSetting', setting: 'tabletop' }, { action: 'xrSetting', setting: 'giant' },
  { action: 'xrSetting', setting: 'snap' },
];
const viewing = [
  { action: 'playPause' }, { action: 'rewind' }, { action: 'fastForward' }, { action: 'stepBack' },
  { action: 'stepForward' }, { action: 'seek', fraction: 0.5 }, { action: 'marcherPOV' },
  { action: 'drillChartPad' }, { action: 'drillChartPage', direction: 1 }, { action: 'chartGhostMode' },
  { action: 'musicStandSummon' }, { action: 'recallPanels' }, { action: 'xrSettings' },
  { action: 'xrSetting', setting: 'fullScale' }, { action: 'xrSetting', setting: 'grid' },
];
assert.equal(context.isDrillEditingEnabled(), false, 'Desktop defaults to playback-only');
for (const action of editing) {
  assert.equal(context.isMenuActionAvailable(action), false, `Desktop blocks ${JSON.stringify(action)}`);
  context.executeMenuAction(action);
}
assert.equal(actions.length, 0, 'Blocked menu actions cannot mutate the drill');
assert.equal(notices.length, editing.length, 'Blocked actions explicitly explain the XR requirement');
viewing.forEach(action => assert.equal(context.isMenuActionAvailable(action), true));
context.executeMenuAction({ action: 'playPause' });
context.executeMenuAction({ action: 'seek', fraction: 0.5 });
context.executeMenuAction({ action: 'marcherPOV' });
assert.deepEqual(actions, ['playPause', 0.5, true], 'Desktop still dispatches playback, seeking and POV');
context.setDrillEditingEnabled(true);
editing.forEach(action => assert.equal(context.isMenuActionAvailable(action), true));
context.executeMenuAction({ action: 'drawingTool', tool: 'table' });
assert.equal(actions.at(-1), 'table', 'Immersive sessions retain editing tools');
context.setDrillEditingEnabled(true);
assert.deepEqual(modes, [true], 'Repeated XR state does not reset active editing');
context.setDrillEditingEnabled(false);
assert.equal(context.isMenuActionAvailable(editing[0]), false, 'XR exit restores playback-only');
assert.deepEqual(modes, [true, false]);
console.log('Playback-only checks passed: desktop restrictions, explicit feedback, transport/viewing access, XR editing, idempotent lifecycle, and exit reset.');
