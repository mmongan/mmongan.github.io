import * as BABYLON from 'babylonjs';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
  attachToARTransform,
  getTabletopCorner,
  setTabletopCornerHandlesVisible,
  isARTabletopModeActive,
} from '../xr/ar';
import { scene } from '../scene/engine';
import {
  activeControllers as controllerRegistry,
  getActiveControllers as getRegisteredControllers,
  removeActiveController as unregisterActiveController,
  setActiveController as registerActiveController,
  updateARResizeFromControllers as resizeFromControllers,
} from './controllers';
import {
  createLowPolyRobot,
  walkRobotAlongPath,
  findRobotRoot,
  registerRobotPath,
  toggleAllPlayback,
  rewindAll,
  fastForwardAll,
  stepAll,
  seekAll,
  seekToCount,
  scrubBy,
  getRobotColor,
  setCollisionMarkerParent,
  seekToCollisionMarker,
  getGlobalProgress,
  getRobotCounts,
  setRobotCountPosition,
  setRobotHeld,
  placeRobot,
  refreshCollisionMarkers,
  COLLISION_MARKER_RADIUS_YARDS,
  resetRobotSchedule,
  disposeAllRobots,
  walkRobotAlongCounts,
  RANDOM_MARCHING_GAIT_INDICES,
  setMarcherInstrumentRestPose,
} from '../robot/robot';
import { getHandMenuHit, isHandMenuVisible, isMenuControl } from '../menu/handMenu';
import { createHandInteraction } from './handInteraction';
import {
  isScoreboardGaitPick,
  isScoreboardHornPosePick,
  isScoreboardTempoPick,
  isScoreboardTempoScreen,
  updateScoreboardGaitFromPick,
  updateScoreboardHornPoseFromPick,
  updateScoreboardTempoFromPick,
} from '../field/scoreboard';
import { canvas, floorCalibrationToggle, fullScaleVRButton, tabletopScaleButton, showAllPathsToggle, placementModeToggle, addRandomRobotsButton, add100RobotsButton, generateDrillButton } from '../ui/dom';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS, FIELD_SURFACE_Y } from '../field/constants';
import { FORMATION_SPACING_YARDS, generateMarchingDrillPaths, MARCH_STEP_YARDS } from '../robot/drill';

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
  localAnchor: new BABYLON.Vector3(),
  startYaw: 0,
  startRotation: 0,
};

function resetPinchState() {
  pinchState.active = false;
  pinchState.startDistance = 0;
  pinchState.startScale = 1;
  pinchState.scaleExponent = SCALE_EXPONENT_AT_MIN;
  pinchState.localAnchor = new BABYLON.Vector3();
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

function rotateAroundY(vector: BABYLON.Vector3, angle: number): BABYLON.Vector3 {
  return BABYLON.Vector3.TransformCoordinates(vector, BABYLON.Matrix.RotationY(angle));
}

function isGripPressed(controller: BABYLON.WebXRInputSource): boolean {
  const motionController = controller.motionController;
  if (!motionController) {
    return false;
  }

  // Squeeze only — the trigger is reserved for drawing the robot's path.
  const squeeze = motionController.getComponentOfType('squeeze');
  if (squeeze?.pressed) return true;

  return !!controller.inputSource.gamepad?.buttons?.[1]?.pressed;
}

function getControllerPosition(controller: BABYLON.WebXRInputSource) {
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

function getControllerYaw(leftPosition: BABYLON.Vector3, rightPosition: BABYLON.Vector3) {
  const dx = rightPosition.x - leftPosition.x;
  const dz = rightPosition.z - leftPosition.z;
  return Math.atan2(dx, dz);
}

export function setActiveController(controller: BABYLON.WebXRInputSource) {
  registerActiveController(controller);
}

export function removeActiveController(controller: BABYLON.WebXRInputSource) {
  unregisterActiveController(controller, (handedness) => {
    finishMarcherGrab(handedness, false);
    placementDrafts.get(handedness)?.dispose();
    placementDrafts.delete(handedness);
    cornerDrags.delete(handedness);
    triggerHeld.delete(handedness);
  });
}

export function updateARResizeFromControllers() {
  resizeFromControllers(cornerDrags.size > 0);
}

// The path/robot live under the shared AR transform so they scale, move, and
// rotate together with the field instead of staying world-scale.
const pathRoot = new BABYLON.TransformNode("robotPathRoot", scene);
attachToARTransform(pathRoot);
setCollisionMarkerParent(pathRoot);

const ROBOT_PATHS_STORAGE_KEY = "chartxr.robotPaths";
const MAX_STORED_PATHS = 20;
// Selecting a robot reveals every other robot's path too (so their routes
// stay visible for context), but at reduced alpha so the selected one stands out.
const PATH_SELECTED_ALPHA = 1;
const PATH_UNSELECTED_ALPHA = 0.25;

type StoredPoint = [number, number, number];

function loadStoredPaths(): BABYLON.Vector3[][] {
  // try {
  //   const raw = localStorage.getItem(ROBOT_PATHS_STORAGE_KEY);
  //   if (!raw) return [];
  //   const parsed = JSON.parse(raw) as StoredPoint[][];
  //   return parsed.map((path) => path.map(([x, y, z]) => new BABYLON.Vector3(x, y, z)));
  // } catch {
  //   return [];
  // }
  return [];
}

function saveStoredPaths(paths: BABYLON.Vector3[][]) {
  // try {
  //   const serialized: StoredPoint[][] = paths
  //     .slice(-MAX_STORED_PATHS)
  //     .map((path) => path.map((point): StoredPoint => [point.x, point.y, point.z]));
  //   localStorage.setItem(ROBOT_PATHS_STORAGE_KEY, JSON.stringify(serialized));
  // } catch {
  //   // Storage can be unavailable (private browsing, quota, etc.) — drawing still works, it just won't persist.
  // }
}

const storedPaths: BABYLON.Vector3[][] = loadStoredPaths();


// Full path history and persistent path line per robot (a robot's line covers
// its whole route so far, including any extensions, not just the last segment).
const robotPaths = new Map<BABYLON.TransformNode, BABYLON.Vector3[]>();
const robotPathLines = new Map<BABYLON.TransformNode, BABYLON.Mesh>();
// Reverse lookup so clicking/triggering a drawn path line selects its robot.
const pathLineOwner = new Map<BABYLON.AbstractMesh, BABYLON.TransformNode>();
let selectedRobot: BABYLON.TransformNode | null = null;
let showAllPaths = !!showAllPathsToggle?.checked;

// Paths/segments are drawn as tubes connecting the grab-point balls instead
// of thin CreateLines meshes, so drawn routes are actually visible in VR.
const PATH_TUBE_RADIUS_YARDS = 0.05;
const PATH_TUBE_TESSELLATION = 8;

function createTubeLine(name: string, points: BABYLON.Vector3[], color: BABYLON.Color3, existingMaterial?: BABYLON.StandardMaterial): BABYLON.Mesh {
  const tube = BABYLON.MeshBuilder.CreateTube(
    name,
    { path: points, radius: PATH_TUBE_RADIUS_YARDS, tessellation: PATH_TUBE_TESSELLATION },
    scene
  );
  const material = existingMaterial ?? new BABYLON.StandardMaterial(`${name}Material`, scene);
  if (!existingMaterial) {
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.5);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
  }
  tube.material = material;
  tube.parent = pathRoot;
  return tube;
}

function setTubeLineAppearance(tube: BABYLON.Mesh, color: BABYLON.Color3, alpha: number) {
  const material = tube.material as BABYLON.StandardMaterial;
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.5);
  material.alpha = alpha;
}

// Selected robot's path is always shown fully opaque; every other robot's
// path becomes visible-but-transparent once anything is selected, so the
// selected route stands out without hiding the rest of the drill for context.
function refreshPathLineAppearance() {
  robotPathLines.forEach((line, robot) => {
    const isSelected = robot === selectedRobot;
    const color = getRobotColor(robot);
    setTubeLineAppearance(line, color, isSelected ? PATH_SELECTED_ALPHA : PATH_UNSELECTED_ALPHA);
    line.setEnabled(showAllPaths || isSelected || selectedRobot !== null);
  });
}

function selectRobot(robot: BABYLON.TransformNode | null) {
  selectedRobot = robot;
  refreshPathLineAppearance();
  refreshStepHandles();
  segments.forEach(updateSegmentHandleVisibility);
}

// One small grab handle per precalculated marching step (count) of the
// currently selected robot, so individual footsteps can be nudged directly
// instead of only reshaping the original drawn curve. Handles alternate to
// the left/right edge of the path tube to indicate which foot each step is.
const STEP_HANDLE_SIZE = 0.18;
const STEP_HANDLE_SIDE_OFFSET = PATH_TUBE_RADIUS_YARDS + STEP_HANDLE_SIZE / 2;
let stepHandles: BABYLON.Mesh[] = [];
const stepHandleOwner = new Map<BABYLON.AbstractMesh, { robot: BABYLON.TransformNode; index: number }>();

// Offsets a step's center-line position sideways onto the tube's edge,
// alternating side by step index (even = right foot, odd = left foot).
function stepHandlePosition(position: BABYLON.Vector3, rotationY: number, index: number): BABYLON.Vector3 {
  const side = index % 2 === 0 ? 1 : -1;
  const right = new BABYLON.Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
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
  if (!selectedRobot) return;
  const counts = getRobotCounts(selectedRobot);
  if (!counts) return;

  const material = scene.getMaterialByName("stepHandleMaterial") as BABYLON.StandardMaterial | null
    ?? new BABYLON.StandardMaterial("stepHandleMaterial", scene);
  const color = getRobotColor(selectedRobot);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.6);
  material.specularColor = new BABYLON.Color3(0, 0, 0);

  counts.forEach((count, index) => {
    const handle = BABYLON.MeshBuilder.CreateSphere("stepHandle", { diameter: STEP_HANDLE_SIZE, segments: 8 }, scene);
    handle.material = material;
    handle.parent = pathRoot;
    handle.position.copyFrom(stepHandlePosition(count.position, count.rotationY, index));
    stepHandles.push(handle);
    stepHandleOwner.set(handle, { robot: selectedRobot!, index });
  });
}

showAllPathsToggle?.addEventListener("change", () => {
  showAllPaths = !!showAllPathsToggle?.checked;
  refreshPathLineAppearance();
});

function toggleShowAllPaths() {
  showAllPaths = !showAllPaths;
  if (showAllPathsToggle) showAllPathsToggle.checked = showAllPaths;
  refreshPathLineAppearance();
}

const xButtonHeld = new Map<string, boolean>();

// The left controller's X button toggles showing every path, mirroring the checkbox.
function updateShowAllPathsToggleFromControllers() {
  controllerRegistry.forEach((controller, handedness) => {
    const xButton = controller.motionController?.getComponent('x-button');
    const isPressed = !!xButton?.pressed;
    const wasPressed = xButtonHeld.get(handedness) ?? false;
    xButtonHeld.set(handedness, isPressed);

    if (isPressed && !wasPressed) {
      toggleShowAllPaths();
    }
  });
}

// In placement mode, each trigger press drops a new standing robot (no path,
// no walking) at the aimed point instead of drawing/extending a route —
// for laying out a formation one member at a time.
let placementMode = !!placementModeToggle?.checked;
const placementDrafts = new Map<string, BABYLON.TransformNode>();

function createStandingMarcher(position: BABYLON.Vector3) {
  const robot = createLowPolyRobot(scene);
  robot.parent = pathRoot;
  robot.position.copyFrom(position);
  robot.setEnabled(true);
  return robot;
}

placementModeToggle?.addEventListener("change", () => {
  setPlacementMode(!!placementModeToggle?.checked);
});

function setPlacementMode(enabled: boolean) {
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

function togglePlacementMode() {
  setPlacementMode(!placementMode);
}

const yButtonHeld = new Map<string, boolean>();

// The left controller's Y button toggles placement mode, mirroring the checkbox.
function updatePlacementModeToggleFromControllers() {
  controllerRegistry.forEach((controller, handedness) => {
    const yButton = controller.motionController?.getComponent('y-button');
    const isPressed = !!yButton?.pressed;
    const wasPressed = yButtonHeld.get(handedness) ?? false;
    yButtonHeld.set(handedness, isPressed);

    if (isPressed && !wasPressed) {
      
      togglePlacementMode();
    }
  });
}

// Deflecting either controller's thumbstick left/right scrubs the shared
// timeline continuously — a small deadzone avoids drift from stick noise,
// and the scrub rate is proportional to how far the stick is pushed.
const SCRUB_DEADZONE = 0.2;
const SCRUB_COUNTS_PER_SECOND = 16;
let scrubRemainder = 0;

function updateScrubFromControllers(deltaSeconds: number) {
  if (!isHandMenuVisible()) {
    scrubRemainder = 0;
    return;
  }

  let axisValue = 0;
  controllerRegistry.forEach((controller) => {
    const thumbstick = controller.motionController?.getComponentOfType("thumbstick");
    const x = thumbstick?.axes.x ?? 0;
    if (Math.abs(x) > Math.abs(axisValue)) axisValue = x;
  });

  if (Math.abs(axisValue) <= SCRUB_DEADZONE) {
    scrubRemainder = 0;
    return;
  }

  const activeDeflection = (Math.abs(axisValue) - SCRUB_DEADZONE) / (1 - SCRUB_DEADZONE);
  const scrubDirection = Math.sign(axisValue);
  scrubRemainder += scrubDirection * activeDeflection * SCRUB_COUNTS_PER_SECOND * deltaSeconds;
  const wholeCounts = Math.trunc(scrubRemainder);
  if (wholeCounts !== 0) {
    scrubBy(wholeCounts);
    scrubRemainder -= wholeCounts;
  }
}

function updateRobotPathLine(robot: BABYLON.TransformNode, points: BABYLON.Vector3[]) {
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

function snapToStepGrid(point: BABYLON.Vector3): BABYLON.Vector3 {
  return point;
  // return new BABYLON.Vector3(
  //   Math.round(point.x / MARCH_STEP_YARDS) * MARCH_STEP_YARDS,
  //   point.y,
  //   Math.round(point.z / MARCH_STEP_YARDS) * MARCH_STEP_YARDS
  // );
}

function snapAngle(angle: number): number {
  return angle;
  //return Math.round(angle / ANGLE_SNAP_RADIANS) * ANGLE_SNAP_RADIANS;
}

function resampleLineEvenly(points: BABYLON.Vector3[], spacingYards: number): BABYLON.Vector3[] {
  const segmentLengths = points.slice(1).map((point, i) => BABYLON.Vector3.Distance(points[i], point));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= 0.001) return [points[0].clone()];

  const count = Math.max(1, Math.round(totalLength / spacingYards));
  const resampled: BABYLON.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
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
    resampled.push(BABYLON.Vector3.Lerp(segmentStart, segmentEnd, t));
  }
  return resampled;
}

// Two independently-maintained kinds of drawn/dragged curve:
// - "formation": a line of standing robots spaced along it.
// - "path": the curve a single robot follows when marching.
// Both are recorded as a Segment with the same move/reshape handles; only how
// their content is (re)built from the curve differs (see rebuildSegmentContent).
type SegmentKind = "formation" | "path";

interface Segment {
  kind: SegmentKind;
  controlPoints: BABYLON.Vector3[];
  line: BABYLON.Mesh;
  moveHandle: BABYLON.Mesh;
  pointHandles: BABYLON.Mesh[];
  // Formation-only: tap to copy this formation's curve into a path segment
  // so a robot marches single file through the same positions.
  copyHandle: BABYLON.Mesh | null;
  robots: BABYLON.TransformNode[]; // formation: every robot in the rank; path: the one marching robot
}

const segments: Segment[] = [];
const segmentPointHandleOwner = new Map<BABYLON.AbstractMesh, { segment: Segment; index: number }>();
const segmentMoveHandleOwner = new Map<BABYLON.AbstractMesh, Segment>();
const segmentCopyHandleOwner = new Map<BABYLON.AbstractMesh, Segment>();
// Looks up the path segment (if any) already recorded for a given robot, so
// extending its route reshapes/grows the same segment instead of a new one.
const pathSegmentByRobot = new Map<BABYLON.TransformNode, Segment>();

// A connector between two robots that are actual, authored neighbors in a
// formation's rank order — NOT just whichever robots happen to be nearby.
// Proximity is only ever used to break an existing formation connection
// (e.g. once a robot marches away via copy-to-path), never to create one.
const FORMATION_CONNECTION_BREAK_DISTANCE_YARDS = FORMATION_SPACING_YARDS * 2.5;
const FORMATION_CONNECTION_BREAK_DISTANCE_SQUARED =
  FORMATION_CONNECTION_BREAK_DISTANCE_YARDS * FORMATION_CONNECTION_BREAK_DISTANCE_YARDS;
const FORMATION_CONNECTION_RADIUS_YARDS = 0.02;
const FORMATION_CONNECTION_UPDATE_INTERVAL_FRAMES = 6;

interface FormationConnection {
  mesh: BABYLON.Mesh;
  robotA: BABYLON.TransformNode;
  robotB: BABYLON.TransformNode;
}
const formationConnectionsBySegment = new Map<Segment, FormationConnection[]>();
let formationConnectionMaterial: BABYLON.StandardMaterial | null = null;
let formationConnectionFrameCounter = 0;

function getFormationConnectionMaterial(): BABYLON.StandardMaterial {
  if (!formationConnectionMaterial) {
    formationConnectionMaterial = new BABYLON.StandardMaterial("formationConnectionMaterial", scene);
    formationConnectionMaterial.diffuseColor = new BABYLON.Color3(0.85, 0.9, 0.95);
    formationConnectionMaterial.emissiveColor = new BABYLON.Color3(0.55, 0.6, 0.65);
    formationConnectionMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    formationConnectionMaterial.disableLighting = true;
    formationConnectionMaterial.alpha = 0.5;
  }
  return formationConnectionMaterial;
}

// (Re)creates the connections for a formation's current rank order — one per
// adjacent pair of robots, e.g. after the formation is built or reshaped.
function rebuildFormationConnections(segment: Segment) {
  formationConnectionsBySegment.get(segment)?.forEach((connection) => connection.mesh.dispose(false, true));
  if (segment.kind !== "formation" || segment.robots.length < 2) {
    formationConnectionsBySegment.delete(segment);
    return;
  }

  const connections: FormationConnection[] = [];
  for (let i = 0; i < segment.robots.length - 1; i++) {
    const robotA = segment.robots[i];
    const robotB = segment.robots[i + 1];
    const mesh = BABYLON.MeshBuilder.CreateTube(
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
      const distanceSq = BABYLON.Vector3.DistanceSquared(connection.robotA.position, connection.robotB.position);
      if (distanceSq > FORMATION_CONNECTION_BREAK_DISTANCE_SQUARED) {
        connection.mesh.dispose(false, true);
        return false;
      }
      BABYLON.MeshBuilder.CreateTube("formationConnection", {
        path: [connection.robotA.position, connection.robotB.position],
        instance: connection.mesh,
      });
      return true;
    });
    formationConnectionsBySegment.set(segment, stillConnected);
  });
}

const SEGMENT_COLORS: Record<SegmentKind, BABYLON.Color3> = {
  formation: new BABYLON.Color3(0.4, 0.9, 1),
  path: new BABYLON.Color3(1, 0.85, 0.2),
};
const SEGMENT_POINT_HANDLE_SIZE = 0.3;
const SEGMENT_MOVE_HANDLE_SIZE = 0.45;
const CURVE_SAMPLES_PER_SPAN = 8;

// Smooths raw drawn/dragged control points into a curved line (Catmull-Rom
// spline) instead of a raw straight-segment polyline between them.
function buildCurvePoints(controlPoints: BABYLON.Vector3[]): BABYLON.Vector3[] {
  if (controlPoints.length < 3) return controlPoints;
  return BABYLON.Curve3.CreateCatmullRomSpline(controlPoints, CURVE_SAMPLES_PER_SPAN, false).getPoints();
}

function createSegmentHandle(name: string, size: number, color: BABYLON.Color3): BABYLON.Mesh {
  const handle = BABYLON.MeshBuilder.CreateSphere(name, { diameter: size, segments: 8 }, scene);
  const materialName = `${name}Material-${color.toHexString()}`;
  let material = scene.getMaterialByName(materialName) as BABYLON.StandardMaterial | null;
  if (!material) {
    material = new BABYLON.StandardMaterial(materialName, scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.5);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
  }
  handle.material = material;
  handle.parent = pathRoot;
  return handle;
}

// Adds point handles for any control points that don't have one yet (e.g.
// after extending a path segment), registering them for picking.
function growSegmentPointHandles(segment: Segment) {
  while (segment.pointHandles.length < segment.controlPoints.length) {
    const index = segment.pointHandles.length;
    const handle = createSegmentHandle("segmentPointHandle", SEGMENT_POINT_HANDLE_SIZE, SEGMENT_COLORS[segment.kind]);
    segment.pointHandles.push(handle);
    segmentPointHandleOwner.set(handle, { segment, index });
  }
}

function updateSegmentHandleVisibility(segment: Segment) {
  const visible = selectedRobot !== null && segment.robots.includes(selectedRobot);
  segment.moveHandle.setEnabled(visible);
  segment.pointHandles.forEach((handle) => handle.setEnabled(visible));
  segment.copyHandle?.setEnabled(visible);
}

// Redraws a segment's curve line and repositions its move/point handles to
// match its current control points (call after moving or reshaping it).
function refreshSegmentVisuals(segment: Segment) {
  const curvePoints = buildCurvePoints(segment.controlPoints);
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

  growSegmentPointHandles(segment);
  segment.pointHandles.forEach((handle, i) => handle.position.copyFrom(segment.controlPoints[i]));

  const midIndex = Math.floor(segment.controlPoints.length / 2);
  segment.moveHandle.position.copyFrom(segment.controlPoints[midIndex]);
  segment.moveHandle.position.y += 0.5; // float above the field so it's easy to grab

  if (segment.copyHandle) {
    segment.copyHandle.position.copyFrom(segment.controlPoints[0]);
    segment.copyHandle.position.y += 0.5;
  }
  updateSegmentHandleVisibility(segment);
}

// Rebuilds a segment's content from its (smoothed) curve: a formation segment
// respaces its rank of standing robots; a path segment re-registers its one
// robot's marching route so playback follows the updated curve.
function rebuildSegmentContent(segment: Segment) {
  const curvePoints = buildCurvePoints(segment.controlPoints);

  if (segment.kind === "formation") {
    segment.robots.forEach((robot) => robot.dispose());
    segment.robots = [];

    const formationPoints =
      curvePoints.length >= 2 ? resampleLineEvenly(curvePoints, FORMATION_SPACING_YARDS) : curvePoints;

    formationPoints.forEach((point, index) => {      
      const robotPrimitives = createLowPolyRobot(scene);
      robotPrimitives.parent = pathRoot;
      robotPrimitives.position.copyFrom(point);
      const next = formationPoints[index + 1];
      if (next) {
        const dx = next.x - point.x;
        const dz = next.z - point.z;
        if (dx * dx + dz * dz > 0.0001) {
          robotPrimitives.rotation.y = snapAngle(Math.atan2(dx, dz));
        }
      }
      robotPrimitives.setEnabled(true);
      segment.robots.push(robotPrimitives);
    });
    rebuildFormationConnections(segment);
  } else if (curvePoints.length >= 2) {
    const robot = segment.robots[0];
    if (robot) {
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
function createSegment(kind: SegmentKind, controlPoints: BABYLON.Vector3[], robots: BABYLON.TransformNode[]): Segment {
  const line = createTubeLine("segmentLine", controlPoints, SEGMENT_COLORS[kind]);

  const moveHandle = createSegmentHandle(
    "segmentMoveHandle",
    SEGMENT_MOVE_HANDLE_SIZE,
    new BABYLON.Color3(1, 0.5, 0.2)
  );
  const pointHandles = controlPoints.map(() =>
    createSegmentHandle("segmentPointHandle", SEGMENT_POINT_HANDLE_SIZE, SEGMENT_COLORS[kind])
  );
  const copyHandle =
    kind === "formation"
      ? createSegmentHandle("segmentCopyHandle", SEGMENT_MOVE_HANDLE_SIZE, new BABYLON.Color3(0.3, 0.9, 0.4))
      : null;

  const segment: Segment = { kind, controlPoints, line, moveHandle, pointHandles, copyHandle, robots };
  pointHandles.forEach((handle, index) => segmentPointHandleOwner.set(handle, { segment, index }));
  segmentMoveHandleOwner.set(moveHandle, segment);
  if (copyHandle) segmentCopyHandleOwner.set(copyHandle, segment);

  rebuildSegmentContent(segment);
  refreshSegmentVisuals(segment);
  segments.push(segment);
  if (kind === "path" && robots[0]) pathSegmentByRobot.set(robots[0], segment);
  return segment;
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
    rebuildSegmentContent(existing);
    refreshSegmentVisuals(existing);
  } else {
    createSegment("path", clonedPoints, [robot]);
  }
  selectRobot(robot);
}

function spawnRobotForPath(points: BABYLON.Vector3[]) {
  const robot = createLowPolyRobot(scene);
  robot.parent = pathRoot;
  robotPaths.set(robot, points);
  updateRobotPathLine(robot, points);
  walkRobotAlongPath(robot, points, scene, MARCH_STEP_YARDS);
  selectRobot(robot);
}

storedPaths.forEach(spawnRobotForPath);

const PATH_POINT_MIN_DISTANCE = 0.4; // yards between recorded points
const ROBOT_TOUCH_DISTANCE = 1; // yards — how close the laser must land to a selected robot's feet
let currentPathPoints: BABYLON.Vector3[] = [];
let pathLine: BABYLON.Mesh | null = null;
let pathPreviewUpdateTime = -Infinity;
let pathPreviewPointCount = 0;
// Set when the trigger-down aim landed on an existing robot, so the drawn
// points extend that robot's route instead of spawning a new one.
let extendingRobot: BABYLON.TransformNode | null = null;
// The robot actively being dragged along by the drawing itself — either the
// extended robot, or a freshly spawned one for a brand-new path.
let drawingRobot: BABYLON.TransformNode | null = null;
// True right after selecting a robot until the laser has come down to touch
// its feet, so drawing doesn't jump it wherever the laser first happened to aim.
let awaitingFeetTouch = false;
// The segment currently being dragged as a whole (via its move handle), and
// the last field point seen while dragging it (to move by incremental delta).
let movingSegment: Segment | null = null;
let lastMovePoint: BABYLON.Vector3 | null = null;
// The segment + control point index currently being reshaped (via a point handle).
let reshapingSegment: { segment: Segment; index: number } | null = null;
// The selected robot's marching step (count index) currently being dragged
// via its own per-step handle.
let reshapingStepHandle: { robot: BABYLON.TransformNode; index: number } | null = null;
// A robot grabbed directly by its body (not a handle) — dragging it scrubs
// the shared timeline to whichever of its own steps is nearest the laser.
let scrubbingRobot: BABYLON.TransformNode | null = null;
const triggerHeld = new Map<string, boolean>();
const tempoControllerDrags = new Set<string>();
let tempoPointerDragging = false;
// True while a controller's trigger-down landed on the hand menu, so the rest
// of the hold/release is treated as a menu tap instead of drawing a path.
const menuInteractionHeld = new Map<string, boolean>();

function executeMenuAction(hit: NonNullable<ReturnType<typeof getHandMenuHit>>) {
  switch (hit.action) {
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
  }
}
type CornerDrag = {
  opposite: BABYLON.Vector3;
  diagonal: BABYLON.Vector3;
  localOpposite: BABYLON.Vector3;
  localCorner: BABYLON.Vector3;
  point: BABYLON.Vector3;
  source: "hand" | "controller";
  rayDistance: number;
  offset: BABYLON.Vector3;
};
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
  getSelectedRobot: () => selectedRobot,
  selectRobot,
  createStandingMarcher,
  updateRobotPathLine,
  createTubeLine,
  createSegment,
  refreshSegmentVisuals,
  rebuildFormationConnections,
  refreshStepHandles,
  snapToStepGrid,
  cancelControllerPathDrawing: () => {
    pathLine?.dispose(false, true);
    pathLine = null;
    pathPreviewUpdateTime = -Infinity;
    pathPreviewPointCount = 0;
    if (drawingRobot && !extendingRobot) drawingRobot.dispose();
    drawingRobot = null;
    extendingRobot = null;
    currentPathPoints = [];
  },
});
const { cornerDrags, marcherGrabs } = handInteraction;

export function setHandTracking(tracking: BABYLON.WebXRHandTracking | null) {
  handInteraction.setHandTracking(tracking);
}

function isTabletopInteractionMode() {
  return getARScale() < getARScaleRange().max;
}

function beginMarcherGrab(
  handedness: string,
  robot: BABYLON.TransformNode,
  point: BABYLON.Vector3,
  source: "hand" | "controller",
  rayDistance = 0
) {
  handInteraction.beginMarcherGrab(handedness, robot, point, source, rayDistance);
}

function moveMarcherGrab(handedness: string, point: BABYLON.Vector3) {
  handInteraction.moveMarcherGrab(handedness, point);
}

function finishMarcherGrab(handedness: string, commit: boolean) {
  handInteraction.finishMarcherGrab(handedness, commit);
}

function beginCornerDrag(
  handedness: string,
  handle: BABYLON.AbstractMesh,
  point: BABYLON.Vector3,
  source: "hand" | "controller",
  rayDistance = 0
) {
  handInteraction.beginCornerDrag(handedness, handle, point, source, rayDistance);
}

function moveCornerDrag(drag: CornerDrag, point: BABYLON.Vector3) {
  handInteraction.moveCornerDrag(drag, point);
}

function updateCornerDrags() {
  handInteraction.updateCornerDrags();
}

export function updateTabletopHands() {
  handInteraction.updateTabletopHands();
}

function finishFingerPath(commit: boolean) {
  handInteraction.finishFingerPath(commit);
}

export function updateHandPathDrawing() {
  handInteraction.updateHandPathDrawing();
}

function getTriggerPressed(controller: BABYLON.WebXRInputSource): boolean {
  const trigger = controller.motionController?.getComponentOfType('trigger');
  return !!trigger?.pressed;
}

function getControllerRay(controller: BABYLON.WebXRInputSource): BABYLON.Ray {
  const pointer = controller.pointer;
  const forward = pointer.getDirection(BABYLON.Axis.Z);
  return new BABYLON.Ray(pointer.absolutePosition, forward, 100);
}

// Raycasts from the controller pointer to the field and returns the hit
// point converted into the path root's local space (so it tracks the field
// if it's later moved/scaled/rotated), or null if the pointer isn't aiming at it.
function getFieldPointFromController(controller: BABYLON.WebXRInputSource): BABYLON.Vector3 | null {
  const pick = scene.pickWithRay(getControllerRay(controller), (mesh) => mesh.name === "field");
  if (!pick?.hit || !pick.pickedPoint) {
    return null;
  }

  pathRoot.computeWorldMatrix(true);
  const localPoint = BABYLON.Vector3.TransformCoordinates(
    pick.pickedPoint,
    BABYLON.Matrix.Invert(pathRoot.getWorldMatrix())
  );
  localPoint.y += 0.02; // lift slightly above the turf so the line doesn't z-fight
  return snapToStepGrid(localPoint);
}

// Hold the trigger and aim at the field to draw a path; release it to send
// the little robot walking along the route that was just drawn. Aiming at an
// existing robot when the trigger is first pressed extends its route instead.
// In placement mode, each press instead drops a new standing robot in place.
export function updateRobotPathFromControllers() {
  if (floorCalibrationToggle?.checked) return;
  updateShowAllPathsToggleFromControllers();
  updatePlacementModeToggleFromControllers();
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
    const isPressed = getTriggerPressed(controller);
    const wasPressed = triggerHeld.get(handedness) ?? false;
    triggerHeld.set(handedness, isPressed);

    const marcherGrab = marcherGrabs.get(handedness);
    if (marcherGrab?.source === "hand") return;
    if (marcherGrab?.source === "controller") {
      if (!isPressed) finishMarcherGrab(handedness, true);
      else {
        const ray = getControllerRay(controller);
        moveMarcherGrab(handedness, ray.origin.add(ray.direction.scale(marcherGrab.rayDistance)));
      }
      return;
    }

    if (!isPressed && wasPressed && tempoControllerDrags.delete(handedness)) return;
    if (isPressed && tempoControllerDrags.has(handedness)) {
      const tempoPick = scene.pickWithRay(getControllerRay(controller), isScoreboardTempoScreen);
      if (tempoPick?.hit) updateScoreboardTempoFromPick(tempoPick);
      return;
    }

    const cornerDrag = cornerDrags.get(handedness);
    if (cornerDrag?.source === "hand") return;
    if (!isPressed && wasPressed && cornerDrag) {
      cornerDrags.delete(handedness);
      return;
    }
    if (isPressed && cornerDrag?.source === "controller") {
      const ray = getControllerRay(controller);
      moveCornerDrag(cornerDrag, ray.origin.add(ray.direction.scale(cornerDrag.rayDistance)));
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
      const cornerPick = scene.pickWithRay(ray, (mesh) => getTabletopCorner(mesh) !== null);
      const corner = getTabletopCorner(cornerPick?.pickedMesh ?? null);
      if (corner && cornerPick?.pickedMesh && cornerPick.pickedPoint) {
        beginCornerDrag(
          handedness,
          cornerPick.pickedMesh,
          cornerPick.pickedPoint,
          "controller",
          BABYLON.Vector3.Distance(ray.origin, cornerPick.pickedPoint)
        );
        return;
      }
      pathLine?.dispose(false, true);
      pathLine = null;
      pathPreviewUpdateTime = -Infinity;
      pathPreviewPointCount = 0;

      const menuPick = scene.pickWithRay(getControllerRay(controller), isMenuControl);
      const menuHit = menuPick?.hit ? getHandMenuHit(menuPick) : null;
      if (menuHit) {
        menuInteractionHeld.set(handedness, true);
        executeMenuAction(menuHit);
        return;
      }
      menuInteractionHeld.set(handedness, false);

      const pick = scene.pickWithRay(getControllerRay(controller));

      const tabletopRobot = isTabletopInteractionMode() && pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
      if (tabletopRobot && pick?.pickedPoint) {
        const ray = getControllerRay(controller);
        beginMarcherGrab(handedness, tabletopRobot, pick.pickedPoint, "controller",
          BABYLON.Vector3.Distance(ray.origin, pick.pickedPoint));
        return;
      }

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

      // Grabbing a robot that already has a real marching route by its body
      // (not one of its handles) scrubs the shared timeline instead of
      // extending its path — only a robot with nowhere to scrub yet (a bare
      // placed formation member) falls through to the old extend-path flow.
      const pickedRobotCounts = pickedRobot ? getRobotCounts(pickedRobot) : null;
      if (pickedRobot && pickedRobotCounts && pickedRobotCounts.length > 1) {
        scrubbingRobot = pickedRobot;
        selectRobot(pickedRobot);
        return;
      }

      extendingRobot = pickedRobot;
      selectRobot(pickedRobot);
      // Anchor to the robot's own last path point — don't also raycast the
      // field this same frame, or the laser (still aimed at the robot) could
      // pick an unrelated spot on the field and jump the path there.
      if (pickedRobot) {
        currentPathPoints = [pickedRobot.position.clone()];
        drawingRobot = pickedRobot;
        drawingRobot.setEnabled(true);
        awaitingFeetTouch = true;
      } else {
        currentPathPoints = [];
        drawingRobot = null; // spawned once the first point of a new path is drawn
        awaitingFeetTouch = false;
      }
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
            const distanceSq = BABYLON.Vector3.DistanceSquared(count.position, point);
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

      if (movingSegment) {
        const point = getFieldPointFromController(controller);
        if (point) {
          if (lastMovePoint) {
            const delta = point.subtract(lastMovePoint);
            movingSegment.controlPoints = movingSegment.controlPoints.map((p) => p.add(delta));
            movingSegment.robots.forEach((robot) => robot.position.addInPlace(delta));
            refreshSegmentVisuals(movingSegment);
          }
          lastMovePoint = point;
        }
        return;
      }

      if (reshapingSegment) {
        const point = getFieldPointFromController(controller);
        if (point) {
          reshapingSegment.segment.controlPoints[reshapingSegment.index] = point;
          rebuildSegmentContent(reshapingSegment.segment);
          refreshSegmentVisuals(reshapingSegment.segment);
        }
        return;
      }

      if (placementMode) {
        const point = getFieldPointFromController(controller);
        if (point) {
          const draft = placementDrafts.get(handedness) ?? createStandingMarcher(point);
          draft.position.copyFrom(point);
          placementDrafts.set(handedness, draft);
        }
        return;
      }

      const point = getFieldPointFromController(controller);
      if (point) {
        if (extendingRobot && awaitingFeetTouch) {
          if (BABYLON.Vector3.Distance(point, extendingRobot.position) > ROBOT_TOUCH_DISTANCE) {
            return; // keep waiting for the laser to reach the robot's feet
          }
          awaitingFeetTouch = false;
        }

        if (!drawingRobot) {
          // Brand-new path: spawn the robot right where the drawing starts.
          drawingRobot = createLowPolyRobot(scene);
          drawingRobot.parent = pathRoot;
          drawingRobot.position = point.clone();
          drawingRobot.setEnabled(true);
        }

        // Drag the robot along with the laser tip every frame (not just at the
        // sparser recorded points below), facing the direction it's moving.
        const dx = point.x - drawingRobot.position.x;
        const dz = point.z - drawingRobot.position.z;
        if (dx * dx + dz * dz > 0.0001) {
          drawingRobot.rotation.y = snapAngle(Math.atan2(dx, dz));
        }
        drawingRobot.position.copyFrom(point);

        const lastPoint = currentPathPoints[currentPathPoints.length - 1];
        if (!lastPoint || BABYLON.Vector3.Distance(lastPoint, point) >= PATH_POINT_MIN_DISTANCE) {
          currentPathPoints.push(point);
        }
        const now = performance.now();
        if (currentPathPoints.length >= 2 && currentPathPoints.length !== pathPreviewPointCount &&
          (!pathLine || !isARTabletopModeActive() || now - pathPreviewUpdateTime >= 1000 / 30)) {
          const material = pathLine?.material as BABYLON.StandardMaterial | undefined;
          pathLine?.dispose(false, false);
          pathLine = createTubeLine("robotPathLine", currentPathPoints, new BABYLON.Color3(1, 0.85, 0.2), material);
          pathPreviewUpdateTime = now;
          pathPreviewPointCount = currentPathPoints.length;
        }
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
        reshapingStepHandle = null;
        return;
      }

      if (movingSegment || reshapingSegment) {
        movingSegment = null;
        lastMovePoint = null;
        reshapingSegment = null;
        return;
      }

      pathLine?.dispose(false, true);
      pathLine = null;

      if (placementMode) {
        const point = getFieldPointFromController(controller);
        const draft = placementDrafts.get(handedness);
        if (point) {
          const robot = draft ?? createStandingMarcher(point);
          robot.position.copyFrom(point);
          selectRobot(robot);
        } else {
          draft?.dispose();
        }
        placementDrafts.delete(handedness);
        return;
      }

      if (currentPathPoints.length >= 2) {
        if (extendingRobot) {
          // Grow the robot's existing path segment (or start one) with the new points.
          const existingSegment = pathSegmentByRobot.get(extendingRobot);
          const history = existingSegment
            ? existingSegment.controlPoints
            : robotPaths.get(extendingRobot) ?? [extendingRobot.position.clone()];
          const extendedHistory = history.concat(currentPathPoints.slice(1));
          robotPaths.set(extendingRobot, extendedHistory);
          if (existingSegment) {
            existingSegment.controlPoints = extendedHistory;
            rebuildSegmentContent(existingSegment);
            refreshSegmentVisuals(existingSegment);
          } else {
            createSegment("path", extendedHistory, [extendingRobot]);
          }
          selectRobot(extendingRobot);
        } else if (drawingRobot) {
          // The robot already walked here alongside the drawing — record it as a path segment.
          robotPaths.set(drawingRobot, currentPathPoints);
          createSegment("path", currentPathPoints.slice(), [drawingRobot]);
          selectRobot(drawingRobot);
          storedPaths.push(currentPathPoints);
          saveStoredPaths(storedPaths);
        }
      } else if (drawingRobot && !extendingRobot) {
        // Too short a drag to count as a path — discard the just-spawned robot.
        drawingRobot.dispose();
      }

      extendingRobot = null;
      drawingRobot = null;
    }
  });
  updateCornerDrags();
}

// Read-only access for other modules (e.g. the palm-up hand menu) that need
// to know which controllers are live without duplicating controller tracking.
export function getActiveControllers(): ReadonlyMap<string, BABYLON.WebXRInputSource> {
  return getRegisteredControllers();
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

function randomFieldPoint(): BABYLON.Vector3 {
  const x = (Math.random() * 2 - 1) * (FIELD_WIDTH_YARDS / 2 - RANDOM_PATH_MARGIN_YARDS);
  const z = (Math.random() * 2 - 1) * (FIELD_LENGTH_YARDS / 2 - RANDOM_PATH_MARGIN_YARDS);
  return new BABYLON.Vector3(x, FIELD_SURFACE_Y, z);
}

function generateRandomPath(): BABYLON.Vector3[] {
  const pointCount =
    RANDOM_PATH_MIN_POINTS + Math.floor(Math.random() * (RANDOM_PATH_MAX_POINTS - RANDOM_PATH_MIN_POINTS + 1));
  const points: BABYLON.Vector3[] = [];
  for (let i = 0; i < pointCount; i++) points.push(randomFieldPoint());
  return buildCurvePoints(points);
}

// Spawns a batch of robots on random walking routes, e.g. for stress-testing
// playback/collision behavior with a crowd on the field.
function spawnRandomRobots(count: number, randomizeGaits = false) {
  for (let i = 0; i < count; i++) {
    const isResting = randomizeGaits && i % 10 === 0;
    const points = isResting ? null : generateRandomPath();
    if (points && points.length < 2) continue;
    const gaitIndex = randomizeGaits
      ? RANDOM_MARCHING_GAIT_INDICES[Math.floor(Math.random() * RANDOM_MARCHING_GAIT_INDICES.length)]
      : undefined;
    const robotPrimitives = createLowPolyRobot(scene, gaitIndex);
    robotPrimitives.parent = pathRoot;
    if (isResting) {
      setMarcherInstrumentRestPose(robotPrimitives, true);
      robotPrimitives.position.copyFrom(randomFieldPoint());
      robotPrimitives.rotation.y = Math.random() * Math.PI * 2;
      robotPrimitives.setEnabled(true);
      continue;
    }
    if (randomizeGaits) {
      setMarcherInstrumentRestPose(robotPrimitives, Math.random() < 0.5);
    }
    if (!points) continue;
    robotPaths.set(robotPrimitives, points);
    updateRobotPathLine(robotPrimitives, points);
    walkRobotAlongPath(robotPrimitives, points, scene, MARCH_STEP_YARDS);
  }
}

// Clears every currently spawned robot and everything tracking it (path
// lines, segments/handles, formation connections) so a fresh drill starts on
// an empty field instead of piling onto whatever was already there.
function clearAllRobots() {
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
    segment.copyHandle?.dispose();
  });
  segments.length = 0;
  segmentPointHandleOwner.clear();
  segmentMoveHandleOwner.clear();
  segmentCopyHandleOwner.clear();
  pathSegmentByRobot.clear();

  formationConnectionsBySegment.forEach((connections) =>
    connections.forEach((connection) => connection.mesh.dispose(false, true))
  );
  formationConnectionsBySegment.clear();

  clearStepHandles();
  selectedRobot = null;

  disposeAllRobots();
}

function spawnMarchingDrill() {
  clearAllRobots();
  const paths = generateMarchingDrillPaths();
  paths.forEach((path) => {
    const robotPrimitives = createLowPolyRobot(scene);
    robotPrimitives.parent = pathRoot;
    robotPaths.set(robotPrimitives, path);
    updateRobotPathLine(robotPrimitives, path);
    walkRobotAlongCounts(robotPrimitives, path, scene);
  });

  refreshCollisionMarkers(scene);
}

export function initInteraction() {
  addRandomRobotsButton?.addEventListener("click", () => spawnRandomRobots(8));
  add100RobotsButton?.addEventListener("click", () => spawnRandomRobots(100, true));
  generateDrillButton?.addEventListener("click", () => spawnMarchingDrill());

  // Desktop/browser testing has no VR trigger, so a plain mouse click is
  // wired to the same collision-marker preview and robot selection the VR
  // trigger dispatches to.
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const tempoPick = scene.pick(scene.pointerX, scene.pointerY, isScoreboardTempoScreen);
      tempoPointerDragging = !!tempoPick?.hit && updateScoreboardTempoFromPick(tempoPick);
      if (tempoPointerDragging) return;
    }
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERUP) {
      tempoPointerDragging = false;
      return;
    }
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      if (tempoPointerDragging) {
        const tempoPick = scene.pick(scene.pointerX, scene.pointerY, isScoreboardTempoScreen);
        if (tempoPick?.hit) updateScoreboardTempoFromPick(tempoPick);
        return;
      }
      const pick = scene.pick(
        scene.pointerX,
        scene.pointerY,
        (mesh) => isMenuControl(mesh) || isScoreboardTempoScreen(mesh)
      );
      canvas.style.cursor = pick?.hit && (
        getHandMenuHit(pick) || isScoreboardTempoPick(pick) || isScoreboardGaitPick(pick) ||
        isScoreboardHornPosePick(pick)
      ) ? "pointer" : "";
      return;
    }
    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
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
    if (robot) selectRobot(robot);
  });
}
