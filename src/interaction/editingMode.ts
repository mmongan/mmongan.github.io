import { Observable } from '@babylonjs/core/Misc/observable';
import type { HandMenuHit } from '../menu/handMenu';

let immersiveEditing = false;
export const onEditingModeChangedObservable = new Observable<boolean>();
export const DESKTOP_PLAYBACK_NOTICE = 'Desktop is playback-only at 1:1. Enter immersive VR/AR to edit the drill.';

export function isDrillEditingEnabled() {
  return immersiveEditing;
}

export function setDrillEditingEnabled(enabled: boolean) {
  if (immersiveEditing === enabled) return;
  immersiveEditing = enabled;
  onEditingModeChangedObservable.notifyObservers(enabled);
}

export function isPlaybackMenuAction(hit: HandMenuHit) {
  switch (hit.action) {
    case 'playPause': case 'rewind': case 'fastForward': case 'stepBack': case 'stepForward': case 'seek':
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
  return immersiveEditing || isPlaybackMenuAction(hit);
}
