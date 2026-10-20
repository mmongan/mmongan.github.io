import { Observable } from '@babylonjs/core/Misc/observable';
import type { HandMenuHit } from '../menu/handMenu';

let immersiveEditing = false;
let draftingTools = false;
export const onEditingModeChangedObservable = new Observable<boolean>();
export const onDraftingToolsChangedObservable = new Observable<boolean>();
export const DRAFTING_TOOLS_NOTICE = 'Enter drafting mode to use the tools.';
export const DESKTOP_PLAYBACK_NOTICE = 'Desktop is playback-only at 1:1. Enter immersive VR/AR to edit the drill.';

export function isDrillEditingEnabled() {
  return immersiveEditing;
}

export function setDrillEditingEnabled(enabled: boolean) {
  if (immersiveEditing === enabled) return;
  immersiveEditing = enabled;
  onEditingModeChangedObservable.notifyObservers(enabled);
}

export function isDraftingToolsEnabled() { return draftingTools; }

export function setDraftingToolsEnabled(enabled: boolean) {
  if (draftingTools === enabled) return;
  draftingTools = enabled;
  onDraftingToolsChangedObservable.notifyObservers(enabled);
}

export function isDraftingToolAction(hit: HandMenuHit) {
  switch (hit.action) {
    case 'drawingTool':
      return !['table', 'tableExit', 'hide', 'stop', 'toolboxStore'].includes(hit.tool);
    case 'marcherPaint':
      return hit.command !== 'done';
    case 'fieldProjector':
      return hit.command !== 'hide';
    case 'marcherPaintColor': case 'instrumentPanelSummon': case 'createMarcher': case 'instrument':
      return true;
    default:
      return false;
  }
}

export function isPlaybackMenuAction(hit: HandMenuHit) {
  switch (hit.action) {
    case 'panelControl':
      return true;
    case 'goToEnd': case 'restart': case 'playPause': case 'rewind': case 'fastForward': case 'stepBack': case 'stepForward': case 'seek':
    case 'marcherPOV': case 'drillChartPad': case 'drillChartHide': case 'drillChartPage': case 'chartGhostMode':
    case 'musicStandSummon': case 'musicStandHide': case 'musicStandStaffToggle':
    case 'recallPanels': case 'xrSettings': case 'xrSettingsHide': case 'fullScaleVR':
      return true;
    case 'xrSetting':
      return hit.setting === 'fullScale' || hit.setting === 'grid';
    default:
      return false;
  }
}

export function isMenuActionAvailable(hit: HandMenuHit) {
  if (isDraftingToolAction(hit) && !draftingTools) return false;
  return immersiveEditing || isPlaybackMenuAction(hit);
}
