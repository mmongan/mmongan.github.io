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
import { WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
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
  setCollisionMarkersVisible,
  seekToCollisionMarker,
  getGlobalProgress,
  getRobotCounts,
  setRobotCountPosition,
  setRobotHeld,
  placeRobot,
  clearRobotPath,
  refreshCollisionMarkers,
  COLLISION_MARKER_RADIUS_YARDS,
  resetRobotSchedule,
  disposeAllRobots,
  walkRobotAlongCounts,
} from '../robot/robot';
import { getHandMenuHit, getHandMenuHitNearPoint, setMenuHandTracking, setFormationCommitAvailable, setFormationLibraryOpen, setFormationLibraryPage, setFormationLibraryAnchorAvailable, isHandMenuVisible, isMenuControl } from '../menu/handMenu';
import type { FormationLetter } from '../menu/handMenu';
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
import { canvas, collisionMarkersToggle, floorCalibrationToggle, fullScaleVRButton, tabletopScaleButton, showAllPathsToggle, placementModeToggle, addRandomRobotsButton, marcherCountInput, marcherCountValue, generateDrillButton } from '../ui/dom';
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
  const motionController = controller.motionController;
  if (!motionController) {
    return false;
  }

  // Squeeze only — the trigger is reserved for drawing the robot's path.
  const squeeze = motionController.getComponentOfType('squeeze');
  if (squeeze?.pressed) return true;

  return !!controller.inputSource.gamepad?.buttons?.[1]?.pressed;
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
    finishMarcherGrab(handedness, false);
    placementDrafts.get(handedness)?.dispose();
    placementDrafts.delete(handedness);
    triggerHeld.delete(handedness);
    gripHeld.delete(handedness);
    stopRotationHandleDrag(handedness);
  });
}

export function updateARResizeFromControllers() {
  resizeFromControllers(marcherGrabs.size > 0);
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


// Full path history and persistent path line per robot (a robot's line covers
// its whole route so far, including any extensions, not just the last segment).
const robotPaths = new Map<TransformNode, Vector3[]>();
const robotPathLines = new Map<TransformNode, Mesh>();
// Reverse lookup so clicking/triggering a drawn path line selects its robot.
const pathLineOwner = new Map<AbstractMesh, TransformNode>();
let selectedRobot: TransformNode | null = null;
let showAllPaths = !!showAllPathsToggle?.checked;

// Paths/segments are drawn as tubes connecting the grab-point balls instead
// of thin CreateLines meshes, so drawn routes are actually visible in VR.
const PATH_TUBE_RADIUS_YARDS = 0.05;
const PATH_TUBE_TESSELLATION = 8;

function createTubeLine(name: string, points: Vector3[], color: Color3, existingMaterial?: StandardMaterial): Mesh {
  const tube = MeshBuilder.CreateTube(
    name,
    { path: points, radius: PATH_TUBE_RADIUS_YARDS, tessellation: PATH_TUBE_TESSELLATION },
    scene
  );
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
function refreshPathLineAppearance() {
  robotPathLines.forEach((line, robot) => {
    const isSelected = robot === selectedRobot;
    const color = getRobotColor(robot);
    setTubeLineAppearance(line, color, isSelected ? PATH_SELECTED_ALPHA : PATH_UNSELECTED_ALPHA);
    line.setEnabled(showAllPaths || isSelected || selectedRobot !== null);
  });
}

function selectRobot(robot: TransformNode | null) {
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
  if (!selectedRobot) return;
  const counts = getRobotCounts(selectedRobot);
  if (!counts) return;

  const material = scene.getMaterialByName("stepHandleMaterial") as StandardMaterial | null
    ?? new StandardMaterial("stepHandleMaterial", scene);
  const color = getRobotColor(selectedRobot);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.6);
  material.specularColor = new Color3(0, 0, 0);

  counts.forEach((count, index) => {
    const handle = MeshBuilder.CreateSphere("stepHandle", { diameter: STEP_HANDLE_SIZE, segments: 8 }, scene);
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
// no walking) at the aimed point —
// for laying out a formation one member at a time.
let placementMode = !!placementModeToggle?.checked;
const placementDrafts = new Map<string, TransformNode>();

function createStandingMarcher(position: Vector3) {
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

function snapToStepGrid(point: Vector3): Vector3 {
  return point;
  // return new Vector3(
  //   Math.round(point.x / MARCH_STEP_YARDS) * MARCH_STEP_YARDS,
  //   point.y,
  //   Math.round(point.z / MARCH_STEP_YARDS) * MARCH_STEP_YARDS
  // );
}

function snapAngle(angle: number): number {
  return angle;
  //return Math.round(angle / ANGLE_SNAP_RADIANS) * ANGLE_SNAP_RADIANS;
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

function getFormationPoints(controlPoints: Vector3[], fitClosedCircle = true) {
  const closed = isClosedFormation(controlPoints);
  if (closed && fitClosedCircle) {
    if (isVerticalFormation(controlPoints)) {
      const circle = fitVerticalFormationCircle(controlPoints);
      const count = Math.max(3, Math.round(Math.PI * 2 * circle.radius / FORMATION_SPACING_YARDS));
      return sampleVerticalFormationCircle(circle, count, false);
    }
    const circle = fitFormationCircle(controlPoints);
    const count = Math.max(3, Math.round(Math.PI * 2 * circle.radius / FORMATION_SPACING_YARDS));
    return sampleFormationCircle(circle, count, false);
  }
  if (closed) return resampleLineEvenly(controlPoints, FORMATION_SPACING_YARDS, true);
  const curvePoints = buildCurvePoints(controlPoints);
  return curvePoints.length >= 2
    ? resampleLineEvenly(curvePoints, FORMATION_SPACING_YARDS, closed)
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
  robots: TransformNode[]; // formation: every robot in the rank; path: the one marching robot
}

const segments: Segment[] = [];
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
const FORMATION_CONNECTION_BREAK_DISTANCE_SQUARED =
  FORMATION_CONNECTION_BREAK_DISTANCE_YARDS * FORMATION_CONNECTION_BREAK_DISTANCE_YARDS;
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
  formationConnectionsBySegment.get(segment)?.forEach((connection) => connection.mesh.dispose(false, true));
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
      if (distanceSq > FORMATION_CONNECTION_BREAK_DISTANCE_SQUARED) {
        connection.mesh.dispose(false, true);
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

function createSegmentHandle(name: string, size: number, color: Color3): Mesh {
  const handle = MeshBuilder.CreateSphere(name, { diameter: size, segments: 8 }, scene);
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
    const rotation = Math.atan2(
      Math.sin(angle - twoHandPathManipulation.startAngle),
      Math.cos(angle - twoHandPathManipulation.startAngle)
    );
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
  const rotation = Math.atan2(
    Math.sin(angle - rotatingSegment.startAngle),
    Math.cos(angle - rotatingSegment.startAngle)
  );
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
  const curvePoints = buildCurvePoints(
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

  growSegmentPointHandles(segment);
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
function rebuildSegmentContent(segment: Segment) {
  if (segment.kind === "formation") {
    segment.robots.forEach((robot) => {
      if (robot !== segment.anchorRobot) robot.dispose();
    });
    segment.robots = segment.anchorRobot ? [segment.anchorRobot] : [];

    const formationPoints = getFormationPoints(segment.controlPoints, segment.fitClosedCircle);

    formationPoints.forEach((point, index) => {      
      const robotPrimitives = index === 0 && segment.anchorRobot
        ? segment.anchorRobot
        : createLowPolyRobot(scene);
      if (index !== 0 || !segment.anchorRobot) {
        robotPrimitives.parent = pathRoot;
        segment.robots.push(robotPrimitives);
      }
      robotPrimitives.position.copyFrom(point);
      const next = formationPoints[index + 1] ??
        (isClosedFormation(segment.controlPoints) ? formationPoints[0] : undefined);
      if (next) {
        const dx = next.x - point.x;
        const dz = next.z - point.z;
        if (dx * dx + dz * dz > 0.0001) {
          robotPrimitives.rotation.y = snapAngle(Math.atan2(dx, dz));
        }
      }
      robotPrimitives.setEnabled(true);
    });
    rebuildFormationConnections(segment);
  } else {
    const curvePoints = buildCurvePoints(segment.controlPoints);
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
  fitClosedCircle = true
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
    anchorRobot, fitClosedCircle, robots,
  };
  pointHandles.forEach((handle, index) => segmentPointHandleOwner.set(handle, { segment, index }));
  segmentMoveHandleOwner.set(moveHandle, segment);
  rotationHandles.forEach((handle) => segmentRotationHandleOwner.set(handle, segment));
  if (copyHandle) segmentCopyHandleOwner.set(copyHandle, segment);

  rebuildSegmentContent(segment);
  refreshSegmentVisuals(segment);
  segments.push(segment);
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

function createFormationPreset(preset: FormationPreset) {
  const heldRobot = [...handInteraction.marcherGrabs.values()]
    .find((grab) => !grab.robot.isDisposed())?.robot;
  const anchor = heldRobot ?? selectedRobot;
  if (!anchor || anchor.isDisposed()) return;

  const origin = anchor.position.clone();
  const forward = new Vector3(Math.sin(anchor.rotation.y), 0, Math.cos(anchor.rotation.y));
  const up = new Vector3(0, FORMATION_SPACING_YARDS, 0);
  const side = forward.scale(FORMATION_SPACING_YARDS);

  if (preset === "line") {
    createHandFormation(anchor, [origin, origin.add(up.scale(4))]);
    return;
  }

  if (preset === "arc") {
    createHandFormation(anchor, [
      origin,
      origin.add(side.scale(1.5)).add(up.scale(2)),
      origin.add(side.scale(3)).add(up.scale(2.5)),
      origin.add(side.scale(4.5)).add(up.scale(1.5)),
    ]);
    return;
  }

  if (preset === "circle") {
    const radius = FORMATION_SPACING_YARDS * 3;
    const center = origin.add(forward.scale(radius));
    const points: Vector3[] = [];
    for (let index = 0; index <= 8; index++) {
      const angle = Math.PI + index * Math.PI / 4;
      points.push(center
        .add(forward.scale(radius * Math.cos(angle)))
        .add(new Vector3(0, radius * Math.sin(angle), 0)));
    }
    createHandFormation(anchor, points);
    return;
  }

  if (preset === "triangle" || preset === "square" ||
    preset === "pentagon" || preset === "hexagon" || preset === "star") {
    const isStar = preset === "star";
    const sides = preset === "triangle" ? 3 : preset === "square" ? 4 :
      preset === "pentagon" ? 5 : preset === "hexagon" ? 6 : 10;
    const radius = FORMATION_SPACING_YARDS * 3;
    const center = origin.add(forward.scale(radius));
    const points: Vector3[] = [];
    for (let index = 0; index < sides; index++) {
      const angle = Math.PI + index * Math.PI * 2 / sides;
      const pointRadius = isStar && index % 2 === 1 ? radius * 0.48 : radius;
      points.push(center
        .add(forward.scale(pointRadius * Math.cos(angle)))
        .add(new Vector3(0, pointRadius * Math.sin(angle), 0)));
    }
    points.push(points[0].clone());
    createHandFormation(anchor, points, false);
    return;
  }

  removeRobotPath(anchor);
  for (let row = 0; row < 3; row++) {
    const start = origin.add(up.scale(row));
    const end = start.add(side.scale(2));
    createSegment("formation", [start, end], [], row === 0 ? anchor : undefined);
  }
  refreshCollisionMarkers(scene);
  selectRobot(anchor);
}

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
  const side = forward.scale(FORMATION_SPACING_YARDS);
  const up = new Vector3(0, FORMATION_SPACING_YARDS, 0);
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
        .add(side.scale(startColumn - 2))
        .add(up.scale(3 - row));
      if (startColumn === endColumn) {
        if (!anchorUsed) {
          anchor.position.copyFrom(rowOrigin);
          anchor.setEnabled(true);
          anchorUsed = true;
        } else {
          createStandingMarcher(rowOrigin);
        }
        continue;
      }
      const points = [rowOrigin, rowOrigin.add(side.scale(endColumn - startColumn))];
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
    rebuildSegmentContent(existing);
    refreshSegmentVisuals(existing);
  } else {
    createSegment("path", clonedPoints, [robot]);
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
// True while a controller's trigger-down landed on the hand menu, so the rest
// of the hold/release is treated as a menu tap instead of drawing a path.
const menuInteractionHeld = new Map<string, boolean>();

function executeMenuAction(hit: NonNullable<ReturnType<typeof getHandMenuHit>>) {
  switch (hit.action) {
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
  }
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
});
const { marcherGrabs } = handInteraction;

export function setHandTracking(tracking: WebXRHandTracking | null) {
  handInteraction.setHandTracking(tracking);
  setMenuHandTracking(tracking);
}

export function isHandMarcherInteraction(handedness: string, point: Vector3) {
  return handInteraction.isHandMarcherInteraction(handedness, point);
}

function isTabletopInteractionMode() {
  return getARScale() < getARScaleRange().max;
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
  return !!trigger?.pressed;
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
  const pick = scene.pickWithRay(getControllerRay(controller), (mesh) => mesh.name === "field");
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

// Controller triggers select/edit existing content or place standing marchers
// when placement mode is enabled. They never draw or extend marching paths.
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
    const gripPressed = isGripPressed(controller);
    const wasGripPressed = gripHeld.get(handedness) ?? false;
    gripHeld.set(handedness, gripPressed);
    const isPressed = getTriggerPressed(controller);
    const wasPressed = triggerHeld.get(handedness) ?? false;
    triggerHeld.set(handedness, isPressed);

    const marcherGrab = marcherGrabs.get(handedness);
    if (marcherGrab?.source === "hand") return;
    if (marcherGrab?.source === "controller") {
      if (!gripPressed) finishMarcherGrab(handedness, true);
      else {
        const ray = getControllerRay(controller);
        moveMarcherGrab(
          handedness,
          ray.origin.add(ray.direction.scale(marcherGrab.rayDistance)),
          handInteraction.getFacingYaw(ray.direction),
        );
      }
      return;
    }

    if (gripPressed && !wasGripPressed && isTabletopInteractionMode() &&
      !menuInteractionHeld.get(handedness)) {
      const ray = getControllerRay(controller);
      const pick = scene.pickWithRay(ray, (mesh) => findRobotRoot(mesh) !== null);
      const robot = pick?.hit ? findRobotRoot(pick.pickedMesh) : null;
      if (robot && pick?.pickedPoint) {
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

      const menuPick = scene.pickWithRay(getControllerRay(controller), isMenuControl);
      const menuHit = menuPick?.hit ? getHandMenuHit(menuPick) : null;
      if (menuHit) {
        menuInteractionHeld.set(handedness, true);
        executeMenuAction(menuHit);
        return;
      }
      menuInteractionHeld.set(handedness, false);

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

      // A marcher with a route can scrub the shared timeline; a standing
      // marcher is selected without creating a route.
      const pickedRobotCounts = pickedRobot ? getRobotCounts(pickedRobot) : null;
      if (pickedRobot && pickedRobotCounts && pickedRobotCounts.length > 1) {
        scrubbingRobot = pickedRobot;
        selectRobot(pickedRobot);
        return;
      }

      selectRobot(pickedRobot);
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
    }
  });
}

// Read-only access for other modules (e.g. the palm-up hand menu) that need
// to know which controllers are live without duplicating controller tracking.
export function getActiveControllers(): ReadonlyMap<string, WebXRInputSource> {
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
  const getMarcherCount = () => Math.max(1, Math.min(100, Math.round(Number(marcherCountInput?.value) || 8)));
  const updateMarcherCountValue = () => {
    if (marcherCountValue) marcherCountValue.value = String(getMarcherCount());
  };
  marcherCountInput?.addEventListener("input", updateMarcherCountValue);
  updateMarcherCountValue();
  addRandomRobotsButton?.addEventListener("click", () => spawnRandomRobots(getMarcherCount()));
  generateDrillButton?.addEventListener("click", () => spawnMarchingDrill());
  collisionMarkersToggle?.addEventListener("change", () => {
    setCollisionMarkersVisible(!!collisionMarkersToggle?.checked);
  });
  setCollisionMarkersVisible(collisionMarkersToggle?.checked ?? true);

  // Desktop/browser testing has no VR trigger, so a plain mouse click is
  // wired to the same collision-marker preview and robot selection the VR
  // trigger dispatches to.
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
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
        (mesh) => isMenuControl(mesh) || isScoreboardTempoScreen(mesh)
      );
      canvas.style.cursor = pick?.hit && (
        getHandMenuHit(pick) || isScoreboardTempoPick(pick) || isScoreboardGaitPick(pick) ||
        isScoreboardHornPosePick(pick)
      ) ? "pointer" : "";
      return;
    }
    if (pointerInfo.type !== PointerEventTypes.POINTERTAP) return;
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
