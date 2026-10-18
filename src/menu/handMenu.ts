import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { scene } from '../scene/engine';
import type { MarcherInstrument } from '../robot/robot';

export type FormationLetter =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
  | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";

export type HandMenuHit =
  | { action: "fieldProjector"; command: import('../interaction/fieldImageProjector').FieldProjectorCommand }
  | { action: "marcherPaint"; command: "show" | "done" | "paintSelected" }
  | { action: "marcherPaintColor"; color: string }
  | { action: "drawingTool"; tool: import('../interaction/fieldDrawingGeometry').DrawingToolCommand }
  | { action: "playPause" | "rewind" | "fastForward" | "stepBack" | "stepForward" | "fullScaleVR" | "tabletopScale" | "commitFormation" | "eraseMode" | "undoErase" | "redoErase" | "musicStandStaffToggle" }
  | { action: "formationGridSnap" }
  | { action: "formationSpacing"; factor: number }
  | { action: "formationRotate"; radians: number }
  | { action: "formationScale"; factor: number }
  | { action: "formationPreset"; preset: "line" | "arc" | "circle" | "block" | "triangle" | "square" | "pentagon" | "hexagon" | "star" }
  | { action: "formationLetter"; letter: FormationLetter }
  | { action: "drillChartPad" | "recallPanels" | "xrSettings" | "xrSettingsHide" }
  | { action: "xrSetting"; setting: "fullScale" | "tabletop" | "giant" | "seated" | "grid" | "snap" }
  | { action: "musicStandSummon" }
  | { action: "marcherPOV" }
  | { action: "drillChartHide" | "musicStandHide" | "drillChartInsertPage" }
  | { action: "instrument"; instrument: MarcherInstrument }
  | { action: "createMarcher"; instrument: MarcherInstrument }
  | { action: "instrumentPanelSummon" | "instrumentPanelHide" | "finishMarcherPlacement" }
  | { action: "drillChartPage"; direction: 1 | -1 }
  | { action: "drillChartTransition"; kind: "shape" | "pace" | "style" }
  | { action: "drillChartApplyTransition" }
  | { action: "chartGhostMode" | "chartDraftingMode" }
  | { action: "drillChartSaveDraft" | "drillChartResumeDraft" }
  | { action: "seek"; fraction: number };

// Shared action registry for standalone panels and stadium controls.
const buttonActions = new Map<AbstractMesh, HandMenuHit>();

export function registerMenuButton(mesh: AbstractMesh, action: HandMenuHit) {
  buttonActions.set(mesh, action);
  mesh.onDisposeObservable.addOnce(() => buttonActions.delete(mesh));
}

export function isMenuControl(mesh: AbstractMesh) {
  return buttonActions.has(mesh);
}

export function pickMenuControl(ray: Ray): PickingInfo | null {
  return scene.pickWithRay(new Ray(ray.origin, ray.direction.normalizeToNew(), 250), isMenuControl);
}

export function getHandMenuHit(pick: PickingInfo): HandMenuHit | null {
  return pick.pickedMesh ? buttonActions.get(pick.pickedMesh) ?? null : null;
}

export function getHandMenuHitNearPoint(point: Vector3): HandMenuHit | null {
  let nearest: HandMenuHit | null = null;
  let nearestDistance = 0.015;
  let nearestCenterDistance = Infinity;
  for (const [mesh, action] of buttonActions) {
    if (!mesh.isEnabled() || !mesh.isVisible) continue;
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const distance = Math.hypot(
      Math.max(bounds.minimumWorld.x - point.x, 0, point.x - bounds.maximumWorld.x),
      Math.max(bounds.minimumWorld.y - point.y, 0, point.y - bounds.maximumWorld.y),
      Math.max(bounds.minimumWorld.z - point.z, 0, point.z - bounds.maximumWorld.z)
    );
    const centerDistance = Vector3.DistanceSquared(bounds.centerWorld, point);
    if (distance < nearestDistance || (distance === nearestDistance && centerDistance < nearestCenterDistance)) {
      nearest = action;
      nearestDistance = distance;
      nearestCenterDistance = centerDistance;
    }
  }
  return nearest;
}
