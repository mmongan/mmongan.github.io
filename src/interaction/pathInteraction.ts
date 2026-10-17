import { Ray } from '@babylonjs/core/Culling/ray';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Curve3 } from '@babylonjs/core/Maths/math.path';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
  attachToARTransform,
  isARTabletopModeActive,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { createSelectionEditor } from './selectionEditor';
import {
  alignFormationPoints, constrainDrillMovement, snapDrillPoint, transformFormationPoint,
  type FormationAlignment, type FormationTransform,
} from './drillEditing';
import {
  formationEditor, formationPresetSelect, formationSelection, formationSpacingInput,
  formationOriginX, formationOriginZ, formationMoveX, formationMoveZ, formationRotation,
  formationScale, formationEditorStatus, gridSnapToggle, gridSnapInterval, angleSnapToggle,
  gridSnapX, gridSnapZ, formationLockX, formationLockZ,
} from '../ui/dom';
import { getMediaControllerHand, swapControllerRolesToggle, handThumbJogToggle } from '../ui/dom';
import { resetThumbJog, updateThumbJog } from './thumbJogGesture';
import { hideInstrumentPanel, summonInstrumentPanel } from '../menu/instrumentPanel';
import {
  executeDrawingToolAction, handleDrawingPointer, initFieldDrawingTools,
  isDrawingPointerActive, isFieldDrawingToolActive, selectDrawingGuideNear, snapToSelectedDrawingGuide,
  clearDrawingGuides, getSelectedDrawingGuidePoints, exportDrawingWorkspace, importDrawingWorkspace,
} from './fieldDrawingTools';
import {
  captureChartPageGuides, canSwapChartPageGuides, forgetOtherChartPageGuides, initChartPageGuides,
  insertChartPageGuides, restoreChartPageGuides, showChartPageGuides,
} from './chartPageGuides';
import {
  CHART_PAGE_DRAFT_KEY, parseChartPageDraft, roundVector, serializeChartPageDraft, type ChartPageDraft,
} from '../robot/chartPageDraft';
import type { ThumbJogState } from './thumbJogGesture';
import {
  activeControllers as controllerRegistry,
  getActiveControllers as getRegisteredControllers,
  removeActiveController as unregisterActiveController,
  setActiveController as registerActiveController,
  updateARResizeFromControllers as resizeFromControllers,
} from './controllers';
import {
  createLowPolyRobot,
  duplicateMarcherSchedule,
  walkRobotAlongPath,
  findRobotRoot,
  registerRobotPath,
  toggleAllPlayback,
  rewindAll,
  fastForwardAll,
  stepAll,
  seekAll,
  seekToCount,
  jogGhostBandBy,
  isGhostBandMesh,
  jumpToGhostBandTime,
  getRobotColor,
  setCollisionMarkerParent,
  setCollisionMarkersVisible,
  seekToCollisionMarker,
  getGlobalProgress,
  getRobotCounts,
  captureMarcherMovement,
  restoreMarcherMovement,
  setRobotCountPosition,
  setRobotHeld,
  placeRobot,
  getBlankChartPageState,
  placeNearestBlankPageMarcher,
  directAdjacentBlankPageMarchers,
  hasRecentBlankPagePlacement,
  cycleChartTransition,
  getChartTransition,
  getChartTransitionLabels,
  getRoutedRobots,
  setRobotTransition,
  clearRobotPath,
  refreshCollisionMarkers,
  COLLISION_MARKER_RADIUS_YARDS,
  resetRobotSchedule,
  disposeAllRobots,
  walkRobotAlongCounts,
  suspendRobotForErase,
  setSelectedInstrument,
  getSelectedInstrument,
  setMarcherInstrument,
  setMarchTempo,
  playAll,
  registerRobotCounts,
  onMarcherStrideLimited,
  captureMarcherSchedules,
  captureBlankChartPage,
  restoreMarcherSchedule,
  resumeBlankChartPage,
  setChartTransition,
  getDrillTransportState,
  getMarchTempo,
  MARCHER_INSTRUMENTS,
  MARCHING_GAITS,
  TRANSITION_PATH_SHAPES,
  TRANSITION_PACES,
  TRANSITION_STYLE_INDICES,
} from '../robot/robot';
import { duplicateDrillButton, duplicateDrillStatus } from '../ui/dom';
import { MAX_MARCHING_STRIDE_YARDS } from '../robot/gaitSelection';
import { getTrackedHandMenuPose } from '../menu/handMenuPose';
import { createPalmSweepState, updatePalmSweep, type PalmSweepState } from './palmSweepGesture';
import { onManualPlacementBlocked, tryManualMarcherPose, tryManualMarcherPoses } from '../robot/manualPlacement';
import type { MarcherInstrument } from '../robot/robot';
import { getOpenMarchSectionInstrument, loadOpenMarchFromUrl, OPEN_MARCH_EXAMPLE, OPEN_MARCH_URL_PARAM } from '../robot/openMarchUrl';
import type { OpenMarchImportedDrill } from '../robot/openMarchFormat';
import { clearDrillLabels, getDrillLabel, setDrillLabels, setDrillLabelsVisible } from '../robot/drillLabels';
import { clearShowInfo, setShowInfo } from '../menu/showInfoPanel';
import { cycleMusicStandStaff, setMusicStandVisible, summonMusicStand } from '../menu/musicStand';
import { isMarcherPOVActive, setMarcherPOVEnabled } from '../camera/marcherPOV';
import { getHandMenuHit, getHandMenuHitNearPoint, pickMenuControl, setMenuHandTracking, setFormationCommitAvailable, setFormationLibraryOpen, setFormationLibraryPage, setFormationLibraryAnchorAvailable, setEraseModeActive, setEraseHistoryAvailable, setDrillChartPadActive, setInstrumentMenuActive, isHandMenuVisible, isMenuControl, toggleControllerHandMenu } from '../menu/handMenu';
import {
  flipDrillChartPage,
  getDrillChartPageIndex,
  getDrillChartTransitionSpan,
  insertBlankDrillChartPage,
  redrawDrillChartPad,
  summonDrillChartPad,
  onDrillChartPadVisibilityChange,
  setDrillChartPadVisible,
} from '../menu/drillChartPad';
import {
  beginFloatingPanelGrab, beginFloatingPanelPointerDrag, endFloatingPanelGrab,
  getFloatingPanelButtonNearPoint, getFloatingPanelNear, isFloatingPanelGrabbed, isFloatingPanelMesh,
  nudgeFloatingPanelDistance, pickFloatingPanel, updateFloatingPanelGrab, telescopeFloatingPanelGrab,
  updateFloatingPanelPointerDrag,
} from '../menu/floatingPanel';
import type { FormationLetter } from '../menu/handMenu';
import { createHandInteraction } from './handInteraction';
import { executeMarcherPaintAction, initMarcherPaint, isMarcherPainting, stopMarcherPainting, tryPaintMarcher } from './marcherPaint';
import { executeFieldProjectorAction, initFieldImageProjector } from './fieldImageProjector';
import { EditHistory } from './editHistory';
import {
  isScoreboardGaitPick,
  isScoreboardHornPosePick,
  isScoreboardTempoPick,
  isScoreboardTempoScreen,
  updateScoreboardGaitFromPick,
  updateScoreboardHornPoseFromPick,
  updateScoreboardTempoFromPick,
} from '../field/scoreboard';
import { canvas, collisionMarkersToggle, floorCalibrationToggle, fullScaleVRButton, tabletopScaleButton, showAllPathsToggle, placementModeToggle, eraseModeToggle, drillChartPadToggle, insertChartPageButton, saveChartDraftButton, resumeChartDraftButton, marcherInstrumentRadios, undoEraseButton, redoEraseButton, addRandomRobotsButton, marcherCountInput, marcherCountValue, generateDrillButton, openMarchForm, openMarchUrlInput, openMarchButton, openMarchExampleButton, openMarchStatus, drillLabelsToggle } from '../ui/dom';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS, FIELD_SURFACE_Y } from '../field/constants';
import { buildSynchronizedPaths, FORMATION_SPACING_YARDS, generateMarchingDrillPaths, getDrillSectionInstrument, MARCH_STEP_YARDS } from '../robot/drill';
import { isGuideOnField } from './fieldDrawingGeometry';

// Track the live XR controllers and the state of a grab/manipulation gesture.
// Hand-distance sensitivity for scaling: fine control near the small end of
// the range, coarse/fast control between table size and full 1:1.
const SCALE_EXPONENT_AT_MIN = 0.4;
const SCALE_EXPONENT_AT_MAX = 1.6;

const pinchState = {
  active: false,
  startDistance: 0,
  startScale: 1,
  scaleExponent: SCALE_EXPONENT_AT_MIN,
  // The grabbed point, expressed in the content's local (unscaled) space, so
  // scale/rotation changes stay anchored under the grip midpoint.
  localAnchor: new Vector3(),
  startYaw: 0,
  startRotation: 0,
};

function resetPinchState() {
  pinchState.active = false;
  pinchState.startDistance = 0;
  pinchState.startScale = 1;
  pinchState.scaleExponent = SCALE_EXPONENT_AT_MIN;
  pinchState.localAnchor = new Vector3();
  pinchState.startYaw = 0;
  pinchState.startRotation = 0;
}

// Logarithmically blend the sensitivity exponent by where `scale` sits between
// the min and max scale, so equal hand movement covers a small absolute range
// near the min (lots of control) and a large absolute range near the max.
function getScaleExponentFor(scale: number): number {
  const { min, max } = getARScaleRange();
  const t = (Math.log(scale) - Math.log(min)) / (Math.log(max) - Math.log(min));
  const clampedT = Math.min(1, Math.max(0, t));
  return SCALE_EXPONENT_AT_MIN + (SCALE_EXPONENT_AT_MAX - SCALE_EXPONENT_AT_MIN) * clampedT;
}

function rotateAroundY(vector: Vector3, angle: number): Vector3 {
  return Vector3.TransformCoordinates(vector, Matrix.RotationY(angle));
}

function isGripPressed(controller: WebXRInputSource): boolean {
  const squeeze = controller.motionController?.getComponentOfType('squeeze');
  return !!squeeze?.pressed || !!controller.inputSource.gamepad?.buttons?.[1]?.pressed;
}

function getControllerPosition(controller: WebXRInputSource) {
  // Use the physical grip mesh if present; otherwise fall back to the pointer.
  return controller.grip ?? controller.pointer;
}

// Caller guarantees pinchState is already active with a valid startDistance.
function getScaleFromControllerDistance(distance: number) {
  const { min, max } = getARScaleRange();
  const scaleRatio = distance / pinchState.startDistance;
  const easedRatio = Math.pow(scaleRatio, pinchState.scaleExponent);
  const relativeScale = pinchState.startScale * easedRatio;
  return Math.min(max, Math.max(min, relativeScale));
}

function getControllerYaw(leftPosition: Vector3, rightPosition: Vector3) {
  const dx = rightPosition.x - leftPosition.x;
  const dz = rightPosition.z - leftPosition.z;
  return Math.atan2(dx, dz);
}

export function setActiveController(controller: WebXRInputSource) {
  registerActiveController(controller);
}

export function removeActiveController(controller: WebXRInputSource) {
  unregisterActiveController(controller, (handedness) => {
    endFloatingPanelGrab(handedness);
    padGrabButtons.delete(handedness);
    handInteraction.cancelControllerFormation(handedness);
    finishMarcherGrab(handedness, false);
    placementDrafts.get(handedness)?.dispose();
    placementDrafts.delete(handedness);
    triggerHeld.delete(handedness);
    gripHeld.delete(handedness);
    instrumentPaletteButtonHeld.delete(handedness);
    draftingToolsButtonHeld.delete(handedness);
    stopRotationHandleDrag(handedness);
  });
}

export function updateARResizeFromControllers() {
  resizeFromControllers(eraseMode || marcherGrabs.size > 0 || isFloatingPanelGrabbed());
}

// The path/robot live under the shared AR transform so they scale, move, and
// rotate together with the field instead of staying world-scale.
const pathRoot = new TransformNode("robotPathRoot", scene);
attachToARTransform(pathRoot);
setCollisionMarkerParent(pathRoot);

const ROBOT_PATHS_STORAGE_KEY = "chartxr.robotPaths";
const MAX_STORED_PATHS = 20;
// Selecting a robot reveals every other robot's path too (so their routes
// stay visible for context), but at reduced alpha so the selected one stands out.
const PATH_SELECTED_ALPHA = 1;
const PATH_UNSELECTED_ALPHA = 0.25;

type StoredPoint = [number, number, number];

function loadStoredPaths(): Vector3[][] {
  // try {
  //   const raw = localStorage.getItem(ROBOT_PATHS_STORAGE_KEY);
  //   if (!raw) return [];
  //   const parsed = JSON.parse(raw) as StoredPoint[][];
  //   return parsed.map((path) => path.map(([x, y, z]) => new Vector3(x, y, z)));
  // } catch {
  //   return [];
  // }
  return [];
}

function saveStoredPaths(paths: Vector3[][]) {
  // try {
  //   const serialized: StoredPoint[][] = paths
  //     .slice(-MAX_STORED_PATHS)
  //     .map((path) => path.map((point): StoredPoint => [point.x, point.y, point.z]));
  //   localStorage.setItem(ROBOT_PATHS_STORAGE_KEY, JSON.stringify(serialized));
  // } catch {
  //   // Storage can be unavailable (private browsing, quota, etc.) — drawing still works, it just won't persist.
  // }
}

const storedPaths: Vector3[][] = loadStoredPaths();
const eraseHistory = new EditHistory(() => {
  if (undoEraseButton) undoEraseButton.disabled = !eraseHistory.canUndo;
  if (redoEraseButton) redoEraseButton.disabled = !eraseHistory.canRedo;
  setEraseHistoryAvailable(eraseHistory.canUndo, eraseHistory.canRedo);
});


// Full path history and persistent path line per robot (a robot's line covers
// its whole route so far, including any extensions, not just the last segment).
const robotPaths = new Map<TransformNode, Vector3[]>();
const robotPathLines = new Map<TransformNode, Mesh>();
// Reverse lookup so clicking/triggering a drawn path line selects its robot.
const pathLineOwner = new Map<AbstractMesh, TransformNode>();
let selectedRobot: TransformNode | null = null;
let showAllPaths = !!showAllPathsToggle?.checked;
let pathsHiddenByFieldClick = true;

// Paths/segments are drawn as tubes connecting the grab-point balls instead
// of thin CreateLines meshes, so drawn routes are actually visible in VR.
const PATH_TUBE_RADIUS_YARDS = 0.05;
const PATH_TUBE_TESSELLATION = 6;
// Drawn and planned paths are densely sampled, mostly along straight runs.
// Points closer than this to the simplified line are dropped from the tube
// geometry only; the path data itself keeps every sample.
const PATH_TUBE_SIMPLIFY_TOLERANCE_YARDS = 0.01;

function distanceToSegment(point: Vector3, start: Vector3, end: Vector3): number {
  const segment = end.subtract(start);
  const lengthSquared = segment.lengthSquared();
  if (lengthSquared < 1e-12) return Vector3.Distance(point, start);
  const t = Math.min(1, Math.max(0, Vector3.Dot(point.subtract(start), segment) / lengthSquared));
  return Vector3.Distance(point, start.add(segment.scale(t)));
}

// Ramer–Douglas–Peucker simplification of a polyline.
function simplifyTubePath(points: Vector3[], tolerance: number): Vector3[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]);
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, index) => keep[index]);
}

function createTubeLine(name: string, _points: Vector3[], color: Color3, existingMaterial?: StandardMaterial): Mesh {
  // Keep segment bookkeeping without rendering or picking route geometry.
  const tube = new Mesh(name, scene);
  tube.isVisible = false;
  tube.isPickable = false;
  const material = existingMaterial ?? new StandardMaterial(`${name}Material`, scene);
  if (!existingMaterial) {
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.5);
    material.specularColor = new Color3(0, 0, 0);
  }
  tube.material = material;
  tube.parent = pathRoot;
  return tube;
}

function setTubeLineAppearance(tube: Mesh, color: Color3, alpha: number) {
  const material = tube.material as StandardMaterial;
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.5);
  material.alpha = alpha;
}

// Selected robot's path is always shown fully opaque; every other robot's
// path becomes visible-but-transparent once anything is selected, so the
// selected route stands out without hiding the rest of the drill for context.
export function refreshPathLineAppearance() {
  robotPathLines.forEach((line, robot) => {
    const isSelected = robot === selectedRobot;
    const color = getRobotColor(robot);
    setTubeLineAppearance(line, color, isSelected ? PATH_SELECTED_ALPHA : PATH_UNSELECTED_ALPHA);
    line.setEnabled(!pathsHiddenByFieldClick &&
      (isMarcherPOVActive() ? isSelected : showAllPaths || isSelected || selectedRobot !== null));
  });
}

export function selectRobot(robot: TransformNode | null, revealPaths = false) {
  if (revealPaths) pathsHiddenByFieldClick = false;
  selectedRobot = robot;
  refreshPathLineAppearance();
  refreshStepHandles();
  segments.forEach(updateSegmentHandleVisibility);
  refreshFormationEditor();
}

export function getSelectedMarcher() { return selectedRobot; }
export function getSelectableMarchers() { return [...robotPaths.keys()]; }

// One small grab handle per precalculated marching step (count) of the
// currently selected robot, so individual footsteps can be nudged directly
// instead of only reshaping the original drawn curve. Handles alternate to
// the left/right edge of the path tube to indicate which foot each step is.
const STEP_HANDLE_SIZE = 0.18;
const STEP_HANDLE_SIDE_OFFSET = PATH_TUBE_RADIUS_YARDS + STEP_HANDLE_SIZE / 2;
let stepHandles: Mesh[] = [];
const stepHandleOwner = new Map<AbstractMesh, { robot: TransformNode; index: number }>();

// Offsets a step's center-line position sideways onto the tube's edge,
// alternating side by step index (even = right foot, odd = left foot).
function stepHandlePosition(position: Vector3, rotationY: number, index: number): Vector3 {
  const side = index % 2 === 0 ? 1 : -1;
  const right = new Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
  const offset = position.add(right.scale(STEP_HANDLE_SIDE_OFFSET * side));
  offset.y += 0.05;
  return offset;
}

function clearStepHandles() {
  stepHandles.forEach((handle) => {
    stepHandleOwner.delete(handle);
    handle.dispose();
  });
  stepHandles = [];
}

function refreshStepHandles() {
  clearStepHandles();
}

showAllPathsToggle?.addEventListener("change", () => {
  pathsHiddenByFieldClick = false;
  showAllPaths = !!showAllPathsToggle?.checked;
  refreshPathLineAppearance();
});

const instrumentPaletteButtonHeld = new Map<string, boolean>();

// Left controller X toggles the instrument hand menu; right controller A
// summons the floating instrument panel.
function updateInstrumentPaletteFromControllers() {
  controllerRegistry.forEach((controller, handedness) => {
    if (controller.inputSource.hand) return;
    const xButton = controller.motionController?.getComponent('x-button');
    const aButton = controller.motionController?.getComponent('a-button');
    const isPressed = !!xButton?.pressed || !!aButton?.pressed ||
      !!controller.inputSource.gamepad?.buttons?.[4]?.pressed;
    const wasPressed = instrumentPaletteButtonHeld.get(handedness) ?? false;
    instrumentPaletteButtonHeld.set(handedness, isPressed);

    if (isPressed && !wasPressed) {
      if (xButton || (!aButton && controller.inputSource.handedness === "left")) {
        toggleControllerHandMenu("instruments", controller.inputSource.handedness);
      } else {
        summonInstrumentPanel();
      }
    }
  });
}

// In placement mode, each trigger press drops a new standing robot (no path,
// no walking) at the aimed point —
// for laying out a formation one member at a time.
let placementMode = !!placementModeToggle?.checked;
let eraseMode = false;
const placementDrafts = new Map<string, TransformNode>();

function setEraseMode(enabled: boolean) {
  if (enabled === eraseMode) return;
  if (enabled) {
    stopMarcherPainting();
    selectionTools?.disable();
    setPlacementMode(false);
    handInteraction.prepareForErase();
    selectRobot(null);
    movingSegment = null;
    reshapingSegment = null;
    rotatingSegment = null;
    rotationHandleDrags.clear();
    twoHandPathManipulation = null;
    reshapingStepHandle = null;
    scrubbingRobot = null;
  }
  eraseMode = enabled;
  if (eraseModeToggle) eraseModeToggle.checked = enabled;
  setEraseModeActive(enabled);
}

eraseModeToggle?.addEventListener("change", () => setEraseMode(!!eraseModeToggle?.checked));

onDrillChartPadVisibilityChange((visible) => {
  if (drillChartPadToggle) drillChartPadToggle.checked = visible;
  setDrillChartPadActive(visible);
});
drillChartPadToggle?.addEventListener("change", () => setDrillChartPadVisible(!!drillChartPadToggle?.checked));

// Inserts a blank chart page (keyframe) after the page shown. The new page
// starts with no drafted guides (the shown page keeps its own) and every
// marcher waits as a ghost to be placed.
function addBlankChartPage() {
  if (floorCalibrationToggle?.checked) return;
  const afterPage = getDrillChartPageIndex();
  if (!canSwapChartPageGuides() || !showChartPageGuides(afterPage)) {
    showPlacementNotice("Finish drawing before adding a chart page.");
    return;
  }
  selectRobot(null);
  const count = insertBlankDrillChartPage();
  if (count === null) {
    const cleared = clearDrawingGuides();
    showPlacementNotice(cleared ? "Drafted guides cleared. Add marchers to build chart pages." :
      "Add marchers before inserting a chart page.");
    return;
  }
  insertChartPageGuides(afterPage);
  const waiting = getBlankChartPageState()?.waiting ?? 0;
  showPlacementNotice(`Blank page at count ${count}: draw guides, then grab or place the ${waiting} ghost marchers.`);
}
insertChartPageButton?.addEventListener("click", addBlankChartPage);

// Saves the chart page draft in progress (every marcher's schedule, the open
// blank page with its waiting ghosts, the transition and the drafted guides)
// to this browser so it can be resumed after a reload.
function saveChartPageDraft() {
  if (marcherGrabs.size > 0) {
    showPlacementNotice("Release the grabbed marcher before saving the chart page draft.");
    return;
  }
  const schedules = captureMarcherSchedules();
  if (schedules.length === 0) {
    showPlacementNotice("Add marchers before saving a chart page draft.");
    return;
  }
  const page = captureBlankChartPage();
  const pageGuides = captureChartPageGuides();
  const indexByRobot = new Map(schedules.map((schedule, index) => [schedule.robot, index]));
  const transition = getChartTransition();
  const draft: ChartPageDraft = {
    version: 1,
    savedAt: new Date().toISOString(),
    beat: getDrillTransportState().beat,
    tempoBpm: getMarchTempo(),
    transition: { shape: transition.shape, pace: transition.pace, styleIndex: transition.styleIndex },
    page: page && {
      count: page.count, previous: page.previous, next: page.next,
      waiting: page.waiting.map(robot => indexByRobot.get(robot)).filter((index): index is number => index !== undefined),
    },
    marchers: schedules.map((schedule) => {
      const label = getDrillLabel(schedule.robot);
      return {
        instrument: schedule.instrument, gait: schedule.gaitIndex, rest: schedule.instrumentRestPose,
        color: roundVector(schedule.color.r, schedule.color.g, schedule.color.b), step: schedule.stepSizeYards,
        ...(schedule.fixedFacingY === undefined ? {} : { fixed: schedule.fixedFacingY }),
        ...(label ? { label } : {}),
        counts: schedule.counts.map((count) => ({
          p: roundVector(count.position.x, count.position.y, count.position.z), r: count.rotationY,
          ...(count.facingY === undefined ? {} : { f: count.facingY }),
          ...(count.styleIndex === undefined ? {} : { s: count.styleIndex }),
        })),
      };
    }),
    drafting: exportDrawingWorkspace(),
    draftingPage: pageGuides.shown,
    pageDrafting: pageGuides.pages,
  };
  try {
    localStorage.setItem(CHART_PAGE_DRAFT_KEY, serializeChartPageDraft(draft));
  } catch (error) {
    showPlacementNotice(`Could not save the chart page draft: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const waiting = draft.page?.waiting.length ?? 0;
  showPlacementNotice(draft.page
    ? `Saved page at count ${draft.page.count}: ${schedules.length - waiting} placed, ${waiting} waiting. Resume restores it.`
    : `Saved ${schedules.length} marchers at count ${Math.round(draft.beat)}. Resume restores them.`);
}

// Replaces the field with the saved chart page draft, reopening its blank
// page so the waiting marchers are ghosts again.
function resumeChartPageDraft() {
  let draft: ChartPageDraft;
  try {
    const json = localStorage.getItem(CHART_PAGE_DRAFT_KEY);
    if (!json) {
      showPlacementNotice("No saved chart page draft in this browser yet. Press Save first.");
      return;
    }
    draft = parseChartPageDraft(json);
    const badInstrument = draft.marchers.find((marcher) =>
      !(MARCHER_INSTRUMENTS as readonly string[]).includes(marcher.instrument) || marcher.gait >= MARCHING_GAITS.length ||
      marcher.counts.some((count) => count.s !== undefined && count.s >= MARCHING_GAITS.length));
    if (badInstrument) throw new Error(`Saved chart page draft has an unknown instrument or gait (${badInstrument.instrument}).`);
  } catch (error) {
    showPlacementNotice(error instanceof Error ? error.message : String(error));
    return;
  }
  clearAllRobots();
  const labels: { robot: TransformNode; label: string }[] = [];
  const robots = draft.marchers.map((marcher) => {
    const robot = createLowPolyRobot(scene, marcher.gait);
    robot.parent = pathRoot;
    const counts = marcher.counts.map((count) => ({
      position: new Vector3(count.p[0], count.p[1], count.p[2]), rotationY: count.r,
      ...(count.f === undefined ? {} : { facingY: count.f }),
      ...(count.s === undefined ? {} : { styleIndex: count.s }),
    }));
    restoreMarcherSchedule(robot, {
      instrument: marcher.instrument as MarcherInstrument, instrumentRestPose: marcher.rest,
      color: new Color3(...marcher.color), stepSizeYards: marcher.step, fixedFacingY: marcher.fixed, counts,
    }, scene);
    const path = counts.map((count) => count.position.clone());
    robotPaths.set(robot, path);
    updateRobotPathLine(robot, path);
    if (marcher.label) labels.push({ robot, label: marcher.label });
    return robot;
  });
  setMarchTempo(draft.tempoBpm);
  const shape = TRANSITION_PATH_SHAPES.find((entry) => entry.id === draft.transition.shape)?.id;
  const pace = TRANSITION_PACES.find((entry) => entry.id === draft.transition.pace)?.id;
  setChartTransition({
    ...(shape ? { shape } : {}), ...(pace ? { pace } : {}),
    ...(TRANSITION_STYLE_INDICES.includes(draft.transition.styleIndex) ? { styleIndex: draft.transition.styleIndex } : {}),
  });
  setDrillLabels(scene, pathRoot, labels);
  const last = Math.max(0, ...draft.marchers.map((marcher) => marcher.counts.length - 1));
  const pages = Array.from({ length: Math.floor(last / 8) + 1 }, (_, index) => index * 8);
  if (pages[pages.length - 1] !== last) pages.push(last);
  selectionTools?.setPages(pages.map((count, index) => ({ name: `Set ${index + 1}`, count })));
  clearDrawingGuides();
  const imported = draft.drafting ? importDrawingWorkspace(draft.drafting) : true;
  const otherPages = restoreChartPageGuides(draft.draftingPage ?? getDrillChartPageIndex(), draft.pageDrafting ?? []);
  const drafting = imported !== true ? imported : otherPages;
  if (draft.page) {
    resumeBlankChartPage({ ...draft.page, waiting: draft.page.waiting.map((index) => robots[index]) }, scene);
  } else {
    seekToCount(Math.min(last, Math.round(draft.beat)));
  }
  refreshCollisionMarkers(scene);
  redrawDrillChartPad();
  const saved = new Date(draft.savedAt).toLocaleString();
  const guides = drafting === true ? "" : ` Guides were not restored: ${drafting}`;
  showPlacementNotice(draft.page
    ? `Resumed page at count ${draft.page.count} saved ${saved}: ${draft.page.waiting.length} marchers waiting.${guides}`
    : `Resumed ${robots.length} marchers saved ${saved}.${guides}`);
}
saveChartDraftButton?.addEventListener("click", saveChartPageDraft);
resumeChartDraftButton?.addEventListener("click", resumeChartPageDraft);

// Applies the transition library choice to the move from the previous chart
// page into the one shown: the selected marcher, or every marcher.
function applyChartTransition() {
  const span = getDrillChartTransitionSpan();
  if (!span) {
    showPlacementNotice("Turn to a later chart page to set the transition into it.");
    return;
  }
  const robots = selectedRobot ? [selectedRobot] : getRoutedRobots();
  const before = robots.map(robot => ({ robot, movement: captureMarcherMovement(robot) }));
  const result = setRobotTransition(robots, span.from, span.to, getChartTransition(), scene);
  if (result.marchers === 0) {
    showPlacementNotice("No routed marchers reach this chart page yet.");
    return;
  }
  const after = robots.map(robot => ({ robot, movement: captureMarcherMovement(robot) }));
  const restore = (snapshots: typeof before) => snapshots.forEach(({ robot, movement }) => {
    if (!robot.isDisposed()) restoreMarcherMovement(robot, movement);
  });
  eraseHistory.record({ undo: () => restore(before), redo: () => restore(after) });
  redrawDrillChartPad();
  const labels = getChartTransitionLabels();
  const tooLong = result.maxStepYards > MAX_MARCHING_STRIDE_YARDS * 2;
  showPlacementNotice(`Set ${span.page} → ${span.page + 1}: ${labels.shape} · ${labels.style} · ${labels.pace} ` +
    `for ${result.marchers} marcher${result.marchers === 1 ? "" : "s"}` +
    (tooLong ? ". Some steps are too long to march; try Even pace or a straighter path." : "."));
}

// In placement mode a blank page's waiting ghosts are placed before new marchers are created.
function placeWaitingChartMarcher(point: Vector3) {
  const placed = placeNearestBlankPageMarcher(point, scene);
  if (placed === null) return false;
  if (!placed) showPlacementNotice("That spot is blocked; the ghost marcher is still waiting.");
  return true;
}

// Picks the instrument for new marchers and swaps the selected marcher's.
function chooseInstrument(instrument: MarcherInstrument) {
  setSelectedInstrument(instrument);
  if (selectedRobot) setMarcherInstrument(selectedRobot, instrument);
  marcherInstrumentRadios.forEach((radio) => (radio.checked = radio.value === instrument));
  setInstrumentMenuActive(instrument);
}

marcherInstrumentRadios.forEach((radio) => radio.addEventListener("change", () => {
  if (radio.checked) chooseInstrument(radio.value as MarcherInstrument);
}));

function createStandingMarcher(position: Vector3) {
  position = snapToStepGrid(position);
  const robot = createLowPolyRobot(scene);
  robot.parent = pathRoot;
  robot.setEnabled(tryManualMarcherPose(robot, position, robot.rotation.y, false));
  if (!robot.isEnabled()) robot.position.copyFrom(position);
  return robot;
}

let placementNotice: HTMLOutputElement | null = null;
let placementNoticeTimeout: ReturnType<typeof setTimeout> | undefined;
function showPlacementNotice(message: string) {
  if (!placementNotice) {
    placementNotice = document.createElement("output");
    placementNotice.className = "placement-collision-notice";
    placementNotice.setAttribute("role", "status");
    document.body.appendChild(placementNotice);
  }
  placementNotice.textContent = message;
  placementNotice.hidden = false;
  clearTimeout(placementNoticeTimeout);
  placementNoticeTimeout = setTimeout(() => { if (placementNotice) placementNotice.hidden = true; }, 2000);
}
const placementBlockedObserver = onManualPlacementBlocked.add(() =>
  showPlacementNotice("Move blocked: leave room for the marcher's body and instrument."));
const strideLimitedObserver = onMarcherStrideLimited.add(showPlacementNotice);
scene.onDisposeObservable.addOnce(() => {
  onManualPlacementBlocked.remove(placementBlockedObserver);
  onMarcherStrideLimited.remove(strideLimitedObserver);
  clearTimeout(placementNoticeTimeout);
  placementNotice?.remove();
});

placementModeToggle?.addEventListener("change", () => {
  setPlacementMode(!!placementModeToggle?.checked);
});

function setPlacementMode(enabled: boolean) {
  if (enabled) {
    stopMarcherPainting();
    selectionTools?.disable();
    setEraseMode(false);
  }
  if (enabled === placementMode) return;
  placementDrafts.forEach((robot, handedness) => {
    robot.dispose();
    menuInteractionHeld.set(handedness, true);
  });
  placementDrafts.clear();
  if (handInteraction.isFingerPathPlacement()) finishFingerPath(false);
  placementMode = enabled;
  if (placementModeToggle) placementModeToggle.checked = placementMode;
}

const draftingToolsButtonHeld = new Map<string, boolean>();

// Right after placing a marcher on a blank chart page, a thumbstick click or
// an open palm-down sweep of a free tracked hand sends its previous-page
// neighbors to evenly spaced spots beside it along the selected guide.
function directAdjacentChartMarchers() {
  const guide = getSelectedDrawingGuidePoints();
  if (!guide) {
    showPlacementNotice("Select a drafted guide first; adjacent marchers line up along it.");
    return;
  }
  const result = directAdjacentBlankPageMarchers(guide, scene);
  if (!result) {
    showPlacementNotice("Place a ghost marcher on the blank page first, then sweep or click the thumbstick.");
  } else if (result.placed + result.blocked === 0) {
    showPlacementNotice("No waiting marchers stood next to that marcher on the previous page.");
  } else {
    showPlacementNotice(`Directed ${result.placed} adjacent marcher${result.placed === 1 ? "" : "s"} along the guide` +
      (result.blocked ? `; ${result.blocked} blocked and still waiting.` : "."));
  }
}

const adjacentThumbstickHeld = new Map<string, boolean>();
const palmSweepStates = new Map<string, PalmSweepState>();

function updateAdjacentMarcherGestures() {
  controllerRegistry.forEach((controller, handedness) => {
    if (controller.inputSource.hand) return;
    const pressed = !!controller.motionController?.getComponentOfType("thumbstick")?.pressed ||
      !!controller.inputSource.gamepad?.buttons?.[3]?.pressed;
    const wasPressed = adjacentThumbstickHeld.get(handedness) ?? false;
    adjacentThumbstickHeld.set(handedness, pressed);
    if (pressed && !wasPressed && !marcherGrabs.has(handedness) && getBlankChartPageState()) {
      directAdjacentChartMarchers();
    }
  });
  const time = performance.now() / 1000;
  for (const handedness of ["left", "right"] as const) {
    const hand = mediaHandTracking?.getHandByHandedness(handedness);
    const state = palmSweepStates.get(handedness) ?? createPalmSweepState();
    palmSweepStates.set(handedness, state);
    if (!hand || marcherGrabs.has(handedness) || !hasRecentBlankPagePlacement()) {
      updatePalmSweep(state, time, false, 0, 0, 0);
      continue;
    }
    const joint = (name: WebXRHandJoint) => hand.getJointMesh(name).getAbsolutePosition();
    const wrist = joint(WebXRHandJoint.WRIST);
    const middleBase = joint(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL);
    const pose = getTrackedHandMenuPose(wrist, joint(WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL), middleBase,
      joint(WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL), handedness, scene.useRightHandedSystem);
    const palmLength = Vector3.Distance(wrist, middleBase);
    const open = palmLength > 1e-4 && [WebXRHandJoint.INDEX_FINGER_TIP, WebXRHandJoint.MIDDLE_FINGER_TIP,
      WebXRHandJoint.RING_FINGER_TIP, WebXRHandJoint.PINKY_FINGER_TIP]
      .every(tip => Vector3.Distance(wrist, joint(tip)) > palmLength * PALM_SWEEP_OPEN_RATIO);
    const palmDownOpen = !!pose && pose.normal.y < -PALM_SWEEP_DOWN_DOT && open;
    if (updatePalmSweep(state, time, palmDownOpen, middleBase.x, middleBase.y, middleBase.z)) {
      directAdjacentChartMarchers();
    }
  }
}
const PALM_SWEEP_DOWN_DOT = 0.6;
// Fingertips this many palm lengths from the wrist count as extended.
const PALM_SWEEP_OPEN_RATIO = 1.6;

// Left controller Y toggles the media watch; right controller B opens the drafting tools.
function updateDraftingToolsFromControllers() {
  controllerRegistry.forEach((controller, handedness) => {
    if (controller.inputSource.hand) return;
    const yButton = controller.motionController?.getComponent('y-button');
    const bButton = controller.motionController?.getComponent('b-button');
    const isPressed = !!yButton?.pressed || !!bButton?.pressed ||
      !!controller.inputSource.gamepad?.buttons?.[5]?.pressed;
    const wasPressed = draftingToolsButtonHeld.get(handedness) ?? false;
    draftingToolsButtonHeld.set(handedness, isPressed);

    if (isPressed && !wasPressed) {
      if (yButton || (!bButton && controller.inputSource.handedness === "left")) {
        toggleControllerHandMenu("media", controller.inputSource.handedness);
      } else {
        executeDrawingToolAction({ action: 'drawingTool', tool: 'drafting' });
      }
    }
  });
}

// Deflecting the media controller's thumbstick left/right scrubs the shared
// timeline continuously — a small deadzone avoids drift from stick noise,
// and the scrub rate is proportional to how far the stick is pushed.
const SCRUB_DEADZONE = 0.2;
const GRAB_DEPTH_BASE_SPEED = 6;
const GRAB_DEPTH_TELESCOPE_RATE = 2.5;
const PANEL_GRAB_DEPTH_SPEED = 1.5;

function getThumbstickAxes(controller: WebXRInputSource) {
  const stick = controller.motionController?.getComponentOfType("thumbstick");
  const axes = controller.inputSource.gamepad?.axes;
  return {
    x: stick?.axes.x ?? (axes && axes.length >= 4 ? axes[2] : axes?.[0]) ?? 0,
    y: stick?.axes.y ?? (axes && axes.length >= 4 ? axes[3] : axes?.[1]) ?? 0,
  };
}
const SCRUB_COUNTS_PER_SECOND = 16;
let scrubRemainder = 0;
let mediaHandTracking: WebXRHandTracking | null = null;
const thumbJogState: ThumbJogState = { neutral: null, settlingSeconds: 0 };
for (const toggle of [swapControllerRolesToggle, handThumbJogToggle]) {
  toggle?.addEventListener("change", () => {
    scrubRemainder = 0;
    resetThumbJog(thumbJogState);
  });
}

function getHandThumbJogAxis(deltaSeconds: number): number {
  const hand = handThumbJogToggle?.checked
    ? mediaHandTracking?.getHandByHandedness(getMediaControllerHand())
    : null;
  if (!hand) {
    resetThumbJog(thumbJogState);
    return 0;
  }
  const joint = (name: WebXRHandJoint) => hand.getJointMesh(name).getAbsolutePosition();
  const wrist = joint(WebXRHandJoint.WRIST);
  const middle = joint(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL);
  const indexBase = joint(WebXRHandJoint.INDEX_FINGER_METACARPAL);
  const pinkyBase = joint(WebXRHandJoint.PINKY_FINGER_METACARPAL);
  const length = Vector3.Distance(wrist, middle);
  if (length < 0.025) {
    resetThumbJog(thumbJogState);
    return 0;
  }
  const thumb = joint(WebXRHandJoint.THUMB_TIP);
  const thumbBase = joint(WebXRHandJoint.THUMB_METACARPAL);
  const curled = [
    WebXRHandJoint.INDEX_FINGER_TIP, WebXRHandJoint.MIDDLE_FINGER_TIP,
    WebXRHandJoint.RING_FINGER_TIP, WebXRHandJoint.PINKY_FINGER_TIP,
  ].every((tip) => Vector3.Distance(joint(tip), wrist) < length * 1.4);
  const thumbDirection = thumb.subtract(thumbBase);
  const raised = thumbDirection.length() > length * 0.65 &&
    Vector3.Dot(thumbDirection, middle.subtract(wrist).normalize()) > length * 0.3;
  const notPinching = Vector3.Distance(thumb, joint(WebXRHandJoint.INDEX_FINGER_TIP)) > length * 0.65;
  const across = indexBase.subtract(pinkyBase).normalize();
  if (getMediaControllerHand() === "left") across.scaleInPlace(-1);
  const position = Vector3.Dot(thumb.subtract(wrist), across) / length;
  return updateThumbJog(thumbJogState, curled && raised && notPinching, position, deltaSeconds);
}

function updateScrubFromControllers(deltaSeconds: number) {
  if (!isHandMenuVisible() || floorCalibrationToggle?.checked) {
    scrubRemainder = 0;
    resetThumbJog(thumbJogState);
    return;
  }

  let axisValue = 0;
  let hasMediaThumbstick = false;
  const mediaHand = getMediaControllerHand();
  controllerRegistry.forEach((controller) => {
    if (controller.inputSource.handedness !== mediaHand) return;
    const thumbstick = controller.motionController?.getComponentOfType("thumbstick");
    if (!thumbstick) return;
    hasMediaThumbstick = true;
    if (marcherGrabs.get(mediaHand)?.source === "controller") return;
    const x = thumbstick.axes.x ?? 0;
    if (Math.abs(x) > Math.abs(axisValue)) axisValue = x;
  });
  if (hasMediaThumbstick || marcherGrabs.get(mediaHand)?.source === "controller") {
    resetThumbJog(thumbJogState);
  } else {
    axisValue = getHandThumbJogAxis(deltaSeconds);
  }

  if (Math.abs(axisValue) <= SCRUB_DEADZONE) {
    scrubRemainder = 0;
    return;
  }

  const activeDeflection = (Math.abs(axisValue) - SCRUB_DEADZONE) / (1 - SCRUB_DEADZONE);
  const scrubDirection = Math.sign(axisValue);
  scrubRemainder += scrubDirection * activeDeflection * SCRUB_COUNTS_PER_SECOND * deltaSeconds;
  const wholeCounts = Math.trunc(scrubRemainder);
  if (wholeCounts !== 0) {
    jogGhostBandBy(wholeCounts);
    scrubRemainder -= wholeCounts;
  }
}

function updateRobotPathLine(robot: TransformNode, points: Vector3[]) {
  const oldLine = robotPathLines.get(robot);
  if (oldLine) pathLineOwner.delete(oldLine);
  oldLine?.dispose(false, true);
  robotPathLines.delete(robot);
  if (points.length < 2) return;

  const line = createTubeLine("robotPathLine", points, getRobotColor(robot));
  robotPathLines.set(robot, line);
  pathLineOwner.set(line, robot);
  refreshPathLineAppearance();
}

// The 8 standard facing directions (45° increments), so drawn angles snap to drill grid.
const ANGLE_SNAP_RADIANS = Math.PI / 4;
let bypassDrillSnap = false;

gridSnapInterval?.addEventListener("change", () => {
  const interval = gridSnapInterval?.value;
  if (!interval || interval === "custom") return;
  if (gridSnapX) gridSnapX.value = interval;
  if (gridSnapZ) gridSnapZ.value = interval;
});
for (const input of [gridSnapX, gridSnapZ]) {
  input?.addEventListener("input", () => {
    if (gridSnapInterval) gridSnapInterval.value = "custom";
  });
}

function snapToStepGrid(point: Vector3): Vector3 {
  if (!gridSnapToggle?.checked || bypassDrillSnap) return point;
  const x = Number(gridSnapX?.value ?? MARCH_STEP_YARDS);
  const z = Number(gridSnapZ?.value ?? MARCH_STEP_YARDS);
  if (![x, z].every(value => Number.isFinite(value) && value >= 0.001 && value <= 10)) {
    publishFormationEdit("Grid rounding must be between 0.001 and 10 yards on each axis. Snapping was not applied.");
    return point;
  }
  const snapped = snapDrillPoint(point, x, z);
  return new Vector3(snapped.x, snapped.y, snapped.z);
}

function snapAngle(angle: number): number {
  return angleSnapToggle?.checked && !bypassDrillSnap
    ? Math.round(angle / ANGLE_SNAP_RADIANS) * ANGLE_SNAP_RADIANS : angle;
}

function constrainFormationMovement(delta: Vector3): Vector3 {
  const result = constrainDrillMovement(delta, !!formationLockX?.checked, !!formationLockZ?.checked);
  return new Vector3(result.x, result.y, result.z);
}

function resampleLineEvenly(points: Vector3[], spacingYards: number, closed = false): Vector3[] {
  const segmentLengths = points.slice(1).map((point, i) => Vector3.Distance(points[i], point));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= 0.001) return [points[0].clone()];

  const count = Math.max(closed ? 3 : 1, Math.round(totalLength / spacingYards));
  const resampled: Vector3[] = [];
  for (let i = 0; i < count + (closed ? 0 : 1); i++) {
    const distance = Math.min(totalLength, (i / count) * totalLength);
    let remaining = distance;
    let segmentIndex = 0;
    while (segmentIndex < segmentLengths.length - 1 && remaining > segmentLengths[segmentIndex]) {
      remaining -= segmentLengths[segmentIndex];
      segmentIndex++;
    }
    const segmentStart = points[segmentIndex];
    const segmentEnd = points[segmentIndex + 1];
    const segmentLength = segmentLengths[segmentIndex] || 0.001;
    const t = Math.min(1, remaining / segmentLength);
    resampled.push(Vector3.Lerp(segmentStart, segmentEnd, t));
  }
  return resampled;
}

function isClosedFormation(controlPoints: Vector3[]) {
  return controlPoints.length >= 4 &&
    Vector3.DistanceSquared(controlPoints[0], controlPoints[controlPoints.length - 1]) < 1e-6;
}

function isVerticalFormation(controlPoints: Vector3[]) {
  if (controlPoints.length < 2) return false;
  const heights = controlPoints.map((point) => point.y);
  return Math.max(...heights) - Math.min(...heights) > 0.1;
}

interface FormationCircle {
  center: Vector3;
  radius: number;
  startAngle: number;
  direction: number;
}

function fitFormationCircle(controlPoints: Vector3[]): FormationCircle {
  const start = controlPoints[0];
  let xx = 0, xz = 0, zz = 0, xr = 0, zr = 0, area = 0;
  let farthest = Vector3.Zero();
  controlPoints.slice(0, -1).forEach((point, index) => {
    const x = point.x - start.x;
    const z = point.z - start.z;
    const squaredRadius = x * x + z * z;
    xx += x * x;
    xz += x * z;
    zz += z * z;
    xr += x * squaredRadius / 2;
    zr += z * squaredRadius / 2;
    if (squaredRadius > farthest.lengthSquared()) farthest.set(x, 0, z);
    const next = controlPoints[index + 1];
    area += x * (next.z - start.z) - z * (next.x - start.x);
  });
  // Least-squares fit constrained to pass through the held marcher.
  const determinant = xx * zz - xz * xz;
  const offset = determinant > xx * zz * 1e-8
    ? new Vector3((xr * zz - zr * xz) / determinant, 0, (zr * xx - xr * xz) / determinant)
    : farthest.scale(0.5);
  return {
    center: start.add(offset),
    radius: offset.length(),
    startAngle: Math.atan2(-offset.z, -offset.x),
    direction: area < 0 ? -1 : 1,
  };
}

function sampleFormationCircle(circle: FormationCircle, count: number, closed: boolean): Vector3[] {
  const points: Vector3[] = [];
  for (let index = 0; index < count; index++) {
    const angle = circle.startAngle + circle.direction * index * Math.PI * 2 / count;
    points.push(new Vector3(
      circle.center.x + circle.radius * Math.cos(angle),
      circle.center.y,
      circle.center.z + circle.radius * Math.sin(angle)
    ));
  }
  if (closed) points.push(points[0].clone());
  return points;
}

interface VerticalFormationCircle {
  center: Vector3;
  horizontalAxis: Vector3;
  radius: number;
  startAngle: number;
  direction: number;
}

function fitVerticalFormationCircle(controlPoints: Vector3[]): VerticalFormationCircle {
  const start = controlPoints[0];
  const offsets = controlPoints.slice(0, -1).map((point) => point.subtract(start));
  const farthestHorizontal = offsets.reduce(
    (farthest, offset) => Math.hypot(offset.x, offset.z) > Math.hypot(farthest.x, farthest.z)
      ? offset
      : farthest,
    Vector3.Zero()
  );
  const horizontalAxis = Math.hypot(farthestHorizontal.x, farthestHorizontal.z) > 1e-6
    ? new Vector3(farthestHorizontal.x, 0, farthestHorizontal.z).normalize()
    : new Vector3(1, 0, 0);

  let uu = 0, uv = 0, vv = 0, ur = 0, vr = 0, area = 0;
  let farthestU = 0;
  let farthestV = 0;
  offsets.forEach((offset, index) => {
    const u = offset.x * horizontalAxis.x + offset.z * horizontalAxis.z;
    const v = offset.y;
    const squaredRadius = u * u + v * v;
    uu += u * u;
    uv += u * v;
    vv += v * v;
    ur += u * squaredRadius / 2;
    vr += v * squaredRadius / 2;
    if (squaredRadius > farthestU * farthestU + farthestV * farthestV) {
      farthestU = u;
      farthestV = v;
    }
    const next = offsets[index + 1];
    if (next) {
      const nextU = next.x * horizontalAxis.x + next.z * horizontalAxis.z;
      area += u * next.y - v * nextU;
    }
  });

  const determinant = uu * vv - uv * uv;
  const centerU = determinant > uu * vv * 1e-8
    ? (ur * vv - vr * uv) / determinant
    : farthestU / 2;
  const centerV = determinant > uu * vv * 1e-8
    ? (vr * uu - ur * uv) / determinant
    : farthestV / 2;
  const center = start.add(horizontalAxis.scale(centerU)).add(new Vector3(0, centerV, 0));
  return {
    center,
    horizontalAxis,
    radius: Math.hypot(centerU, centerV),
    startAngle: Math.atan2(-centerV, -centerU),
    direction: area < 0 ? -1 : 1,
  };
}

function sampleVerticalFormationCircle(
  circle: VerticalFormationCircle,
  count: number,
  closed: boolean
): Vector3[] {
  const points: Vector3[] = [];
  for (let index = 0; index < count; index++) {
    const angle = circle.startAngle + circle.direction * index * Math.PI * 2 / count;
    points.push(circle.center
      .add(circle.horizontalAxis.scale(circle.radius * Math.cos(angle)))
      .add(new Vector3(0, circle.radius * Math.sin(angle), 0)));
  }
  if (closed) points.push(points[0].clone());
  return points;
}

function getFormationPoints(controlPoints: Vector3[], fitClosedCircle = true,
  spacing = Number(formationSpacingInput?.value ?? FORMATION_SPACING_YARDS), linear = false) {
  if (!Number.isFinite(spacing) || spacing < 0.625 || spacing > 10) {
    publishFormationEdit("Spacing must be between 0.625 and 10 yards.");
    return [];
  }
  const closed = isClosedFormation(controlPoints);
  if (closed && fitClosedCircle) {
    if (isVerticalFormation(controlPoints)) {
      const circle = fitVerticalFormationCircle(controlPoints);
      const count = Math.max(3, Math.round(Math.PI * 2 * circle.radius / spacing));
      return sampleVerticalFormationCircle(circle, count, false);
    }
    const circle = fitFormationCircle(controlPoints);
    const count = Math.max(3, Math.round(Math.PI * 2 * circle.radius / spacing));
    return sampleFormationCircle(circle, count, false);
  }
  if (closed) return resampleLineEvenly(controlPoints, spacing, true);
  const curvePoints = linear ? controlPoints : buildCurvePoints(controlPoints);
  return curvePoints.length >= 2
    ? resampleLineEvenly(curvePoints, spacing, closed)
    : curvePoints;
}

// Two independently-maintained kinds of drawn/dragged curve:
// - "formation": a line of standing robots spaced along it.
// - "path": the curve a single robot follows when marching.
// Both are recorded as a Segment with the same move/reshape handles; only how
// their content is (re)built from the curve differs (see rebuildSegmentContent).
type SegmentKind = "formation" | "path";

interface Segment {
  kind: SegmentKind;
  controlPoints: Vector3[];
  line: Mesh;
  moveHandle: Mesh;
  pointHandles: Mesh[];
  rotationHandles: Mesh[];
  // Formation-only: tap to copy this formation's curve into a path segment
  // so a robot marches single file through the same positions.
  copyHandle: Mesh | null;
  anchorRobot?: TransformNode;
  fitClosedCircle: boolean;
  linear?: boolean;
  spacing?: number;
  erasedFormationIndices?: Set<number>;
  robots: TransformNode[]; // formation: every robot in the rank; path: the one marching robot
}

const segments: Segment[] = [];
const eraseHistoryReferences = new Map<Segment, number>();
const segmentPointHandleOwner = new Map<AbstractMesh, { segment: Segment; index: number }>();
const segmentMoveHandleOwner = new Map<AbstractMesh, Segment>();
const segmentRotationHandleOwner = new Map<AbstractMesh, Segment>();
const segmentCopyHandleOwner = new Map<AbstractMesh, Segment>();
// Looks up the path segment (if any) already recorded for a given robot, so
// extending its route reshapes/grows the same segment instead of a new one.
const pathSegmentByRobot = new Map<TransformNode, Segment>();

// A connector between two robots that are actual, authored neighbors in a
// formation's rank order — NOT just whichever robots happen to be nearby.
// Proximity is only ever used to break an existing formation connection
// (e.g. once a robot marches away via copy-to-path), never to create one.
const FORMATION_CONNECTION_BREAK_DISTANCE_YARDS = FORMATION_SPACING_YARDS * 2.5;
const FORMATION_CONNECTION_RADIUS_YARDS = 0.02;
const FORMATION_CONNECTION_UPDATE_INTERVAL_FRAMES = 6;

interface FormationConnection {
  mesh: Mesh;
  robotA: TransformNode;
  robotB: TransformNode;
}
const formationConnectionsBySegment = new Map<Segment, FormationConnection[]>();
let formationConnectionMaterial: StandardMaterial | null = null;
let formationConnectionFrameCounter = 0;

function getFormationConnectionMaterial(): StandardMaterial {
  if (!formationConnectionMaterial) {
    formationConnectionMaterial = new StandardMaterial("formationConnectionMaterial", scene);
    formationConnectionMaterial.diffuseColor = new Color3(0.85, 0.9, 0.95);
    formationConnectionMaterial.emissiveColor = new Color3(0.55, 0.6, 0.65);
    formationConnectionMaterial.specularColor = new Color3(0, 0, 0);
    formationConnectionMaterial.disableLighting = true;
    formationConnectionMaterial.alpha = 0.5;
  }
  return formationConnectionMaterial;
}

// (Re)creates the connections for a formation's current rank order — one per
// adjacent pair of robots, e.g. after the formation is built or reshaped.
function rebuildFormationConnections(segment: Segment) {
  formationConnectionsBySegment.get(segment)?.forEach((connection) => connection.mesh.dispose());
  if (segment.kind !== "formation" || segment.robots.length < 2) {
    formationConnectionsBySegment.delete(segment);
    return;
  }

  const connections: FormationConnection[] = [];
  const connectionCount = segment.robots.length - (isClosedFormation(segment.controlPoints) ? 0 : 1);
  for (let i = 0; i < connectionCount; i++) {
    const robotA = segment.robots[i];
    const robotB = segment.robots[(i + 1) % segment.robots.length];
    const mesh = MeshBuilder.CreateTube(
      "formationConnection",
      { path: [robotA.position, robotB.position], radius: FORMATION_CONNECTION_RADIUS_YARDS, tessellation: 6, updatable: true },
      scene
    );
    mesh.material = getFormationConnectionMaterial();
    mesh.isPickable = false;
    mesh.parent = pathRoot;
    connections.push({ mesh, robotA, robotB });
  }
  formationConnectionsBySegment.set(segment, connections);
}

// Slides each formation connection to follow its two robots, breaking it
// (disposing the mesh) once they've drifted apart too far — e.g. one of them
// marching away from the standing rank via copy-to-path.
function updateFormationConnections() {
  formationConnectionsBySegment.forEach((connections, segment) => {
    const stillConnected = connections.filter((connection) => {
      const distanceSq = Vector3.DistanceSquared(connection.robotA.position, connection.robotB.position);
      const breakDistance = Math.max(FORMATION_CONNECTION_BREAK_DISTANCE_YARDS,
        (segment.spacing ?? FORMATION_SPACING_YARDS) * 2.5);
      if (distanceSq > breakDistance * breakDistance) {
        connection.mesh.dispose();
        return false;
      }
      MeshBuilder.CreateTube("formationConnection", {
        path: [connection.robotA.position, connection.robotB.position],
        instance: connection.mesh,
      });
      return true;
    });
    formationConnectionsBySegment.set(segment, stillConnected);
  });
}

const SEGMENT_COLORS: Record<SegmentKind, Color3> = {
  formation: new Color3(0.4, 0.9, 1),
  path: new Color3(1, 0.85, 0.2),
};
const SEGMENT_POINT_HANDLE_SIZE = 0.3;
const SEGMENT_MOVE_HANDLE_SIZE = 0.45;
const SEGMENT_ROTATION_HANDLE_COLOR = new Color3(0.95, 0.3, 0.65);
const CURVE_SAMPLES_PER_SPAN = 8;

// Smooths raw drawn/dragged control points into a curved line (Catmull-Rom
// spline) instead of a raw straight-segment polyline between them.
function buildCurvePoints(controlPoints: Vector3[], closed = false, fitClosedCircle = true): Vector3[] {
  if (controlPoints.length < 3) return controlPoints;
  if (closed) {
    if (!fitClosedCircle) return controlPoints;
    if (isVerticalFormation(controlPoints)) {
      const circle = fitVerticalFormationCircle(controlPoints);
      const count = Math.max(64, Math.ceil(Math.PI * 2 * circle.radius / FORMATION_SPACING_YARDS) * CURVE_SAMPLES_PER_SPAN);
      return sampleVerticalFormationCircle(circle, count, true);
    }
    const circle = fitFormationCircle(controlPoints);
    const count = Math.max(64, Math.ceil(Math.PI * 2 * circle.radius / FORMATION_SPACING_YARDS) * CURVE_SAMPLES_PER_SPAN);
    return sampleFormationCircle(circle, count, true);
  }
  return Curve3.CreateCatmullRomSpline(controlPoints, CURVE_SAMPLES_PER_SPAN, false).getPoints();
}

function createSegmentHandle(name: string, _size: number, color: Color3): Mesh {
  const handle = new Mesh(name, scene);
  handle.isVisible = false;
  handle.isPickable = false;
  const materialName = `${name}Material-${color.toHexString()}`;
  let material = scene.getMaterialByName(materialName) as StandardMaterial | null;
  if (!material) {
    material = new StandardMaterial(materialName, scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.5);
    material.specularColor = new Color3(0, 0, 0);
  }
  handle.material = material;
  handle.parent = pathRoot;
  return handle;
}

function syncSegmentPointHandles(segment: Segment) {
  while (segment.pointHandles.length > segment.controlPoints.length) {
    const handle = segment.pointHandles.pop()!;
    segmentPointHandleOwner.delete(handle);
    handle.dispose();
  }
  while (segment.pointHandles.length < segment.controlPoints.length) {
    const index = segment.pointHandles.length;
    const handle = createSegmentHandle("segmentPointHandle", SEGMENT_POINT_HANDLE_SIZE, SEGMENT_COLORS[segment.kind]);
    segment.pointHandles.push(handle);
    segmentPointHandleOwner.set(handle, { segment, index });
  }
}

function updateSegmentHandleVisibility(segment: Segment) {
  const visible = false;
  segment.moveHandle.setEnabled(visible);
  segment.pointHandles.forEach((handle) => handle.setEnabled(visible));
  segment.rotationHandles.forEach((handle) => handle.setEnabled(visible));
  segment.copyHandle?.setEnabled(visible);
}

function getSegmentCenter(points: Vector3[]): Vector3 {
  const center = Vector3.Zero();
  points.forEach((point) => center.addInPlace(point));
  return center.scaleInPlace(1 / points.length);
}

function rotatePointAroundSegmentCenter(
  point: Vector3,
  center: Vector3,
  rotation: number
): Vector3 {
  return rotateAroundY(point.subtract(center), rotation).addInPlace(center);
}

function startRotationHandleDrag(
  handedness: string,
  segment: Segment,
  handleIndex: number,
  point: Vector3
): boolean {
  if (rotationHandleDrags.size > 0) {
    const existing = rotationHandleDrags.values().next().value as RotationHandleDrag | undefined;
    if (!existing || existing.segment !== segment || existing.handleIndex === handleIndex) return false;
  }

  const drag = { segment, handleIndex, point: point.clone() };
  rotationHandleDrags.set(handedness, drag);
  if (rotationHandleDrags.size === 2) {
    const [first, second] = [...rotationHandleDrags.values()];
    const center = getSegmentCenter(segment.controlPoints);
    const startMidpoint = first.point.add(second.point).scale(0.5);
    const dx = second.point.x - first.point.x;
    const dz = second.point.z - first.point.z;
    twoHandPathManipulation = {
      segment,
      center,
      startMidpoint,
      startDistance: Math.max(0.001, Math.hypot(dx, dz)),
      startAngle: Math.atan2(dx, dz),
      originalControlPoints: segment.controlPoints.map((controlPoint) => controlPoint.clone()),
    };
    rotatingSegment = null;
  } else {
    const center = getSegmentCenter(segment.controlPoints);
    rotatingSegment = {
      segment,
      center,
      startAngle: Math.atan2(point.x - center.x, point.z - center.z),
      originalControlPoints: segment.controlPoints.map((controlPoint) => controlPoint.clone()),
    };
    twoHandPathManipulation = null;
  }
  return true;
}

function updateRotationHandleDrag(handedness: string, point: Vector3) {
  const drag = rotationHandleDrags.get(handedness);
  if (!drag) return;
  drag.point.copyFrom(point);

  if (twoHandPathManipulation && rotationHandleDrags.size === 2) {
    const [first, second] = [...rotationHandleDrags.values()];
    if (first.segment !== twoHandPathManipulation.segment || second.segment !== twoHandPathManipulation.segment) return;
    const midpoint = first.point.add(second.point).scale(0.5);
    const dx = second.point.x - first.point.x;
    const dz = second.point.z - first.point.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return;
    const angle = Math.atan2(dx, dz);
    const rotation = snapAngle(Math.atan2(
      Math.sin(angle - twoHandPathManipulation.startAngle),
      Math.cos(angle - twoHandPathManipulation.startAngle)
    ));
    const scale = distance / twoHandPathManipulation.startDistance;
    const translation = new Vector3(
      midpoint.x - twoHandPathManipulation.startMidpoint.x,
      0,
      midpoint.z - twoHandPathManipulation.startMidpoint.z
    );
    twoHandPathManipulation.segment.controlPoints = twoHandPathManipulation.originalControlPoints.map((controlPoint) =>
      rotatePointAroundSegmentCenter(controlPoint, twoHandPathManipulation!.center, rotation)
        .subtractInPlace(twoHandPathManipulation!.center)
        .scaleInPlace(scale)
        .addInPlace(twoHandPathManipulation!.center)
        .addInPlace(translation)
    );
    rebuildSegmentContent(twoHandPathManipulation.segment);
    refreshSegmentVisuals(twoHandPathManipulation.segment);
    return;
  }

  if (!rotatingSegment) return;
  const angle = Math.atan2(point.x - rotatingSegment.center.x, point.z - rotatingSegment.center.z);
  const rotation = snapAngle(Math.atan2(
    Math.sin(angle - rotatingSegment.startAngle),
    Math.cos(angle - rotatingSegment.startAngle)
  ));
  rotatingSegment.segment.controlPoints = rotatingSegment.originalControlPoints.map((controlPoint) =>
    rotatePointAroundSegmentCenter(controlPoint, rotatingSegment!.center, rotation)
  );
  rebuildSegmentContent(rotatingSegment.segment);
  refreshSegmentVisuals(rotatingSegment.segment);
}

function stopRotationHandleDrag(handedness: string) {
  rotationHandleDrags.delete(handedness);
  twoHandPathManipulation = null;
  if (rotationHandleDrags.size === 1) {
    const remaining = rotationHandleDrags.values().next().value as RotationHandleDrag;
    const center = getSegmentCenter(remaining.segment.controlPoints);
    rotatingSegment = {
      segment: remaining.segment,
      center,
      startAngle: Math.atan2(remaining.point.x - center.x, remaining.point.z - center.z),
      originalControlPoints: remaining.segment.controlPoints.map((controlPoint) => controlPoint.clone()),
    };
  } else {
    rotatingSegment = null;
  }
}

// Redraws a segment's curve line and repositions its move/point handles to
// match its current control points (call after moving or reshaping it).
function refreshSegmentVisuals(segment: Segment) {
  const curvePoints = segment.linear ? segment.controlPoints : buildCurvePoints(
    segment.controlPoints,
    segment.kind === "formation" && isClosedFormation(segment.controlPoints),
    segment.fitClosedCircle
  );
  pathLineOwner.delete(segment.line);
  segment.line.dispose(false, true);
  segment.line = createTubeLine("segmentLine", curvePoints, SEGMENT_COLORS[segment.kind]);

  if (segment.kind === "path") {
    // Keep the existing per-robot path-line/selection-brightness system in sync.
    const robot = segment.robots[0];
    if (robot) {
      robotPathLines.set(robot, segment.line);
      pathLineOwner.set(segment.line, robot);
      refreshPathLineAppearance();
    }
  }

  syncSegmentPointHandles(segment);
  segment.pointHandles.forEach((handle, i) => handle.position.copyFrom(segment.controlPoints[i]));

  const midIndex = Math.floor(segment.controlPoints.length / 2);
  segment.moveHandle.position.copyFrom(segment.controlPoints[midIndex]);
  segment.moveHandle.position.y += 0.5; // float above the field so it's easy to grab

  if (segment.copyHandle) {
    segment.copyHandle.position.copyFrom(segment.controlPoints[0]);
    segment.copyHandle.position.y += 0.5;
  }
  if (segment.rotationHandles.length > 0) {
    const center = getSegmentCenter(segment.controlPoints);
    const extent = segment.controlPoints.reduce((maximum, point) => Math.max(
      maximum,
      Math.hypot(point.x - center.x, point.z - center.z)
    ), 0);
    const radius = Math.max(0.6, extent + 0.35);
    segment.rotationHandles.forEach((handle, index) => {
      handle.position.set(center.x + (index === 0 ? -radius : radius), center.y + 0.5, center.z);
    });
  }
  updateSegmentHandleVisibility(segment);
}

// Rebuilds a segment's content from its (smoothed) curve: a formation segment
// respaces its rank of standing robots; a path segment re-registers its one
// robot's marching route so playback follows the updated curve.
const acceptedFormationControls = new WeakMap<Segment, Vector3[]>();
let selectionTools: ReturnType<typeof createSelectionEditor> | null = null;

function detachStandingSelection(robots: readonly TransformNode[]) {
  for (const segment of [...segments]) {
    if (segment.kind !== "formation" || !segment.robots.some(robot => robots.includes(robot))) continue;
    segment.robots = segment.robots.filter(robot => !robots.includes(robot));
    if (segment.anchorRobot && robots.includes(segment.anchorRobot)) segment.anchorRobot = undefined;
    if (segment.robots.length < 2) {
      segment.robots = [];
      removeEditorForm(segment);
      continue;
    }
    segment.controlPoints = segment.robots.map(robot => robot.position.clone());
    segment.erasedFormationIndices?.clear();
    segment.fitClosedCircle = false;
    refreshEditedFormation(segment);
  }
  refreshFormationEditor();
}

function refreshSelectionEdits(robots: readonly TransformNode[]) {
  eraseHistory.clear();
  robots.forEach(robot => {
    const counts = getRobotCounts(robot);
    if (!counts) return;
    const points = counts.map(count => count.position.clone());
    robotPaths.set(robot, points);
    const segment = pathSegmentByRobot.get(robot);
    if (segment) {
      segment.controlPoints = points;
      refreshSegmentVisuals(segment);
    } else updateRobotPathLine(robot, points);
  });
  for (const segment of segments) {
    if (segment.kind !== "formation" || !segment.robots.some(robot => robots.includes(robot))) continue;
    segment.controlPoints = segment.robots.map(robot => robot.position.clone());
    segment.erasedFormationIndices?.clear();
    segment.fitClosedCircle = false;
    refreshEditedFormation(segment);
  }
  refreshStepHandles();
  refreshFormationEditor();
}

function rebuildSegmentContent(segment: Segment) {
  eraseHistory.clear();
  if (segment.kind === "formation") {
    const previousRobots = segment.robots;
    const candidates: TransformNode[] = [];
    const poses: Array<{ robot: TransformNode; position: Vector3; rotationY: number }> = [];
    const formationPoints = getFormationPoints(segment.controlPoints, segment.fitClosedCircle, segment.spacing, segment.linear);

    formationPoints.forEach((point, index) => {      
      if (segment.erasedFormationIndices?.has(index)) return;
      const robotPrimitives = previousRobots[candidates.length] ??
        (index === 0 && segment.anchorRobot ? segment.anchorRobot : createLowPolyRobot(scene));
      if (index !== 0 || !segment.anchorRobot) {
        robotPrimitives.parent = pathRoot;
      }
      candidates.push(robotPrimitives);
      let rotationY = robotPrimitives.rotation.y;
      const next = formationPoints[index + 1] ??
        (isClosedFormation(segment.controlPoints) ? formationPoints[0] : undefined);
      if (next) {
        const dx = next.x - point.x;
        const dz = next.z - point.z;
        if (dx * dx + dz * dz > 0.0001) {
          rotationY = snapAngle(Math.atan2(dx, dz));
        }
      }
      poses.push({ robot: robotPrimitives, position: point, rotationY });
    });
    if (!tryManualMarcherPoses(poses, false, new Set(previousRobots))) {
      candidates.forEach((robot) => {
        if (robot !== segment.anchorRobot && !previousRobots.includes(robot)) robot.dispose();
      });
      const controls = acceptedFormationControls.get(segment);
      if (controls) segment.controlPoints = controls.map((point) => point.clone());
      return;
    }
    previousRobots.forEach((robot) => {
      if (robot !== segment.anchorRobot && !candidates.includes(robot)) robot.dispose();
    });
    segment.robots = candidates;
    candidates.forEach((robot) => robot.setEnabled(true));
    acceptedFormationControls.set(segment, segment.controlPoints.map((point) => point.clone()));
    rebuildFormationConnections(segment);
    refreshFormationEditor();
  } else {
    const curvePoints = segment.linear ? segment.controlPoints : buildCurvePoints(segment.controlPoints);
    const robot = segment.robots[0];
    if (robot && curvePoints.length >= 2) {
      robotPaths.set(robot, curvePoints);
      registerRobotPath(robot, curvePoints, scene, MARCH_STEP_YARDS);
      if (robot === selectedRobot) refreshStepHandles();
    }
  }
}

// Records a newly-drawn/extended curve as an independently maintained segment:
// builds its robot(s), curve line, and grab handles, and registers the handles
// for picking. robots is the initial robot list for a "path" segment (its one
// marching robot); pass [] for a "formation" segment (rebuilt below instead).
function createSegment(
  kind: SegmentKind,
  controlPoints: Vector3[],
  robots: TransformNode[],
  anchorRobot?: TransformNode,
  fitClosedCircle = true,
  linear = false
): Segment {
  const line = createTubeLine("segmentLine", controlPoints, SEGMENT_COLORS[kind]);

  const moveHandle = createSegmentHandle(
    "segmentMoveHandle",
    SEGMENT_MOVE_HANDLE_SIZE,
    new Color3(1, 0.5, 0.2)
  );
  const pointHandles = controlPoints.map(() =>
    createSegmentHandle("segmentPointHandle", SEGMENT_POINT_HANDLE_SIZE, SEGMENT_COLORS[kind])
  );
  const rotationHandles = kind === "path"
    ? [-1, 1].map(() => createSegmentHandle(
      "segmentRotationHandle",
      SEGMENT_MOVE_HANDLE_SIZE,
      SEGMENT_ROTATION_HANDLE_COLOR
    ))
    : [];
  const copyHandle =
    kind === "formation"
      ? createSegmentHandle("segmentCopyHandle", SEGMENT_MOVE_HANDLE_SIZE, new Color3(0.3, 0.9, 0.4))
      : null;

  const segment: Segment = {
    kind, controlPoints, line, moveHandle, pointHandles, rotationHandles, copyHandle,
    anchorRobot, fitClosedCircle, linear, robots,
    spacing: kind === "formation" ? Number(formationSpacingInput?.value ?? FORMATION_SPACING_YARDS) : undefined,
  };
  pointHandles.forEach((handle, index) => segmentPointHandleOwner.set(handle, { segment, index }));
  segmentMoveHandleOwner.set(moveHandle, segment);
  rotationHandles.forEach((handle) => segmentRotationHandleOwner.set(handle, segment));
  if (copyHandle) segmentCopyHandleOwner.set(copyHandle, segment);

  rebuildSegmentContent(segment);
  refreshSegmentVisuals(segment);
  segments.push(segment);
  refreshFormationEditor();
  if (kind === "path" && robots[0]) pathSegmentByRobot.set(robots[0], segment);
  return segment;
}

function removeRobotPath(robot: TransformNode) {
  const oldPath = robotPaths.get(robot);
  const segment = pathSegmentByRobot.get(robot);
  if (segment) {
    const index = segments.indexOf(segment);
    if (index >= 0) segments.splice(index, 1);
    pathLineOwner.delete(segment.line);
    segment.line.dispose(false, true);
    segment.moveHandle.dispose();
    segment.pointHandles.forEach((handle) => handle.dispose());
    segment.rotationHandles.forEach((handle) => handle.dispose());
    segment.copyHandle?.dispose();
    segmentMoveHandleOwner.delete(segment.moveHandle);
    segment.pointHandles.forEach((handle) => segmentPointHandleOwner.delete(handle));
    segment.rotationHandles.forEach((handle) => segmentRotationHandleOwner.delete(handle));
    if (segment.copyHandle) segmentCopyHandleOwner.delete(segment.copyHandle);
    pathSegmentByRobot.delete(robot);
  }
  const pathLine = robotPathLines.get(robot);
  if (pathLine) {
    pathLineOwner.delete(pathLine);
    if (pathLine !== segment?.line) pathLine.dispose(false, true);
    robotPathLines.delete(robot);
  }
  robotPaths.delete(robot);
  if (oldPath) {
    const storedIndex = storedPaths.indexOf(oldPath);
    if (storedIndex >= 0) {
      storedPaths.splice(storedIndex, 1);
      saveStoredPaths(storedPaths);
    }
  }
  clearRobotPath(robot);
}

function eraseMarcher(robot: TransformNode) {
  if (robot.isDisposed()) return;
  const path = robotPaths.get(robot);
  const pathSegment = pathSegmentByRobot.get(robot);
  const pathControlPoints = pathSegment?.controlPoints.map((point) => point.clone());
  const storedIndex = path ? storedPaths.indexOf(path) : -1;
  const position = robot.position.clone();
  const rotation = robot.rotation.clone();
  const memberships = segments.filter((segment) =>
    segment.kind === "formation" && segment.robots.includes(robot)
  ).map((segment) => {
    const rank = segment.robots.indexOf(robot);
    const erased = segment.erasedFormationIndices ??= new Set<number>();
    let originalIndex = -1;
    for (let remaining = 0; remaining <= rank; remaining++) {
      do { originalIndex++; } while (erased.has(originalIndex));
    }
    eraseHistoryReferences.set(segment, (eraseHistoryReferences.get(segment) ?? 0) + 1);
    return { segment, rank, originalIndex, anchor: segment.anchorRobot === robot };
  });
  let restoreRobot: () => void;
  let erased = false;
  const redo = () => {
    handInteraction.prepareForErase();
    restoreRobot = suspendRobotForErase(robot);
    removeRobotPath(robot);
    for (const membership of memberships) {
      const { segment, originalIndex } = membership;
      segment.erasedFormationIndices!.add(originalIndex);
      segment.robots.splice(segment.robots.indexOf(robot), 1);
      if (segment.anchorRobot === robot) segment.anchorRobot = undefined;
      rebuildFormationConnections(segment);
      segment.line.setEnabled(segment.robots.length > 0);
      updateSegmentHandleVisibility(segment);
    }
    if (selectedRobot === robot) selectRobot(null);
    erased = true;
  };
  redo();
  eraseHistory.record({
    redo,
    undo: () => {
      handInteraction.prepareForErase();
      robot.position.copyFrom(position);
      robot.rotation.copyFrom(rotation);
      for (const { segment, rank, originalIndex, anchor } of memberships) {
        segment.erasedFormationIndices!.delete(originalIndex);
        segment.robots.splice(rank, 0, robot);
        if (anchor) segment.anchorRobot = robot;
        segment.line.setEnabled(true);
        rebuildFormationConnections(segment);
        updateSegmentHandleVisibility(segment);
      }
      if (pathControlPoints) createSegment("path", pathControlPoints, [robot]);
      if (path) {
        robotPaths.set(robot, path);
        if (!pathControlPoints) updateRobotPathLine(robot, path);
        if (storedIndex >= 0 && !storedPaths.includes(path)) {
          storedPaths.splice(storedIndex, 0, path);
          saveStoredPaths(storedPaths);
        }
      }
      restoreRobot();
      refreshPathLineAppearance();
      erased = false;
    },
    dispose: () => {
      // Marchers dispose their own materials; templates' are shared.
      if (erased) robot.dispose();
      for (const { segment } of memberships) {
        const references = (eraseHistoryReferences.get(segment) ?? 1) - 1;
        if (references > 0) {
          eraseHistoryReferences.set(segment, references);
          continue;
        }
        eraseHistoryReferences.delete(segment);
        if (segment.robots.length > 0 || !segments.includes(segment)) continue;
        segments.splice(segments.indexOf(segment), 1);
        segment.line.dispose(false, true);
        segment.moveHandle.dispose();
        segmentMoveHandleOwner.delete(segment.moveHandle);
        segment.pointHandles.forEach((handle) => {
          segmentPointHandleOwner.delete(handle);
          handle.dispose();
        });
        segment.rotationHandles.forEach((handle) => {
          segmentRotationHandleOwner.delete(handle);
          handle.dispose();
        });
        if (segment.copyHandle) {
          segmentCopyHandleOwner.delete(segment.copyHandle);
          segment.copyHandle.dispose();
        }
      }
    },
  });
}

function createHandFormation(
  anchorRobot: TransformNode,
  controlPoints: Vector3[],
  fitClosedCircle = true
) {
  removeRobotPath(anchorRobot);
  if (isClosedFormation(controlPoints) && fitClosedCircle) {
    controlPoints = isVerticalFormation(controlPoints)
      ? sampleVerticalFormationCircle(fitVerticalFormationCircle(controlPoints), 16, true)
      : sampleFormationCircle(fitFormationCircle(controlPoints), 16, true);
  }
  const segment = createSegment('formation', controlPoints, [], anchorRobot, fitClosedCircle);
  refreshCollisionMarkers(scene);
  selectRobot(segment.robots[0] ?? anchorRobot);
}

type FormationPreset = "line" | "arc" | "circle" | "block" |
  "triangle" | "square" | "pentagon" | "hexagon" | "star";

function createFormationPreset(preset: FormationPreset, suppliedAnchor?: TransformNode) {
  const heldRobot = [...handInteraction.marcherGrabs.values()]
    .find((grab) => !grab.robot.isDisposed())?.robot;
  const anchor = suppliedAnchor ?? heldRobot ?? selectedRobot;
  if (!anchor || anchor.isDisposed()) return;

  const spacing = Number(formationSpacingInput?.value ?? FORMATION_SPACING_YARDS);
  if (!Number.isFinite(spacing) || spacing < 0.625 || spacing > 10) {
    publishFormationEdit("Spacing must be between 0.625 and 10 yards.");
    return;
  }
  const origin = snapToStepGrid(anchor.position.clone());
  const forward = new Vector3(Math.sin(anchor.rotation.y), 0, Math.cos(anchor.rotation.y));
  const across = new Vector3(Math.cos(anchor.rotation.y), 0, -Math.sin(anchor.rotation.y));
  const side = forward.scale(spacing);
  const rowStep = across.scale(spacing);

  if (preset === "line") {
    createHandFormation(anchor, [origin, origin.add(side.scale(4))]);
    return;
  }

  if (preset === "arc") {
    createHandFormation(anchor, [
      origin,
      origin.add(side.scale(1.5)).add(rowStep.scale(2)),
      origin.add(side.scale(3)).add(rowStep.scale(2.5)),
      origin.add(side.scale(4.5)).add(rowStep.scale(1.5)),
    ]);
    return;
  }

  if (preset === "circle") {
    const radius = spacing * 3;
    const center = origin.add(forward.scale(radius));
    const points: Vector3[] = [];
    for (let index = 0; index <= 8; index++) {
      const angle = Math.PI + index * Math.PI / 4;
      points.push(center
        .add(forward.scale(radius * Math.cos(angle)))
        .add(across.scale(radius * Math.sin(angle))));
    }
    createHandFormation(anchor, points);
    return;
  }

  if (preset === "triangle" || preset === "square" ||
    preset === "pentagon" || preset === "hexagon" || preset === "star") {
    const isStar = preset === "star";
    const sides = preset === "triangle" ? 3 : preset === "square" ? 4 :
      preset === "pentagon" ? 5 : preset === "hexagon" ? 6 : 10;
    const radius = spacing * 3;
    const center = origin.add(forward.scale(radius));
    const points: Vector3[] = [];
    for (let index = 0; index < sides; index++) {
      const angle = Math.PI + index * Math.PI * 2 / sides;
      const pointRadius = isStar && index % 2 === 1 ? radius * 0.48 : radius;
      points.push(center
        .add(forward.scale(pointRadius * Math.cos(angle)))
        .add(across.scale(pointRadius * Math.sin(angle))));
    }
    points.push(points[0].clone());
    createHandFormation(anchor, points, false);
    return;
  }

  removeRobotPath(anchor);
  for (let row = 0; row < 3; row++) {
    const start = origin.add(rowStep.scale(row));
    const end = start.add(side.scale(2));
    createSegment("formation", [start, end], [], row === 0 ? anchor : undefined);
  }
  refreshCollisionMarkers(scene);
  selectRobot(anchor);
}

function publishFormationEdit(message: string) {
  if (formationEditorStatus) formationEditorStatus.textContent = message;
  showPlacementNotice(message);
}

function getEditorFormation(): Segment | undefined {
  const forms = segments.filter((segment) => segment.kind === "formation" && segment.robots.length > 0);
  return forms.find((segment) => segment.robots.some((robot) =>
    String(robot.uniqueId) === formationSelection?.value)) ??
    forms.find((segment) => selectedRobot !== null && segment.robots.includes(selectedRobot));
}

function refreshFormationEditor() {
  if (!formationSelection) return;
  const selector = formationSelection;
  const forms = segments.filter((segment) => segment.kind === "formation" &&
    segment.robots.some((robot) => !robot.isDisposed() && robot.isEnabled()));
  const current = forms.find((segment) => selectedRobot !== null && segment.robots.includes(selectedRobot)) ??
    forms.find((segment) => segment.robots.some((robot) => String(robot.uniqueId) === selector.value));
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a form";
  formationSelection.replaceChildren(placeholder, ...forms.map((segment, index) => {
    const option = document.createElement("option");
    option.value = String(segment.robots[0].uniqueId);
    option.textContent = `Form ${index + 1} (${segment.robots.length} marchers)`;
    return option;
  }));
  formationSelection.value = current ? String(current.robots[0].uniqueId) : "";
}

function getEditableEditorFormation(): Segment | undefined {
  const segment = getEditorFormation();
  if (!segment) {
    publishFormationEdit("Select a standing form first. Imported marching routes are unchanged.");
    return undefined;
  }
  if (segment.robots.some((robot) => getRobotCounts(robot) !== null || robot.isDisposed())) {
    publishFormationEdit("This form contains marching routes. Stop using it as a route before editing the standing form.");
    return undefined;
  }
  return segment;
}

function sampleDestinationGuide(controlPoints: readonly Vector3[], count: number): Vector3[] {
  const points = controlPoints.map(point => new Vector3(point.x, FIELD_SURFACE_Y, point.z));
  const closed = points.length > 2 && Vector3.DistanceSquared(points[0], points[points.length - 1]) < 1e-6;
  if (closed) points.pop();

  const segmentCount = closed ? points.length : points.length - 1;
  const lengths = Array.from({ length: segmentCount }, (_, index) =>
    Vector3.Distance(points[index], points[(index + 1) % points.length]));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (points.length < 2 || !Number.isFinite(totalLength) || totalLength < 0.05) return [];

  return Array.from({ length: count }, (_, index) => {
    const distance = closed
      ? totalLength * index / count
      : count === 1 ? totalLength / 2 : totalLength * index / (count - 1);
    let remaining = distance;
    let segment = 0;
    while (segment < lengths.length - 1 && remaining > lengths[segment]) {
      remaining -= lengths[segment];
      segment++;
    }
    const start = points[segment];
    const end = points[(segment + 1) % points.length];
    const length = lengths[segment];
    return Vector3.Lerp(start, end, length > 0 ? Math.min(1, remaining / length) : 0);
  });
}

function createSynchronizedRoutesFromGuide(controlPoints: Vector3[]): boolean {
  const segment = getEditableEditorFormation();
  if (!segment) return false;
  if (!isGuideOnField(controlPoints)) {
    publishFormationEdit("Destination guide must be finite and stay inside the field.");
    return false;
  }
  const targets = sampleDestinationGuide(controlPoints, segment.robots.length);
  if (targets.length !== segment.robots.length) {
    publishFormationEdit("Destination guide must have a visible length and at least two distinct points.");
    return false;
  }

  const moving = new Set(segment.robots);
  const stationary = [...robotPaths.keys()]
    .filter(robot => !moving.has(robot) && !robot.isDisposed() && robot.isEnabled())
    .map(robot => getRobotCounts(robot)?.[0]?.position.clone() ?? robot.position.clone());
  const minSpacing = COLLISION_MARKER_RADIUS_YARDS * 2;
  for (let first = 0; first < targets.length; first++) {
    for (let second = first + 1; second < targets.length; second++) {
      if (Vector3.Distance(targets[first], targets[second]) < minSpacing) {
        publishFormationEdit("Destination guide is too small for this form; space its marcher positions farther apart.");
        return false;
      }
    }
    if (stationary.some(position => Vector3.Distance(targets[first], position) < minSpacing)) {
      publishFormationEdit("Destination guide overlaps another marcher. Choose a clear field area.");
      return false;
    }
  }

  const starts = segment.robots.map(robot => robot.position.clone());
  const routes = buildSynchronizedPaths(starts, targets, stationary);
  segment.robots.forEach((robot, index) => {
    const route = routes[index];
    robotPaths.set(robot, route);
    updateRobotPathLine(robot, route);
    registerRobotCounts(robot, route, scene, undefined, true);
  });
  refreshCollisionMarkers(scene);
  seekToCount(0);
  playAll();
  selectRobot(segment.robots[0], true);
  publishFormationEdit(`Created ${routes.length} synchronized routes with ${routes[0].length - 1} shared counts; playback started.`);
  return true;
}

function refreshEditedFormation(segment: Segment) {
  acceptedFormationControls.set(segment, segment.controlPoints.map(point => point.clone()));
  rebuildFormationConnections(segment);
  refreshSegmentVisuals(segment);
  refreshCollisionMarkers(scene);
}

function transformEditorFormation(transform: FormationTransform, spacing?: number): boolean {
  const segment = getEditableEditorFormation();
  if (!segment) return false;
  const nextSpacing = spacing ?? (segment.spacing ?? FORMATION_SPACING_YARDS) * transform.scale;
  if (!Number.isFinite(nextSpacing) || nextSpacing < 0.625 || nextSpacing > 10) {
    publishFormationEdit("Scaling must keep marcher spacing between 0.625 and 10 yards.");
    return false;
  }
  const center = getSegmentCenter(segment.controlPoints);
  const translation = constrainFormationMovement(new Vector3(transform.x, 0, transform.z));
  transform = { ...transform, x: translation.x, z: translation.z };
  if (gridSnapToggle?.checked) {
    const target = snapToStepGrid(center.add(new Vector3(transform.x, 0, transform.z)));
    const snappedTranslation = constrainFormationMovement(target.subtract(center));
    transform = { ...transform, x: snappedTranslation.x, z: snappedTranslation.z };
  }
  transform = { ...transform, rotation: snapAngle(transform.rotation) };
  const move = (point: Vector3) => {
    const result = transformFormationPoint(point, center, transform);
    return new Vector3(result.x, result.y, result.z);
  };
  const poses = segment.robots.map((robot) => ({
    robot, position: move(robot.position), rotationY: robot.rotation.y + transform.rotation,
  }));
  if (!tryManualMarcherPoses(poses, false)) {
    publishFormationEdit("Form edit blocked: leave room for every marcher's body and instrument. Nothing was changed.");
    return false;
  }
  eraseHistory.clear();
  segment.controlPoints = segment.controlPoints.map(move);
  segment.spacing = nextSpacing;
  refreshEditedFormation(segment);
  publishFormationEdit(`Updated ${segment.robots.length} marchers; spacing ${segment.spacing.toFixed(3)} yards. Routes unchanged.`);
  return true;
}

function alignEditorFormation(action: FormationAlignment | "round"): boolean {
  const segment = getEditableEditorFormation();
  if (!segment) return false;
  const points = segment.robots.map(robot => robot.position);
  const targets = action === "round" ? points.map(point => snapDrillPoint(point, 1))
    : alignFormationPoints(points, action);
  const positions = targets.map(point => new Vector3(point.x, point.y, point.z));
  if (!tryManualMarcherPoses(segment.robots.map((robot, index) => ({
    robot, position: positions[index], rotationY: robot.rotation.y,
  })), false)) {
    publishFormationEdit("Form edit blocked: leave room for every marcher's body and instrument. Nothing was changed.");
    return false;
  }
  eraseHistory.clear();
  segment.controlPoints = positions.map(point => point.clone());
  segment.fitClosedCircle = false;
  segment.erasedFormationIndices?.clear();
  refreshEditedFormation(segment);
  publishFormationEdit(`Updated ${positions.length} marchers with ${action === "round" ? "whole-yard rounding" : action}. Routes unchanged.`);
  return true;
}

function editFormationSpacing(factor: number) {
  const segment = getEditorFormation();
  const current = segment?.spacing ?? Number(formationSpacingInput?.value ?? FORMATION_SPACING_YARDS);
  const spacing = current * factor;
  if (spacing < 0.625 || spacing > 10) {
    publishFormationEdit("Spacing must remain between 0.625 and 10 yards.");
    return;
  }
  if (segment && !transformEditorFormation({ x: 0, z: 0, rotation: 0, scale: factor }, spacing)) return;
  if (formationSpacingInput) formationSpacingInput.value = String(spacing);
  if (!segment) publishFormationEdit(`New form spacing: ${spacing.toFixed(3)} yards.`);
}

function removeEditorForm(segment: Segment) {
  segment.robots.forEach((robot) => robot.dispose());
  formationConnectionsBySegment.get(segment)?.forEach((connection) => connection.mesh.dispose());
  formationConnectionsBySegment.delete(segment);
  segment.line.dispose(false, true);
  segmentMoveHandleOwner.delete(segment.moveHandle);
  segment.moveHandle.dispose();
  segment.pointHandles.forEach((handle) => { segmentPointHandleOwner.delete(handle); handle.dispose(); });
  segment.rotationHandles.forEach((handle) => { segmentRotationHandleOwner.delete(handle); handle.dispose(); });
  if (segment.copyHandle) {
    segmentCopyHandleOwner.delete(segment.copyHandle);
    segment.copyHandle.dispose();
  }
  segments.splice(segments.indexOf(segment), 1);
}

formationSelection?.addEventListener("change", () => {
  const segment = getEditorFormation();
  if (!formationSelection?.value) return;
  if (segment) {
    setMarcherPOVEnabled(false);
    selectRobot(segment.robots[0], true);
    if (formationSpacingInput) formationSpacingInput.value = String(segment.spacing ?? FORMATION_SPACING_YARDS);
    publishFormationEdit(`Selected a standing form with ${segment.robots.length} marchers.`);
  }
});

formationEditor?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!formationEditor?.reportValidity()) return;
  if (floorCalibrationToggle?.checked) {
    publishFormationEdit("Finish floor calibration before editing forms.");
    return;
  }
  const action = event.submitter instanceof HTMLButtonElement ? event.submitter.value : "create";
  if (action === "alignX" || action === "alignZ" || action === "distributeX" ||
    action === "distributeZ" || action === "round") {
    alignEditorFormation(action);
    return;
  }
  const spacing = Number(formationSpacingInput?.value);
  if (!Number.isFinite(spacing) || spacing < 0.625 || spacing > 10) {
    publishFormationEdit("Spacing must be between 0.625 and 10 yards.");
    return;
  }
  if (action === "create") {
    const preset = formationPresetSelect?.value;
    const presets: FormationPreset[] = ["line", "arc", "circle", "block", "triangle", "square", "pentagon", "hexagon", "star"];
    if (!presets.some((value) => value === preset)) {
      publishFormationEdit("Choose a supported form tool.");
      return;
    }
    const origin = snapToStepGrid(new Vector3(Number(formationOriginX?.value), FIELD_SURFACE_Y, Number(formationOriginZ?.value)));
    if (!Number.isFinite(origin.x + origin.z)) {
      publishFormationEdit("Form origin must be finite.");
      return;
    }
    const anchor = createStandingMarcher(origin);
    if (!anchor.isEnabled()) {
      anchor.dispose();
      publishFormationEdit("Form origin is occupied. Choose an empty area of the field.");
      return;
    }
    const previousForms = new Set(segments);
    const validPreset = presets.find((value) => value === preset)!;
    setMarcherPOVEnabled(false);
    createFormationPreset(validPreset, anchor);
    const created = segments.filter((segment) => !previousForms.has(segment));
    if (created.length === 0 || created.some((segment) => segment.robots.length === 0)) {
      created.forEach(removeEditorForm);
      if (!anchor.isDisposed()) anchor.dispose();
      selectRobot(null);
      refreshCollisionMarkers(scene);
      publishFormationEdit("Form could not fit without collisions. Increase spacing or choose another origin.");
      return;
    }
    selectRobot(created[0].robots[0], true);
    publishFormationEdit(`Created ${created.length} standing form${created.length === 1 ? "" : "s"} with ${created.reduce((sum, form) => sum + form.robots.length, 0)} marchers.`);
    return;
  }
  if (action === "spacing") {
    const segment = getEditorFormation();
    if (!segment) {
      publishFormationEdit("Select a standing form before applying spacing.");
      return;
    }
    transformEditorFormation({ x: 0, z: 0, rotation: 0, scale: spacing / (segment.spacing ?? FORMATION_SPACING_YARDS) }, spacing);
    return;
  }
  transformEditorFormation({
    x: Number(formationMoveX?.value), z: Number(formationMoveZ?.value),
    rotation: Number(formationRotation?.value) * Math.PI / 180, scale: Number(formationScale?.value),
  });
});

const LETTER_BITMAPS: Record<FormationLetter, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
};

function createLetterFormation(letter: FormationLetter) {
  const heldRobot = [...handInteraction.marcherGrabs.values()]
    .find((grab) => !grab.robot.isDisposed())?.robot;
  const anchor = heldRobot ?? selectedRobot;
  if (!anchor || anchor.isDisposed()) return;

  removeRobotPath(anchor);
  const origin = anchor.position.clone();
  const forward = new Vector3(Math.sin(anchor.rotation.y), 0, Math.cos(anchor.rotation.y));
  const across = new Vector3(Math.cos(anchor.rotation.y), 0, -Math.sin(anchor.rotation.y))
    .scale(FORMATION_SPACING_YARDS);
  const side = forward.scale(FORMATION_SPACING_YARDS);
  let anchorUsed = false;
  for (let row = 0; row < LETTER_BITMAPS[letter].length; row++) {
    const bitmapRow = LETTER_BITMAPS[letter][row];
    let column = 0;
    while (column < bitmapRow.length) {
      while (column < bitmapRow.length && bitmapRow[column] !== "#") column++;
      if (column >= bitmapRow.length) break;
      const startColumn = column;
      while (column < bitmapRow.length && bitmapRow[column] === "#") column++;
      const endColumn = column - 1;
      const rowOrigin = origin
        .add(across.scale(startColumn - 2))
        .add(side.scale(3 - row));
      if (startColumn === endColumn) {
        if (!anchorUsed) {
          if (!tryManualMarcherPose(anchor, rowOrigin)) continue;
          anchor.setEnabled(true);
          anchorUsed = true;
        } else {
          const marcher = createStandingMarcher(rowOrigin);
          if (!marcher.isEnabled()) marcher.dispose();
        }
        continue;
      }
      const points = [rowOrigin, rowOrigin.add(across.scale(endColumn - startColumn))];
      createSegment("formation", points, [], anchorUsed ? undefined : anchor, false);
      anchorUsed = true;
    }
  }
  refreshCollisionMarkers(scene);
  selectRobot(anchor);
}

// Copies a formation's curve into a path segment for its first robot, so that
// robot marches single file through the same positions the formation stands in.
function copyFormationToPathSegment(formation: Segment) {
  if (formation.kind !== "formation" || formation.robots.length === 0) return;
  const robot = formation.robots[0];
  const clonedPoints = formation.controlPoints.map((point) => point.clone());
  const existing = pathSegmentByRobot.get(robot);
  if (existing) {
    existing.controlPoints = clonedPoints;
    existing.linear = formation.linear;
    rebuildSegmentContent(existing);
    refreshSegmentVisuals(existing);
  } else {
    createSegment("path", clonedPoints, [robot], undefined, formation.fitClosedCircle, formation.linear);
  }
  selectRobot(robot);
}

function spawnRobotForPath(points: Vector3[]) {
  const robot = createLowPolyRobot(scene);
  robot.parent = pathRoot;
  robotPaths.set(robot, points);
  updateRobotPathLine(robot, points);
  walkRobotAlongPath(robot, points, scene, MARCH_STEP_YARDS);
  selectRobot(robot);
}

storedPaths.forEach(spawnRobotForPath);

const PATH_POINT_MIN_DISTANCE = 0.4; // yards between recorded points
// The segment currently being dragged as a whole (via its move handle), and
// the last field point seen while dragging it (to move by incremental delta).
let movingSegment: Segment | null = null;
let lastMovePoint: Vector3 | null = null;
// The segment + control point index currently being reshaped (via a point handle).
let reshapingSegment: { segment: Segment; index: number } | null = null;
interface RotationHandleDrag {
  segment: Segment;
  handleIndex: number;
  point: Vector3;
}

let rotatingSegment: {
  segment: Segment;
  center: Vector3;
  startAngle: number;
  originalControlPoints: Vector3[];
} | null = null;
const rotationHandleDrags = new Map<string, RotationHandleDrag>();
let twoHandPathManipulation: {
  segment: Segment;
  center: Vector3;
  startMidpoint: Vector3;
  startDistance: number;
  startAngle: number;
  originalControlPoints: Vector3[];
} | null = null;
// The selected robot's marching step (count index) currently being dragged
// via its own per-step handle.
let reshapingStepHandle: { robot: TransformNode; index: number } | null = null;
// A robot grabbed directly by its body (not a handle) — dragging it scrubs
// the shared timeline to whichever of its own steps is nearest the laser.
let scrubbingRobot: TransformNode | null = null;
const triggerHeld = new Map<string, boolean>();
const gripHeld = new Map<string, boolean>();
const tempoControllerDrags = new Set<string>();
let tempoPointerDragging = false;
// Which controller button holds each floating panel grab, so releasing that
// button (grip or trigger) lets go.
const padGrabButtons = new Map<string, "grip" | "trigger">();
// True while a controller's trigger-down landed on the hand menu, so the rest
// of the hold/release is treated as a menu tap instead of drawing a path.
const menuInteractionHeld = new Map<string, boolean>();

function executeMenuAction(hit: NonNullable<ReturnType<typeof getHandMenuHit>>) {
  switch (hit.action) {
    case "fieldProjector":
      executeFieldProjectorAction(hit.command);
      break;
    case "marcherPaint":
    case "marcherPaintColor":
      executeMarcherPaintAction(hit);
      break;
    case "drawingTool":
      executeDrawingToolAction(hit);
      break;
    case "eraseMode":
      setEraseMode(!eraseMode);
      break;
    case "marcherPOV":
      setMarcherPOVEnabled(!isMarcherPOVActive());
      break;
    case "undoErase":
      if (!floorCalibrationToggle?.checked) eraseHistory.undo();
      break;
    case "redoErase":
      if (!floorCalibrationToggle?.checked) eraseHistory.redo();
      break;
    case "drillChartPad":
      summonDrillChartPad();
      break;
    case "musicStandSummon":
      summonMusicStand();
      break;
    case "drillChartHide":
      setDrillChartPadVisible(false);
      break;
    case "musicStandHide":
      setMusicStandVisible(false);
      break;
    case "drillChartPage":
      flipDrillChartPage(hit.direction);
      break;
    case "drillChartInsertPage":
      addBlankChartPage();
      break;
    case "drillChartTransition": {
      const label = cycleChartTransition(hit.kind);
      redrawDrillChartPad();
      const kind = hit.kind === "shape" ? "Path" : hit.kind === "pace" ? "Pace" : "Style";
      showPlacementNotice(`Transition ${kind}: ${label}. Place ghosts or press Apply to use it.`);
      break;
    }
    case "drillChartApplyTransition":
      applyChartTransition();
      break;
    case "drillChartSaveDraft":
      saveChartPageDraft();
      break;
    case "drillChartResumeDraft":
      resumeChartPageDraft();
      break;
    case "instrument":
      chooseInstrument(hit.instrument);
      break;
    case "instrumentPanelSummon":
      summonInstrumentPanel();
      break;
    case "instrumentPanelHide":
      hideInstrumentPanel();
      break;
    case "createMarcher":
      selectRobot(null);
      chooseInstrument(hit.instrument);
      setPlacementMode(true);
      showPlacementNotice("Instrument selected: place new marchers on the field. Choose Done placing to finish.");
      break;
    case "finishMarcherPlacement":
      setPlacementMode(false);
      hideInstrumentPanel();
      break;
    case "commitFormation":
      handInteraction.commitFormation();
      break;
    case "formationLibrary":
      setFormationLibraryOpen(true);
      break;
    case "formationLibraryBack":
      setFormationLibraryPage("shapes");
      break;
    case "formationLibraryClose":
      setFormationLibraryOpen(false);
      break;
    case "lettersLibrary":
      setFormationLibraryPage("letters");
      break;
    case "formationPreset":
      setFormationLibraryOpen(false);
      createFormationPreset(hit.preset);
      break;
    case "formationGridSnap":
      if (gridSnapToggle) {
        gridSnapToggle.checked = !gridSnapToggle.checked;
        publishFormationEdit(`Field grid snap ${gridSnapToggle.checked ? "enabled" : "disabled"}.`);
      }
      break;
    case "formationSpacing":
      editFormationSpacing(hit.factor);
      break;
    case "formationRotate":
      transformEditorFormation({ x: 0, z: 0, rotation: hit.radians, scale: 1 });
      break;
    case "formationScale":
      transformEditorFormation({ x: 0, z: 0, rotation: 0, scale: hit.factor });
      break;
    case "formationLetter":
      setFormationLibraryOpen(false);
      createLetterFormation(hit.letter);
      break;
    case "playPause":
      toggleAllPlayback();
      break;
    case "rewind":
      rewindAll();
      break;
    case "fastForward":
      fastForwardAll();
      break;
    case "stepBack":
      stepAll(-1);
      break;
    case "stepForward":
      stepAll(1);
      break;
    case "seek":
      seekAll(hit.fraction);
      break;
    case "fullScaleVR":
      fullScaleVRButton?.click();
      break;
    case "tabletopScale":
      tabletopScaleButton?.click();
      break;
    case "musicStandStaffToggle":
      cycleMusicStandStaff();
      break;
  }
}
function captureMarcherMove(robot: TransformNode) {
  const capture = () => ({
    movement: captureMarcherMovement(robot),
    path: robotPaths.get(robot)?.map(point => point.clone()),
    controls: pathSegmentByRobot.get(robot)?.controlPoints.map(point => point.clone()),
  });
  const before = capture();
  return () => {
    const after = capture();
    if (before.movement.position.equalsWithEpsilon(after.movement.position) &&
      Math.abs(before.movement.rotationY - after.movement.rotationY) < 1e-6 &&
      before.movement.fixedFacingY === after.movement.fixedFacingY) return;
    const apply = (snapshot: ReturnType<typeof capture>) => {
      handInteraction.prepareForErase();
      restoreMarcherMovement(robot, snapshot.movement);
      const previousPath = robotPaths.get(robot);
      if (snapshot.path) {
        const path = snapshot.path.map(point => point.clone());
        robotPaths.set(robot, path);
        const index = previousPath ? storedPaths.indexOf(previousPath) : -1;
        if (index >= 0) {
          storedPaths[index] = path;
          saveStoredPaths(storedPaths);
        }
        if (robotPathLines.has(robot)) updateRobotPathLine(robot, path);
      }
      const segment = pathSegmentByRobot.get(robot);
      if (segment && snapshot.controls) {
        segment.controlPoints = snapshot.controls.map(point => point.clone());
        refreshSegmentVisuals(segment);
      }
      segments.filter(entry => entry.kind === "formation" && entry.robots.includes(robot))
        .forEach(rebuildFormationConnections);
      if (selectedRobot === robot) refreshStepHandles();
      refreshCollisionMarkers(scene);
    };
    eraseHistory.record({ undo: () => apply(before), redo: () => apply(after) });
  };
}

const handInteraction = createHandInteraction({
  pathRoot,
  robotPaths,
  robotPathLines,
  storedPaths,
  saveStoredPaths,
  pathSegmentByRobot,
  segments,
  placementDrafts,
  pathPointMinDistance: PATH_POINT_MIN_DISTANCE,
  isPlacementMode: () => placementMode,
  isEraseMode: () => eraseMode,
  isPainting: isMarcherPainting,
  paintMarcher: tryPaintMarcher,
  eraseMarcher,
  getSelectedRobot: () => selectedRobot,
  selectRobot,
  createStandingMarcher,
  createHandFormation,
  getFormationPoints,
  getMarcherCircle: (robot) => {
    const segment = segments.find((entry) => entry.kind === "formation" &&
      entry.robots.includes(robot) && entry.fitClosedCircle && isClosedFormation(entry.controlPoints) &&
      !isVerticalFormation(entry.controlPoints));
    return segment ? { segment, center: fitFormationCircle(segment.controlPoints).center } : null;
  },
  resizeCircleFormation: (segment, controlPoints) => {
    segment.controlPoints = controlPoints;
    rebuildSegmentContent(segment);
    refreshSegmentVisuals(segment);
    if (selectedRobot?.isDisposed()) selectRobot(segment.robots[0] ?? null);
  },
  updateRobotPathLine,
  refreshSegmentVisuals,
  rebuildFormationConnections,
  refreshStepHandles,
  snapToStepGrid,
  activateHandMenuAtPoint: (point) => {
    const hit = getHandMenuHitNearPoint(point);
    if (!hit) return false;
    executeMenuAction(hit);
    return true;
  },
  selectNewMarcherInstrument: (instrument) => {
    selectRobot(null);
    chooseInstrument(instrument);
  },
  activateChartButton: executeMenuAction,
  notifyPlacement: showPlacementNotice,
  captureMarcherMove,
});
const { marcherGrabs } = handInteraction;

export function setHandTracking(tracking: WebXRHandTracking | null) {
  mediaHandTracking = tracking;
  resetThumbJog(thumbJogState);
  scrubRemainder = 0;
  handInteraction.setHandTracking(tracking);
  setMenuHandTracking(tracking);
}

export function isHandMarcherInteraction(handedness: string, point: Vector3) {
  return handInteraction.isHandMarcherInteraction(handedness, point);
}

function beginMarcherGrab(
  handedness: string,
  robot: TransformNode,
  point: Vector3,
  source: "hand" | "controller",
  rayDistance = 0,
  facingYaw: number | null = null
) {
  handInteraction.beginMarcherGrab(handedness, robot, point, source, rayDistance, facingYaw);
}

function moveMarcherGrab(handedness: string, point: Vector3, facingYaw: number | null = null) {
  handInteraction.moveMarcherGrab(handedness, point, facingYaw);
}

function finishMarcherGrab(handedness: string, commit: boolean) {
  handInteraction.finishMarcherGrab(handedness, commit);
}

export function updateTabletopHands() {
  handInteraction.updateTabletopHands();
  setFormationCommitAvailable(handInteraction.hasPendingFormation());
  setFormationLibraryAnchorAvailable(
    selectedRobot !== null || [...handInteraction.marcherGrabs.values()].some((grab) => !grab.robot.isDisposed())
  );
}

function finishFingerPath(commit: boolean) {
  handInteraction.finishFingerPath(commit);
}

export function updateHandPathDrawing() {
  handInteraction.updateHandPathDrawing();
}

function getTriggerPressed(controller: WebXRInputSource): boolean {
  const trigger = controller.motionController?.getComponentOfType('trigger');
  return !!trigger?.pressed || !!controller.inputSource.gamepad?.buttons?.[0]?.pressed;
}

function getControllerRay(controller: WebXRInputSource): Ray {
  const pointer = controller.pointer;
  const forward = pointer.getDirection(Axis.Z);
  return new Ray(pointer.absolutePosition, forward, 100);
}

// Raycasts from the controller pointer to the field and returns the hit
// point converted into the path root's local space (so it tracks the field
// if it's later moved/scaled/rotated), or null if the pointer isn't aiming at it.
function getFieldPointFromController(controller: WebXRInputSource): Vector3 | null {
  return getFieldPointFromRay(getControllerRay(controller));
}

function getFieldPointFromRay(ray: Ray): Vector3 | null {
  const pick = scene.pickWithRay(ray, (mesh) => mesh.name === "field");
  if (!pick?.hit || !pick.pickedPoint) {
    return null;
  }

  pathRoot.computeWorldMatrix(true);
  const localPoint = Vector3.TransformCoordinates(
    pick.pickedPoint,
    Matrix.Invert(pathRoot.getWorldMatrix())
  );
  localPoint.y += 0.02; // lift slightly above the turf so the line doesn't z-fight
  return snapToStepGrid(localPoint);
}

// Path-root-local turf point under a ray without step-grid rounding, for guide picking.
function getRawFieldPointFromRay(ray: Ray): Vector3 | null {
  const pick = scene.pickWithRay(ray, (mesh) => mesh.name === "field");
  if (!pick?.hit || !pick.pickedPoint) return null;
  return Vector3.TransformCoordinates(pick.pickedPoint, Matrix.Invert(pathRoot.computeWorldMatrix(true)));
}

// About 4 cm of real-world reach, never less than 0.75 yards on a full-size field.
function getGuidePickRadius() {
  return Math.max(0.75, 0.04 / getARScale());
}

function selectDrawingGuideFromRay(ray: Ray) {
  if (floorCalibrationToggle?.checked) return false;
  const point = getRawFieldPointFromRay(ray);
  return !!point && selectDrawingGuideNear(point, getGuidePickRadius());
}

// Controller triggers select/edit existing content or place standing marchers
// when placement mode is enabled. They never draw or extend marching paths.
export function updateRobotPathFromControllers() {
  padGrabButtons.forEach((_, source) => {
    if (floorCalibrationToggle?.checked || !controllerRegistry.get(source)) {
      endFloatingPanelGrab(source);
      padGrabButtons.delete(source);
    }
  });
  if (floorCalibrationToggle?.checked) return;
  updateInstrumentPaletteFromControllers();
  updateDraftingToolsFromControllers();
  updateAdjacentMarcherGestures();
  updateScrubFromControllers(scene.getEngine().getDeltaTime() / 1000);

  // Formation connections only need to catch up every few frames, not every
  // single one, since they're just sliding to follow already-moving robots.
  formationConnectionFrameCounter++;
  if (formationConnectionFrameCounter >= FORMATION_CONNECTION_UPDATE_INTERVAL_FRAMES) {
    formationConnectionFrameCounter = 0;
    updateFormationConnections();
  }

  controllerRegistry.forEach((controller, handedness) => {
    if (controller.inputSource.hand) return;
    const gripPressed = isGripPressed(controller);
    const wasGripPressed = gripHeld.get(handedness) ?? false;
    gripHeld.set(handedness, gripPressed);
    const isPressed = getTriggerPressed(controller);
    const wasPressed = triggerHeld.get(handedness) ?? false;
    triggerHeld.set(handedness, isPressed);

    const marcherGrab = marcherGrabs.get(handedness);
    if (marcherGrab?.source === "hand") return;
    if (isFloatingPanelGrabbed(handedness)) {
      const holding = padGrabButtons.get(handedness) === "trigger" ? isPressed : gripPressed;
      if (!holding) {
        endFloatingPanelGrab(handedness);
        padGrabButtons.delete(handedness);
      } else {
        // Thumbstick forward/back pushes or pulls the held panel instead of navigating.
        const axis = getThumbstickAxes(controller).y;
        const deflection = Math.abs(axis) > SCRUB_DEADZONE
          ? Math.sign(axis) * (Math.min(1, Math.abs(axis)) - SCRUB_DEADZONE) / (1 - SCRUB_DEADZONE)
          : 0;
        if (deflection !== 0) {
          const deltaSeconds = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
          telescopeFloatingPanelGrab(handedness, -deflection * PANEL_GRAB_DEPTH_SPEED * deltaSeconds);
        }
        updateFloatingPanelGrab(handedness, getControllerPosition(controller).computeWorldMatrix(true));
      }
      return;
    }
    if (!marcherGrab && gripPressed && !wasGripPressed && !menuInteractionHeld.get(handedness)) {
      const gripNode = getControllerPosition(controller);
      // Gripping an instrument button pulls a new marcher of that instrument into the grab.
      const gripPoint = gripNode.getAbsolutePosition();
      const facingYaw = handInteraction.getFacingYaw(getControllerRay(controller).direction);
      const nearButton = getFloatingPanelButtonNearPoint(gripPoint) ?? getHandMenuHitNearPoint(gripPoint);
      if (nearButton && handInteraction.grabPaletteMarcher(handedness, nearButton, gripPoint, "controller", -1,
        facingYaw)) return;
      const paletteRay = getControllerRay(controller);
      const paletteMenuPick = pickMenuControl(paletteRay);
      const palettePanelPick = pickFloatingPanel(paletteRay);
      if (paletteMenuPick?.hit && paletteMenuPick.pickedPoint &&
        (!palettePanelPick?.hit || paletteMenuPick.distance <= palettePanelPick.distance + 0.001) &&
        handInteraction.grabPaletteMarcher(handedness, getHandMenuHit(paletteMenuPick),
          paletteMenuPick.pickedPoint, "controller", paletteMenuPick.distance, facingYaw)) return;
      const nearPad = getFloatingPanelNear(gripNode.getAbsolutePosition(), 0.06);
      const pick = nearPad ? null : pickFloatingPanel(getControllerRay(controller));
      if (nearPad || pick?.hit) {
        beginFloatingPanelGrab(handedness, gripNode.computeWorldMatrix(true),
          nearPad ? null : pick?.pickedMesh, nearPad ? gripNode.getAbsolutePosition() : pick?.pickedPoint ?? undefined, 0.06, true);
        padGrabButtons.set(handedness, "grip");
        return;
      }
    }
    if (handInteraction.updateControllerFormationPull(handedness, gripPressed,
      getControllerPosition(controller).getAbsolutePosition())) return;
    if (marcherGrab?.source === "controller") {
      if (!gripPressed) finishMarcherGrab(handedness, true);
      else {
        const ray = getControllerRay(controller);
        const { y: axis, x: turnAxis } = getThumbstickAxes(controller);
        const deflection = (value: number) => Math.abs(value) > SCRUB_DEADZONE
          ? Math.sign(value) * (Math.min(1, Math.abs(value)) - SCRUB_DEADZONE) / (1 - SCRUB_DEADZONE)
          : 0;
        const deltaSeconds = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
        const currentDepth = marcherGrab.rayDistance < 0
          ? marcherGrab.controllerDepthOffset ?? 0
          : marcherGrab.rayDistance;
        // Telescopic: a scene-scaled base speed plus a rate proportional to current reach.
        const depthChange = -deflection(axis) *
          (GRAB_DEPTH_BASE_SPEED * getARScale() + currentDepth * GRAB_DEPTH_TELESCOPE_RATE) * deltaSeconds;
        marcherGrab.controllerYawOffset = (marcherGrab.controllerYawOffset ?? 0) +
          deflection(turnAxis) * Math.PI / 2 * deltaSeconds;
        const facingYaw = handInteraction.getFacingYaw(ray.direction);
        if (marcherGrab.initialFacingYaw === null) marcherGrab.initialFacingYaw = facingYaw;
        if (marcherGrab.rayDistance < 0) {
          marcherGrab.controllerDepthOffset = Math.min(100, Math.max(0,
            (marcherGrab.controllerDepthOffset ?? 0) + depthChange));
        } else {
          marcherGrab.rayDistance = Math.min(100, Math.max(0.1, marcherGrab.rayDistance + depthChange));
        }
        moveMarcherGrab(
          handedness,
          marcherGrab.rayDistance < 0
            ? getControllerPosition(controller).getAbsolutePosition()
              .add(ray.direction.scale(marcherGrab.controllerDepthOffset ?? 0))
            : ray.origin.add(ray.direction.scale(marcherGrab.rayDistance)),
          facingYaw === null ? null : facingYaw + marcherGrab.controllerYawOffset,
        );
      }
      return;
    }

    if (!eraseMode && !isMarcherPainting() && gripPressed && !wasGripPressed &&
      !menuInteractionHeld.get(handedness)) {
      const gripPoint = getControllerPosition(controller).getAbsolutePosition();
      if (handInteraction.transferDraftGrab(handedness, gripPoint, "controller",
        handInteraction.getFacingYaw(getControllerRay(controller).direction))) return;
      if (handInteraction.beginControllerFormationPull(handedness, gripPoint)) return;
      const nearRobot = handInteraction.findMarcherNearHand(gripPoint);
      if (nearRobot) {
        beginMarcherGrab(handedness, nearRobot, gripPoint, "controller", -1,
          handInteraction.getFacingYaw(getControllerRay(controller).direction));
        return;
      }
      const ray = getControllerRay(controller);
      const pick = scene.pickWithRay(ray, (mesh) => findRobotRoot(mesh) !== null);
      const robot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
      if (robot && pick?.pickedPoint) {
        if (handInteraction.beginControllerFormationPull(handedness, gripPoint, robot)) return;
        beginMarcherGrab(
          handedness,
          robot,
          pick.pickedPoint,
          "controller",
          Vector3.Distance(ray.origin, pick.pickedPoint),
          handInteraction.getFacingYaw(ray.direction),
        );
        return;
      }
    }

    if (!isPressed && wasPressed && tempoControllerDrags.delete(handedness)) return;
    if (isPressed && tempoControllerDrags.has(handedness)) {
      const tempoPick = scene.pickWithRay(getControllerRay(controller), isScoreboardTempoScreen);
      if (tempoPick?.hit) updateScoreboardTempoFromPick(tempoPick);
      return;
    }

    if (isPressed && !wasPressed) {
      const ray = getControllerRay(controller);
      const tempoPick = scene.pickWithRay(ray, isScoreboardTempoScreen);
      if (tempoPick?.hit && updateScoreboardTempoFromPick(tempoPick)) {
        tempoControllerDrags.add(handedness);
        return;
      }
      if (tempoPick?.hit && updateScoreboardGaitFromPick(tempoPick)) {
        menuInteractionHeld.set(handedness, true);
        return;
      }
      if (tempoPick?.hit && updateScoreboardHornPoseFromPick(tempoPick)) {
        menuInteractionHeld.set(handedness, true);
        return;
      }

      const menuPick = pickMenuControl(ray);
      const panelPick = pickFloatingPanel(ray);
      const menuHit = menuPick?.hit && (!panelPick?.hit || menuPick.distance <= panelPick.distance + 0.001)
        ? getHandMenuHit(menuPick) : null;
      if (menuHit) {
        menuInteractionHeld.set(handedness, true);
        executeMenuAction(menuHit);
        return;
      }
      menuInteractionHeld.set(handedness, false);

      if (panelPick?.hit && panelPick.pickedMesh) {
        beginFloatingPanelGrab(handedness, getControllerPosition(controller).computeWorldMatrix(true), panelPick.pickedMesh,
          panelPick.pickedPoint ?? undefined);
        padGrabButtons.set(handedness, "trigger");
        return;
      }
      if (isMarcherPainting()) {
        const pick = scene.pickWithRay(ray, mesh => findRobotRoot(mesh) !== null);
        tryPaintMarcher(pick?.hit ? findRobotRoot(pick.pickedMesh) : null);
        menuInteractionHeld.set(handedness, true);
        return;
      }
      const ghostPick = scene.pickWithRay(ray, isGhostBandMesh);
      if (!floorCalibrationToggle?.checked && ghostPick?.hit && ghostPick.pickedMesh &&
        jumpToGhostBandTime(ghostPick.pickedMesh)) {
        menuInteractionHeld.set(handedness, true);
        return;
      }
      if (eraseMode) {
        const pick = scene.pickWithRay(ray, (mesh) => findRobotRoot(mesh) !== null);
        const robot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
        if (robot) eraseMarcher(robot);
        menuInteractionHeld.set(handedness, true);
        return;
      }

      const pick = scene.pickWithRay(getControllerRay(controller));
      if (pick?.hit && pick.pickedMesh && seekToCollisionMarker(pick.pickedMesh)) {
        return;
      }

      const pathOwner = pick?.hit && pick.pickedMesh ? pathLineOwner.get(pick.pickedMesh) : undefined;
      if (pathOwner) {
        selectRobot(pathOwner);
        return;
      }

      const stepOwner = pick?.hit && pick.pickedMesh ? stepHandleOwner.get(pick.pickedMesh) : undefined;
      if (stepOwner) {
        reshapingStepHandle = stepOwner;
        seekToCount(stepOwner.index);
        return;
      }

      const rotationOwner = pick?.hit && pick.pickedMesh
        ? segmentRotationHandleOwner.get(pick.pickedMesh)
        : undefined;
      if (rotationOwner) {
        const point = getFieldPointFromController(controller);
        const handleIndex = pick?.pickedMesh
          ? rotationOwner.rotationHandles.indexOf(pick.pickedMesh as Mesh)
          : -1;
        if (point && handleIndex >= 0) startRotationHandleDrag(handedness, rotationOwner, handleIndex, point);
        return;
      }

      const moveOwner = pick?.hit && pick.pickedMesh ? segmentMoveHandleOwner.get(pick.pickedMesh) : undefined;
      if (moveOwner) {
        movingSegment = moveOwner;
        lastMovePoint = null;
        return;
      }
      const pointOwner = pick?.hit && pick.pickedMesh ? segmentPointHandleOwner.get(pick.pickedMesh) : undefined;
      if (pointOwner) {
        reshapingSegment = pointOwner;
        return;
      }
      const copyOwner = pick?.hit && pick.pickedMesh ? segmentCopyHandleOwner.get(pick.pickedMesh) : undefined;
      if (copyOwner) {
        copyFormationToPathSegment(copyOwner);
        return;
      }

      if (placementMode) {
        const point = getFieldPointFromController(controller);
        if (point) placementDrafts.set(handedness, createStandingMarcher(point));
        return;
      }

      const pickedRobot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
      if (!pickedRobot && selectDrawingGuideFromRay(getControllerRay(controller))) return;

      // A marcher with a route can scrub the shared timeline; a standing
      // marcher is selected without creating a route.
      const pickedRobotCounts = pickedRobot ? getRobotCounts(pickedRobot) : null;
      if (pickedRobot && pickedRobotCounts && pickedRobotCounts.length > 1) {
        scrubbingRobot = pickedRobot;
        selectRobot(pickedRobot);
        return;
      }

      // A miss must not clear the marcher that anchors the active POV camera.
      if (pickedRobot || !isMarcherPOVActive()) selectRobot(pickedRobot);
      return;
    }

    if (isPressed && wasPressed) {
      if (menuInteractionHeld.get(handedness)) return;

      if (scrubbingRobot) {
        const point = getFieldPointFromController(controller);
        const counts = getRobotCounts(scrubbingRobot);
        if (point && counts && counts.length > 0) {
          let nearestIndex = 0;
          let nearestDistanceSq = Infinity;
          counts.forEach((count, index) => {
            const distanceSq = Vector3.DistanceSquared(count.position, point);
            if (distanceSq < nearestDistanceSq) {
              nearestDistanceSq = distanceSq;
              nearestIndex = index;
            }
          });
          seekToCount(nearestIndex);
        }
        return;
      }

      if (reshapingStepHandle) {
        const point = getFieldPointFromController(controller);
        if (point) {
          setRobotCountPosition(reshapingStepHandle.robot, reshapingStepHandle.index, point, scene);
          const handle = stepHandles[reshapingStepHandle.index];
          const count = getRobotCounts(reshapingStepHandle.robot)?.[reshapingStepHandle.index];
          if (handle && count) {
            handle.position.copyFrom(stepHandlePosition(count.position, count.rotationY, reshapingStepHandle.index));
          }
        }
        return;
      }

      if (rotationHandleDrags.has(handedness)) {
        const point = getFieldPointFromController(controller);
        if (point) updateRotationHandleDrag(handedness, point);
        return;
      }

      if (movingSegment) {
        const point = getFieldPointFromController(controller);
        if (point) {
          if (lastMovePoint) {
            const delta = movingSegment.kind === "formation"
              ? constrainFormationMovement(point.subtract(lastMovePoint)) : point.subtract(lastMovePoint);
            if (tryManualMarcherPoses(movingSegment.robots.map((robot) => ({
              robot, position: robot.position.add(delta),
            })))) {
              movingSegment.controlPoints = movingSegment.controlPoints.map((p) => p.add(delta));
              refreshSegmentVisuals(movingSegment);
              if (movingSegment.kind === "formation") {
                acceptedFormationControls.set(movingSegment, movingSegment.controlPoints.map((p) => p.clone()));
              }
            }
          }
          lastMovePoint = point;
        }
        return;
      }

      if (reshapingSegment) {
        const point = getFieldPointFromController(controller);
        if (point) {
          const original = reshapingSegment.segment.controlPoints[reshapingSegment.index];
          reshapingSegment.segment.controlPoints[reshapingSegment.index] = reshapingSegment.segment.kind === "formation"
            ? original.add(constrainFormationMovement(point.subtract(original))) : point;
          rebuildSegmentContent(reshapingSegment.segment);
          refreshSegmentVisuals(reshapingSegment.segment);
        }
        return;
      }

      if (placementMode) {
        const point = getFieldPointFromController(controller);
        if (point) {
          const draft = placementDrafts.get(handedness) ?? createStandingMarcher(point);
          if (tryManualMarcherPose(draft, point, draft.rotation.y, draft.isEnabled())) draft.setEnabled(true);
          placementDrafts.set(handedness, draft);
        }
        return;
      }
    }

    if (!isPressed && wasPressed) {
      if (menuInteractionHeld.get(handedness)) {
        menuInteractionHeld.set(handedness, false);
        return;
      }

      if (scrubbingRobot) {
        scrubbingRobot = null;
        return;
      }

      if (reshapingStepHandle) {
        const robot = reshapingStepHandle.robot;
        const counts = getRobotCounts(robot);
        if (counts) {
          const path = counts.map(count => count.position.clone());
          robotPaths.set(robot, path);
          updateRobotPathLine(robot, path);
        }
        reshapingStepHandle = null;
        return;
      }

      if (rotationHandleDrags.has(handedness)) {
        stopRotationHandleDrag(handedness);
        return;
      }

      if (movingSegment || reshapingSegment) {
        movingSegment = null;
        lastMovePoint = null;
        reshapingSegment = null;
        return;
      }

      if (placementMode) {
        const fieldPoint = getFieldPointFromController(controller);
        const point = fieldPoint && (snapToSelectedDrawingGuide(fieldPoint) ?? fieldPoint);
        const draft = placementDrafts.get(handedness);
        if (point && placeWaitingChartMarcher(point)) {
          draft?.dispose();
          placementDrafts.delete(handedness);
          return;
        }
        if (point) {
          const robot = draft ?? createStandingMarcher(point);
          if (tryManualMarcherPose(robot, point, robot.rotation.y, robot.isEnabled())) {
            robot.setEnabled(true);
            selectRobot(robot);
          } else if (!robot.isEnabled()) {
            robot.dispose();
          }
        } else {
          draft?.dispose();
        }
        placementDrafts.delete(handedness);
        return;
      }
    }
  });
  handInteraction.updateControllerFormationPreview();
}

// Read-only access for other modules (e.g. the palm-up hand menu) that need
// to know which controllers are live without duplicating controller tracking.
export function getActiveControllers(): ReadonlyMap<string, WebXRInputSource> {
  return getRegisteredControllers();
}

// A controller holding a marcher, formation, or panel uses its thumbstick for positioning.
export function isControllerGrabbing(handedness: string): boolean {
  return marcherGrabs.get(handedness)?.source === "controller" ||
    isFloatingPanelGrabbed(handedness) ||
    handInteraction.isControllerFormationPullHand(handedness);
}

export function consumeFloorCalibrationGesture(handedness: string, source: "hand" | "controller") {
  if (source === "hand") handInteraction.consumeFloorCalibrationGesture(handedness);
  else {
    triggerHeld.set(handedness, true);
    menuInteractionHeld.set(handedness, true);
  }
}

export function setHandFloorContact(handedness: string, touching: boolean) {
  handInteraction.setHandFloorContact(handedness, touching);
}

// Progress of the whole band along the shared marching-count clock (0..1),
// for the hand menu/video board progress bar. Null until any path exists.
export function getSelectedRobotProgress(): number | null {
  return getGlobalProgress();
}

// Keeps randomly generated paths comfortably inside the sidelines/goal lines.
const RANDOM_PATH_MARGIN_YARDS = 4;
const RANDOM_PATH_MIN_POINTS = 2;
const RANDOM_PATH_MAX_POINTS = 4;

function randomFieldPoint(): Vector3 {
  const x = (Math.random() * 2 - 1) * (FIELD_WIDTH_YARDS / 2 - RANDOM_PATH_MARGIN_YARDS);
  const z = (Math.random() * 2 - 1) * (FIELD_LENGTH_YARDS / 2 - RANDOM_PATH_MARGIN_YARDS);
  return new Vector3(x, FIELD_SURFACE_Y, z);
}

function generateRandomPath(): Vector3[] {
  const pointCount =
    RANDOM_PATH_MIN_POINTS + Math.floor(Math.random() * (RANDOM_PATH_MAX_POINTS - RANDOM_PATH_MIN_POINTS + 1));
  const points: Vector3[] = [];
  for (let i = 0; i < pointCount; i++) points.push(randomFieldPoint());
  return buildCurvePoints(points);
}

// Spawns a batch of robots on random walking routes.
function spawnRandomRobots(count: number) {
  for (let i = 0; i < count; i++) {
    const points = generateRandomPath();
    if (points.length < 2) continue;
    const robotPrimitives = createLowPolyRobot(scene);
    robotPrimitives.parent = pathRoot;
    robotPaths.set(robotPrimitives, points);
    updateRobotPathLine(robotPrimitives, points);
    walkRobotAlongPath(robotPrimitives, points, scene, MARCH_STEP_YARDS);
  }
}

// Clears every currently spawned robot and everything tracking it (path
// lines, segments/handles, formation connections) so a fresh drill starts on
// an empty field instead of piling onto whatever was already there.
function clearAllRobots() {
  if (duplicateDrillStatus) duplicateDrillStatus.value = '';
  selectionTools?.clear();
  eraseHistory.clear();
  finishFingerPath(false);
  placementDrafts.forEach((robot) => robot.dispose());
  placementDrafts.clear();
  [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, false));
  robotPathLines.forEach((line) => {
    pathLineOwner.delete(line);
    line.dispose(false, true);
  });
  robotPathLines.clear();
  robotPaths.clear();

  segments.forEach((segment) => {
    pathLineOwner.delete(segment.line);
    segment.line.dispose(false, true);
    segment.moveHandle.dispose();
    segment.pointHandles.forEach((handle) => handle.dispose());
    segment.rotationHandles.forEach((handle) => handle.dispose());
    segment.copyHandle?.dispose();
  });
  segments.length = 0;
  segmentPointHandleOwner.clear();
  segmentMoveHandleOwner.clear();
  segmentRotationHandleOwner.clear();
  segmentCopyHandleOwner.clear();
  pathSegmentByRobot.clear();
  rotatingSegment = null;
  rotationHandleDrags.clear();
  twoHandPathManipulation = null;

  formationConnectionsBySegment.forEach((connections) =>
    connections.forEach((connection) => connection.mesh.dispose(false, true))
  );
  formationConnectionsBySegment.clear();

  clearStepHandles();
  selectedRobot = null;

  clearDrillLabels();
  clearShowInfo();
  disposeAllRobots();
  refreshFormationEditor();
}

// True when the viewer is looking at the +Z half of the field: where their
// gaze meets the field surface, or the way they face if looking above it.
function isLookingAtPositiveFieldHalf(): boolean {
  const camera = scene.activeCamera;
  if (!camera) return false;
  const toField = pathRoot.computeWorldMatrix(true).clone().invert();
  const origin = Vector3.TransformCoordinates(camera.globalPosition, toField);
  const direction = Vector3.TransformNormal(camera.getDirection(Vector3.Forward()), toField);
  const distance = Math.abs(direction.y) > 1e-6 ? (FIELD_SURFACE_Y - origin.y) / direction.y : -1;
  const lookZ = distance > 0 ? origin.z + direction.z * distance : direction.z;
  return lookZ > 0;
}

export function duplicateDrillForPerformance(): number {
  const sources = Array.from(robotPaths.keys()).filter(robot =>
    !robot.isDisposed() && robot.isEnabled() && (getRobotCounts(robot)?.length ?? 0) > 1);
  if (sources.length === 0) {
    if (duplicateDrillStatus) duplicateDrillStatus.value = 'Load or generate a drill before duplicating.';
    return 0;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (const robot of sources) {
    for (const count of getRobotCounts(robot)!) {
      minX = Math.min(minX, count.position.x);
      maxX = Math.max(maxX, count.position.x);
    }
  }
  const offset = new Vector3(maxX - minX + 8, 0, 0);
  for (const source of sources) {
    const robot = duplicateMarcherSchedule(source, offset);
    const path = getRobotCounts(robot)!.map(count => count.position.clone());
    robotPaths.set(robot, path);
    updateRobotPathLine(robot, path);
  }
  refreshCollisionMarkers(scene);
  if (duplicateDrillStatus) {
    duplicateDrillStatus.value = `${sources.length} marchers duplicated; ${sources.length * 2} total. ` +
      `Copy offset ${offset.x.toFixed(1)} yards to the right. Both groups share the playback clock.`;
  }
  return sources.length;
}

function spawnMarchingDrill() {
  clearAllRobots();
  forgetOtherChartPageGuides();
  const paths = generateMarchingDrillPaths(isLookingAtPositiveFieldHalf());
  const pickerInstrument = getSelectedInstrument();
  paths.forEach((path, index) => {
    setSelectedInstrument(getDrillSectionInstrument(index));
    const robotPrimitives = createLowPolyRobot(scene);
    robotPrimitives.parent = pathRoot;
    robotPaths.set(robotPrimitives, path);
    updateRobotPathLine(robotPrimitives, path);
    walkRobotAlongCounts(robotPrimitives, path, scene);
  });
  setSelectedInstrument(pickerInstrument);

  refreshCollisionMarkers(scene);
  const last = Math.max(0, ...paths.map(path => path.length - 1));
  const counts = Array.from({ length: Math.floor(last / 8) + 1 }, (_, index) => index * 8);
  if (counts[counts.length - 1] !== last) counts.push(last);
  selectionTools?.setPages(counts.map((count, index) => ({ name: `Set ${index + 1}`, count })));
}

// Replaces the field with an OpenMarch show, each marcher holding the
// instrument for its section and playing from the opening set.
function spawnOpenMarchDrill(drill: OpenMarchImportedDrill, showName: string, autoPlay = true): number {
  clearAllRobots();
  forgetOtherChartPageGuides();
  const pickerInstrument = getSelectedInstrument();
  const instruments: MarcherInstrument[] = [];
  const labels: { robot: TransformNode; label: string }[] = [];
  drill.tracks.forEach((track, index) => {
    const marcher = drill.marchers[index];
    const instrument = getOpenMarchSectionInstrument(marcher?.section ?? "", pickerInstrument);
    instruments.push(instrument);
    setSelectedInstrument(instrument);
    const path = track.map((point) => new Vector3(point.x, FIELD_SURFACE_Y, point.z));
    const robotPrimitives = createLowPolyRobot(scene);
    robotPrimitives.parent = pathRoot;
    robotPaths.set(robotPrimitives, path);
    updateRobotPathLine(robotPrimitives, path);
    walkRobotAlongCounts(robotPrimitives, path, scene);
    labels.push({ robot: robotPrimitives, label: marcher?.label ?? "" });
  });
  setSelectedInstrument(pickerInstrument);
  const tempoBpm = setMarchTempo(drill.tempoBpm);
  seekToCount(0);
  if (autoPlay) playAll();

  refreshCollisionMarkers(scene);
  setDrillLabels(scene, pathRoot, labels);
  setShowInfo(showName, drill, instruments, tempoBpm);
  selectionTools?.setPages(drill.pages);
  return tempoBpm;
}

// The show's name: OpenMarch files carry no title, so the file name is used.
function getOpenMarchShowName(url: string): string {
  if (url.trim().toLowerCase() === OPEN_MARCH_EXAMPLE) return "Example show";
  try {
    const file = decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() ?? "");
    return file.replace(/\.dots$/i, "") || "OpenMarch show";
  } catch {
    return "OpenMarch show";
  }
}

let openMarchRequest = 0;

async function openMarchFromUrl(url: string, autoPlay = true): Promise<boolean> {
  const request = ++openMarchRequest;
  const setStatus = (message: string, error = false) => {
    if (!openMarchStatus) return;
    openMarchStatus.value = message;
    openMarchStatus.classList.toggle("error", error);
  };
  setStatus("Opening…");
  const buttons = [openMarchButton, openMarchExampleButton];
  buttons.forEach((button) => { if (button) button.disabled = true; });
  try {
    const drill = await loadOpenMarchFromUrl(url);
    if (request !== openMarchRequest) return false;
    const tempoBpm = Math.round(spawnOpenMarchDrill(drill, getOpenMarchShowName(url), autoPlay));
    const showTempoBpm = Math.round(drill.tempoBpm);
    const lastCount = drill.tracks[0].length - 1;
    const opened = url.trim().toLowerCase() === OPEN_MARCH_EXAMPLE ? "Opened the example show:" : "Opened";
    setStatus(`${opened} ${drill.tracks.length} marchers, ${drill.pages.length} pages, ${lastCount} counts at ${tempoBpm} BPM` +
      (tempoBpm === showTempoBpm ? "." : ` (the show is ${showTempoBpm} BPM).`));
    return true;
  } catch (error) {
    if (request === openMarchRequest) setStatus(error instanceof Error ? error.message : String(error), true);
    console.warn("Could not open OpenMarch show", error);
    return false;
  } finally {
    buttons.forEach((button) => { if (button) button.disabled = false; });
  }
}

export function initInteraction() {
  initFieldImageProjector(pathRoot, showPlacementNotice);
  initMarcherPaint({
    getSelected: () => selectedRobot,
    prepare: () => {
      setPlacementMode(false);
      setEraseMode(false);
      selectionTools?.disable();
      executeDrawingToolAction({ action: 'drawingTool', tool: 'stop' });
      handInteraction.prepareForErase();
      movingSegment = null; reshapingSegment = null; rotatingSegment = null;
      rotationHandleDrags.clear(); twoHandPathManipulation = null;
      reshapingStepHandle = null; scrubbingRobot = null;
    },
    changed: robot => {
      refreshPathLineAppearance();
      if (selectedRobot === robot) refreshStepHandles();
    },
    notify: showPlacementNotice,
  });
  initFieldDrawingTools({
    root: pathRoot,
    notify: showPlacementNotice,
    prepare: () => {
      stopMarcherPainting();
      setPlacementMode(false);
      setEraseMode(false);
      selectionTools?.disable();
    },
    createFormation: points => {
      const anchor = createStandingMarcher(points[0]);
      if (!anchor.isEnabled()) {
        anchor.dispose();
        showPlacementNotice("Formation origin is occupied. Draw a guide in an empty area.");
        return false;
      }
      const previous = new Set(segments);
      createSegment("formation", points, [], anchor, false, true);
      const created = segments.find(segment => !previous.has(segment));
      if (!created || created.robots.length === 0) {
        if (created) removeEditorForm(created);
        if (!anchor.isDisposed()) anchor.dispose();
        selectRobot(null);
        showPlacementNotice("Formation does not fit without collisions. Increase spacing or draw elsewhere.");
        return false;
      }
      refreshCollisionMarkers(scene);
      selectRobot(created.robots[0], true);
      return true;
    },
    createPath: points => {
      const robot = createStandingMarcher(points[0]);
      if (!robot.isEnabled()) {
        robot.dispose();
        showPlacementNotice("Path origin is occupied. Draw a guide in an empty area.");
        return false;
      }
      createSegment("path", points, [robot], undefined, false, true);
      selectRobot(robot, true);
      refreshCollisionMarkers(scene);
      return true;
    },
    createSynchronizedRoutes: createSynchronizedRoutesFromGuide,
  });
  initChartPageGuides(getDrillChartPageIndex);
  selectionTools = createSelectionEditor({
    root: pathRoot,
    getMarchers: () => scene.transformNodes.filter(node => node.name === "pathRobot" && node.parent === pathRoot),
    getStandingForm: () => getEditorFormation()?.robots ?? [],
    detachStandingMembers: detachStandingSelection,
    changed: refreshSelectionEdits,
    prepare: () => {
      stopMarcherPainting();
      setEraseMode(false);
      if (placementModeToggle?.checked) {
        placementModeToggle.checked = false;
        placementModeToggle.dispatchEvent(new Event("change"));
      }
      handInteraction.prepareForErase();
    },
    notify: showPlacementNotice,
    snap: snapToStepGrid,
    snapAngle,
    constrain: constrainFormationMovement,
  });
  setEraseMode(!!eraseModeToggle?.checked);
  undoEraseButton?.addEventListener("click", () => executeMenuAction({ action: "undoErase" }));
  redoEraseButton?.addEventListener("click", () => executeMenuAction({ action: "redoErase" }));
  window.addEventListener("keydown", (event) => {
    bypassDrillSnap = event.shiftKey;
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable || target.closest("input, textarea, select")
    )) return;
    if (event.key === "1" && !selectionTools?.enabled() && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (floorCalibrationToggle?.checked) {
        publishFormationEdit("Finish floor calibration before editing forms.");
        return;
      }
      event.preventDefault();
      alignEditorFormation("round");
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    executeMenuAction({ action: key === "y" || event.shiftKey ? "redoErase" : "undoErase" });
  });
  window.addEventListener("keyup", event => { bypassDrillSnap = event.shiftKey; });
  window.addEventListener("blur", () => { bypassDrillSnap = false; });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) bypassDrillSnap = false;
  });
  const getMarcherCount = () => Math.max(1, Math.min(100, Math.round(Number(marcherCountInput?.value) || 8)));
  const updateMarcherCountValue = () => {
    if (marcherCountValue) marcherCountValue.value = String(getMarcherCount());
  };
  marcherCountInput?.addEventListener("input", updateMarcherCountValue);
  updateMarcherCountValue();
  addRandomRobotsButton?.addEventListener("click", () => spawnRandomRobots(getMarcherCount()));
  generateDrillButton?.addEventListener("click", () => {
    openMarchRequest++;
    spawnMarchingDrill();
  });
  duplicateDrillButton?.addEventListener("click", duplicateDrillForPerformance);
  collisionMarkersToggle?.addEventListener("change", () => {
    setCollisionMarkersVisible(!!collisionMarkersToggle?.checked);
  });
  setCollisionMarkersVisible(collisionMarkersToggle?.checked ?? true);
  drillLabelsToggle?.addEventListener("change", () => setDrillLabelsVisible(!!drillLabelsToggle?.checked));
  setDrillLabelsVisible(drillLabelsToggle?.checked ?? false);
  openMarchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = openMarchUrlInput?.value.trim();
    if (url) void openMarchFromUrl(url);
  });
  openMarchExampleButton?.addEventListener("click", () => void openMarchFromUrl(OPEN_MARCH_EXAMPLE));
  // Open on the bundled example show, already marching, rather than an empty
  // field; `?openmarch=<url>` opens that show instead. If the show cannot be
  // opened (and nothing else replaced it meanwhile), a generated drill is used.
  const sharedShowUrl = new URLSearchParams(window.location.search).get(OPEN_MARCH_URL_PARAM)?.trim();
  const startupShow = sharedShowUrl || OPEN_MARCH_EXAMPLE;
  if (openMarchUrlInput && startupShow.toLowerCase() !== OPEN_MARCH_EXAMPLE) openMarchUrlInput.value = startupShow;
  const startupLoad = openMarchFromUrl(startupShow, false);
  const startupRequest = openMarchRequest;
  void startupLoad.then((opened) => {
    if (!opened && openMarchRequest === startupRequest) spawnMarchingDrill();
  });

  // Desktop/browser testing has no VR trigger, so a plain mouse click is
  // wired to the same collision-marker preview and robot selection the VR
  // trigger dispatches to.
  scene.onPointerObservable.add((pointerInfo, eventState) => {
    if ("pointerType" in pointerInfo.event && pointerInfo.event.pointerType === "xr") return;
    // Dragging or wheeling over a floating panel moves it; skipping later
    // observers keeps the camera's mouse-look and wheel input from also firing.
    const getPointerRay = () => scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
    if (isFloatingPanelGrabbed("pointer")) {
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) updateFloatingPanelPointerDrag(getPointerRay());
      if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        endFloatingPanelGrab("pointer");
        canvas.style.cursor = "grab";
      }
      eventState.skipNextObservers = true;
      return;
    }
    const drawingType = pointerInfo.type === PointerEventTypes.POINTERDOWN ? "down" :
      pointerInfo.type === PointerEventTypes.POINTERMOVE ? "move" :
      pointerInfo.type === PointerEventTypes.POINTERUP ? "up" : null;
    if (drawingType && (!("button" in pointerInfo.event) || pointerInfo.event.button <= 0) &&
      (isDrawingPointerActive() || !pickFloatingPanel(getPointerRay())?.hit) &&
      handleDrawingPointer(drawingType, getFieldPointFromRay(getPointerRay()))) {
      eventState.skipNextObservers = true;
      return;
    }
    if (pointerInfo.type === PointerEventTypes.POINTERWHEEL && pointerInfo.event instanceof WheelEvent &&
      nudgeFloatingPanelDistance(getPointerRay(), pointerInfo.event.deltaY)) {
      pointerInfo.event.preventDefault();
      eventState.skipNextObservers = true;
      return;
    }
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN && "button" in pointerInfo.event &&
      pointerInfo.event.button === 0) {
      const menuPick = scene.pick(scene.pointerX, scene.pointerY, isMenuControl);
      const panelPick = pickFloatingPanel(getPointerRay());
      const buttonInFront = menuPick?.hit && (!panelPick?.hit || menuPick.distance <= panelPick.distance + 0.001);
      if (!buttonInFront && beginFloatingPanelPointerDrag(getPointerRay())) {
        canvas.style.cursor = "grabbing";
        eventState.skipNextObservers = true;
        return;
      }
    }
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (isMarcherPainting()) eventState.skipNextObservers = true;
      const tempoPick = scene.pick(scene.pointerX, scene.pointerY, isScoreboardTempoScreen);
      tempoPointerDragging = !!tempoPick?.hit && updateScoreboardTempoFromPick(tempoPick);
      if (tempoPointerDragging) return;
    }
    if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      tempoPointerDragging = false;
      return;
    }
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      if (tempoPointerDragging) {
        const tempoPick = scene.pick(scene.pointerX, scene.pointerY, isScoreboardTempoScreen);
        if (tempoPick?.hit) updateScoreboardTempoFromPick(tempoPick);
        return;
      }
      const pick = scene.pick(
        scene.pointerX,
        scene.pointerY,
        (mesh) => isMenuControl(mesh) || isScoreboardTempoScreen(mesh) || isFloatingPanelMesh(mesh)
      );
      canvas.style.cursor = eraseMode || isMarcherPainting() ? "crosshair" : pick?.hit && (
        getHandMenuHit(pick) || isScoreboardTempoPick(pick) || isScoreboardGaitPick(pick) ||
        isScoreboardHornPosePick(pick)
      ) ? "pointer" : pick?.pickedMesh && isFloatingPanelMesh(pick.pickedMesh) ? "grab" : "";
      return;
    }
    if (pointerInfo.type === PointerEventTypes.POINTERDOUBLETAP && !isMarcherPainting()) {
      const pick = pointerInfo.pickInfo;
      if (pick?.pickedMesh?.name.startsWith("musicStandButton-")) {
        const hit = getHandMenuHit(pick);
        if (hit) executeMenuAction(hit);
      }
      return;
    }
    if (pointerInfo.type !== PointerEventTypes.POINTERTAP &&
      pointerInfo.type !== PointerEventTypes.POINTERDOUBLETAP) return;
    const tempoPick = scene.pick(scene.pointerX, scene.pointerY, isScoreboardTempoScreen);
    if (tempoPick?.hit && updateScoreboardTempoFromPick(tempoPick)) return;
    if (tempoPick?.hit && updateScoreboardGaitFromPick(tempoPick)) return;
    if (tempoPick?.hit && updateScoreboardHornPoseFromPick(tempoPick)) return;
    const menuPick = scene.pick(scene.pointerX, scene.pointerY, isMenuControl);
    const menuHit = menuPick?.hit ? getHandMenuHit(menuPick) : null;
    if (menuHit) {
      executeMenuAction(menuHit);
      return;
    }
    if (pickFloatingPanel(getPointerRay())?.hit) return;
    if (isMarcherPainting()) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, mesh => findRobotRoot(mesh) !== null);
      tryPaintMarcher(pick?.hit ? findRobotRoot(pick.pickedMesh) : null);
      return;
    }
    const ghostPick = scene.pickWithRay(getPointerRay(), isGhostBandMesh);
    if (!floorCalibrationToggle?.checked && ghostPick?.hit && ghostPick.pickedMesh &&
      jumpToGhostBandTime(ghostPick.pickedMesh)) return;
    if (isFieldDrawingToolActive()) return;
    if (eraseMode) {
      if (floorCalibrationToggle?.checked) return;
      const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => findRobotRoot(mesh) !== null);
      const robot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
      if (robot) eraseMarcher(robot);
      return;
    }
    if (placementMode && !floorCalibrationToggle?.checked) {
      const fieldPoint = getFieldPointFromRay(getPointerRay());
      const point = fieldPoint && (snapToSelectedDrawingGuide(fieldPoint) ?? fieldPoint);
      if (point && placeWaitingChartMarcher(point)) return;
      if (point) {
        const robot = createStandingMarcher(point);
        if (robot.isEnabled()) selectRobot(robot);
        else robot.dispose();
      }
      return;
    }
    const pickedMesh = pointerInfo.pickInfo?.pickedMesh;
    if (!pickedMesh) return;
    if (seekToCollisionMarker(pickedMesh)) return;
    const stepOwner = stepHandleOwner.get(pickedMesh);
    if (stepOwner) {
      seekToCount(stepOwner.index);
      return;
    }
    const pathOwner = pathLineOwner.get(pickedMesh);
    if (pathOwner) {
      selectRobot(pathOwner);
      return;
    }
    const robot = findRobotRoot(pickedMesh);
    if (robot) {
      selectRobot(robot);
      if (!isMarcherPOVActive()) setMarcherPOVEnabled(true);
      return;
    }
    if (selectDrawingGuideFromRay(getPointerRay())) return;
    let fieldNode: import('@babylonjs/core/node').Node | null = pickedMesh;
    while (fieldNode) {
      if (/^(field|fieldLines|hashMarks|leftEndZone|rightEndZone)$/.test(fieldNode.name) ||
        fieldNode.name.startsWith("turfStripe")) {
        pathsHiddenByFieldClick = true;
        showAllPaths = false;
        if (showAllPathsToggle) showAllPathsToggle.checked = false;
        refreshPathLineAppearance();
        clearStepHandles();
        segments.forEach(updateSegmentHandleVisibility);
        return;
      }
      fieldNode = fieldNode.parent;
    }
  });
}
