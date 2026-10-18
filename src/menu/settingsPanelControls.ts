import type { HandMenuHit } from './handMenu';
import { sittingModeToggle, fieldGridToggle, gridSnapToggle } from '../ui/dom';

export type SettingsPanelControl = [label: string, action: HandMenuHit, toggle?: HTMLInputElement | null];

export const SETTINGS_PANEL_ROWS: SettingsPanelControl[][] = [
  [['Full scale', { action: 'xrSetting', setting: 'fullScale' }],
    ['Tabletop', { action: 'xrSetting', setting: 'tabletop' }],
    ['Giant', { action: 'xrSetting', setting: 'giant' }]],
  [['Seated', { action: 'xrSetting', setting: 'seated' }, sittingModeToggle],
    ['Field grid', { action: 'xrSetting', setting: 'grid' }, fieldGridToggle],
    ['Grid snap', { action: 'xrSetting', setting: 'snap' }, gridSnapToggle]],
  [['Chart', { action: 'drillChartPad' }], ['Score', { action: 'musicStandSummon' }],
    ['Instruments', { action: 'instrumentPanelSummon' }]],
  [['Drafting table', { action: 'drawingTool', tool: 'table' }],
    ['Drawing tools', { action: 'drawingTool', tool: 'show' }],
    ['Precision', { action: 'drawingTool', tool: 'drafting' }]],
  [['Stencils', { action: 'drawingTool', tool: 'stencils' }],
    ['Cutters', { action: 'drawingTool', tool: 'cutters' }],
    ['Paint', { action: 'marcherPaint', command: 'show' }]],
  [['Projector', { action: 'fieldProjector', command: 'show' }],
    ['Marcher POV', { action: 'marcherPOV' }],
    ['Bring panels', { action: 'recallPanels' }]],
  [['Commit form', { action: 'commitFormation' }],
    ['Undo edit', { action: 'undoErase' }], ['Redo edit', { action: 'redoErase' }]],
];
