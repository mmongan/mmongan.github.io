import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
  getARSurfaceHeight,
  setARSurfaceHeightForScaleGesture,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { findRobotRoot, placeRobot, setRobotHeld } from '../robot/robot';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { floorCalibrationToggle } from '../ui/dom';
import { getControllerYaw, rotateAroundY } from './controllers';

// Clear the hand/controller depth before drawing held marchers, below XR notices.
const GRABBED_MARCHER_RENDERING_GROUP = 2;

export interface HandSegment {
  kind: 'formation' | 'path';
  controlPoints: Vector3[];
  line: Mesh;
  moveHandle: Mesh;
  pointHandles: Mesh[];
  rotationHandles: Mesh[];
  copyHandle: Mesh | null;
  robots: TransformNode[];
  anchorRobot?: TransformNode;
}

export interface MarcherGrab {
  robot: TransformNode;
  source: 'hand' | 'controller';
  offset: Vector3;
  originalPosition: Vector3;
  originalRotationY: number;
  initialRotationY: number;
  initialFacingYaw: number | null;
  rayDistance: number;
  originalRenderingGroups: Map<AbstractMesh, number>;
}

export interface HandPathDependencies {
  pathRoot: TransformNode;
  robotPaths: Map<TransformNode, Vector3[]>;
  robotPathLines: Map<TransformNode, Mesh>;
  storedPaths: Vector3[][];
  saveStoredPaths: (paths: Vector3[][]) => void;
  pathSegmentByRobot: ReadonlyMap<TransformNode, HandSegment>;
  segments: ReadonlyArray<HandSegment>;
  placementDrafts: Map<string, TransformNode>;
  pathPointMinDistance: number;
  isPlacementMode: () => boolean;
  getSelectedRobot: () => TransformNode | null;
  selectRobot: (robot: TransformNode | null) => void;
  createStandingMarcher: (position: Vector3) => TransformNode;
  createHandFormation: (anchorRobot: TransformNode, controlPoints: Vector3[]) => void;
  getFormationPoints: (controlPoints: Vector3[]) => Vector3[];
  getMarcherCircle: (robot: TransformNode) => { segment: HandSegment; center: Vector3 } | null;
  resizeCircleFormation: (segment: HandSegment, controlPoints: Vector3[]) => void;
  updateRobotPathLine: (robot: TransformNode, points: Vector3[]) => void;
  refreshSegmentVisuals: (segment: HandSegment) => void;
  rebuildFormationConnections: (segment: HandSegment) => void;
  refreshStepHandles: () => void;
  snapToStepGrid: (point: Vector3) => Vector3;
  activateHandMenuAtPoint: (point: Vector3) => boolean;
}

export function createHandInteraction(paths: HandPathDependencies) {
  const {
    pathRoot,
    robotPaths,
    robotPathLines,
    storedPaths,
    saveStoredPaths,
    pathSegmentByRobot,
    segments,
    placementDrafts,
    pathPointMinDistance,
    isPlacementMode,
    getSelectedRobot,
    selectRobot,
    createStandingMarcher,
    createHandFormation,
    getFormationPoints,
    getMarcherCircle,
    resizeCircleFormation,
    updateRobotPathLine,
    refreshSegmentVisuals,
    rebuildFormationConnections,
    refreshStepHandles,
    snapToStepGrid,
    activateHandMenuAtPoint,
  } = paths;

  const handPinches = new Map<string, boolean>();
  // Hands whose current pinch has grabbed or handed off a marcher; while either
  // hand is in this set, two pinches act independently instead of moving the scene.
  const marcherPinchHands = new Set<string>();
  let sceneGesture: {
    startSurfaceY: number;
    startMidpointY: number;
    startDistance: number;
    startYaw: number;
    startScale: number;
    startRotation: number;
    localAnchor: Vector3;
  } | null = null;
  const marcherGrabs = new Map<string, MarcherGrab>();
  let pendingFormationGlow: HighlightLayer | null = null;

  function highlightPendingMarcher(robot: TransformNode) {
    if (!pendingFormationGlow) {
      pendingFormationGlow = new HighlightLayer('pendingFormationGlow', scene, {
        renderingGroupId: GRABBED_MARCHER_RENDERING_GROUP,
      });
      pendingFormationGlow.innerGlow = false;
    }
    robot.getChildMeshes().forEach((mesh) => {
      if (mesh instanceof Mesh) pendingFormationGlow!.addMesh(mesh, new Color3(0.2, 0.9, 1));
    });
  }

  let circleResize: {
    segment: HandSegment;
    center: Vector3;
    startDistance: number;
    originalControlPoints: Vector3[];
  } | null = null;
  let formationPull: {
    anchorHand: 'left' | 'right';
    pullHand: 'left' | 'right';
    robot: TransformNode;
    endPoint: Vector3;
    pinchOffset: Vector3;
    tracedOffsets: Vector3[];
    previewRobots: TransformNode[];
    shapedOffsets: Vector3[] | null;
    shapedRotationY: number;
    floating: boolean;
    originalGrab: MarcherGrab;
  } | null = null;
  const handPlacementDrafts = new Set<TransformNode>();
  let handTracking: WebXRHandTracking | null = null;
  const floorContactHands = new Set<string>();
  let fingerPath: {
    handedness: 'left' | 'right';
    robot: TransformNode | null;
    placement: boolean;
  } | null = null;

  function isTabletopInteractionMode() {
    return getARScale() < getARScaleRange().max;
  }

  function getFacingYaw(direction: Vector3): number | null {
    pathRoot.computeWorldMatrix(true);
    const localDirection = Vector3.TransformNormal(
      direction,
      Matrix.Invert(pathRoot.getWorldMatrix())
    );
    if (localDirection.x * localDirection.x + localDirection.z * localDirection.z < 1e-6) return null;
    return Math.atan2(localDirection.x, localDirection.z);
  }

  function getHandFacingYaw(handedness: string): number | null {
    if (handedness !== 'left' && handedness !== 'right') return null;
    const hand = handTracking?.getHandByHandedness(handedness);
    if (!hand) return null;
    const wrist = hand.getJointMesh(WebXRHandJoint.WRIST).getAbsolutePosition();
    const middleFinger = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_METACARPAL).getAbsolutePosition();
    return getFacingYaw(middleFinger.subtract(wrist));
  }

  function beginMarcherGrab(
    handedness: string,
    robot: TransformNode,
    point: Vector3,
    source: 'hand' | 'controller',
    rayDistance = 0,
    facingYaw: number | null = null
  ) {
    if ([...marcherGrabs.values()].some((grab) => grab.robot === robot) || robot === fingerPath?.robot) return;
    robot.computeWorldMatrix(true);
    const originalRenderingGroups = new Map<AbstractMesh, number>();
    robot.getChildMeshes().forEach((mesh) => {
      originalRenderingGroups.set(mesh, mesh.renderingGroupId);
      mesh.renderingGroupId = GRABBED_MARCHER_RENDERING_GROUP;
    });
    marcherGrabs.set(handedness, {
      robot, source, rayDistance, originalRenderingGroups,
      offset: robot.getAbsolutePosition().subtract(point),
      originalPosition: robot.position.clone(),
      originalRotationY: robot.rotation.y,
      initialRotationY: robot.rotation.y,
      initialFacingYaw: facingYaw,
    });
    setRobotHeld(robot, true);
    selectRobot(robot);
  }

  function restoreMarcherRendering(grab: MarcherGrab) {
    grab.originalRenderingGroups.forEach((group, mesh) => {
      if (!mesh.isDisposed()) mesh.renderingGroupId = group;
    });
    grab.originalRenderingGroups.clear();
  }

  function moveMarcherGrab(handedness: string, point: Vector3, facingYaw: number | null = null) {
    const grab = marcherGrabs.get(handedness);
    if (!grab || grab.robot.isDisposed()) {
      marcherGrabs.delete(handedness);
      return;
    }
    pathRoot.computeWorldMatrix(true);
    grab.robot.position.copyFrom(Vector3.TransformCoordinates(
      point.add(grab.offset), Matrix.Invert(pathRoot.getWorldMatrix())
    ));
    if (facingYaw !== null && grab.initialFacingYaw !== null) {
      const yawDelta = facingYaw - grab.initialFacingYaw;
      grab.robot.rotation.y = grab.initialRotationY + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    }
  }

  function finishMarcherGrab(handedness: string, commit: boolean) {
    const grab = marcherGrabs.get(handedness);
    marcherGrabs.delete(handedness);
    if (!grab) return;
    restoreMarcherRendering(grab);
    if (grab.robot.isDisposed()) return;
    const field = scene.getMeshByName('field');
    if (!commit || !field) {
      if (handPlacementDrafts.delete(grab.robot)) {
        setRobotHeld(grab.robot, false);
        grab.robot.dispose();
        return;
      }
      grab.robot.position.copyFrom(grab.originalPosition);
      grab.robot.rotation.y = grab.originalRotationY;
      setRobotHeld(grab.robot, false);
      return;
    }
    grab.robot.computeWorldMatrix(true);
    field.computeWorldMatrix(true);
    pathRoot.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(
      grab.robot.getAbsolutePosition(), Matrix.Invert(field.getWorldMatrix())
    );
    local.x = Math.min(FIELD_WIDTH_YARDS / 2, Math.max(-FIELD_WIDTH_YARDS / 2, local.x));
    local.z = Math.min(FIELD_LENGTH_YARDS / 2, Math.max(-FIELD_LENGTH_YARDS / 2, local.z));
    local.y = 0;
    const position = Vector3.TransformCoordinates(
      Vector3.TransformCoordinates(local, field.getWorldMatrix()),
      Matrix.Invert(pathRoot.getWorldMatrix())
    );
    position.y += 0.02;
    const delta = placeRobot(grab.robot, position, scene);
    handPlacementDrafts.delete(grab.robot);
    const oldPath = robotPaths.get(grab.robot);
    if (oldPath) {
      const translated = oldPath.map((point) => point.add(delta));
      robotPaths.set(grab.robot, translated);
      if (robotPathLines.has(grab.robot)) updateRobotPathLine(grab.robot, translated);
      const storedIndex = storedPaths.indexOf(oldPath);
      if (storedIndex >= 0) {
        storedPaths[storedIndex] = translated;
        saveStoredPaths(storedPaths);
      }
    }
    const segment = pathSegmentByRobot.get(grab.robot);
    if (segment) {
      segment.controlPoints = segment.controlPoints.map((point) => point.add(delta));
      refreshSegmentVisuals(segment);
    }
    segments.filter((entry) => entry.kind === 'formation' && entry.robots.includes(grab.robot))
      .forEach(rebuildFormationConnections);
    if (grab.robot === getSelectedRobot()) refreshStepHandles();
  }

  function findMarcherNearHand(point: Vector3, handoffFrom?: string): TransformNode | null {
    let nearest: TransformNode | null = null;
    let nearestDistance = 0.025;
    const handoffRobot = handoffFrom && marcherGrabs.get(handoffFrom)?.source === 'hand'
      ? marcherGrabs.get(handoffFrom)!.robot
      : null;
    scene.meshes.forEach((mesh) => {
      if (!mesh.isEnabled() || !mesh.isVisible || !mesh.isPickable) return;
      const robot = findRobotRoot(mesh);
      if (!robot || robot === fingerPath?.robot) return;
      if (robot !== handoffRobot && [...marcherGrabs.values()].some((grab) => grab.robot === robot)) return;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const distance = Math.hypot(
        Math.max(bounds.minimumWorld.x - point.x, 0, point.x - bounds.maximumWorld.x),
        Math.max(bounds.minimumWorld.y - point.y, 0, point.y - bounds.maximumWorld.y),
        Math.max(bounds.minimumWorld.z - point.z, 0, point.z - bounds.maximumWorld.z)
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = robot;
      }
    });
    return nearest;
  }

  function getFormationFieldPoint(point: Vector3) {
    const field = scene.getMeshByName('field');
    if (!field?.isEnabled()) return null;
    field.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(point, Matrix.Invert(field.getWorldMatrix()));
    local.x = Math.min(FIELD_WIDTH_YARDS / 2, Math.max(-FIELD_WIDTH_YARDS / 2, local.x));
    local.z = Math.min(FIELD_LENGTH_YARDS / 2, Math.max(-FIELD_LENGTH_YARDS / 2, local.z));
    local.y = 0;
    const onField = Vector3.TransformCoordinates(local, field.getWorldMatrix());
    pathRoot.computeWorldMatrix(true);
    const position = Vector3.TransformCoordinates(onField, Matrix.Invert(pathRoot.getWorldMatrix()));
    position.y += 0.02;
    return snapToStepGrid(position);
  }

  function getSidelineDraftPosition(point: Vector3) {
    const field = scene.getMeshByName('field');
    const ground = scene.getMeshByName('outerBase');
    if (!field?.isEnabled() || !ground?.isEnabled()) return null;
    field.computeWorldMatrix(true);
    const fieldPoint = Vector3.TransformCoordinates(point, Matrix.Invert(field.getWorldMatrix()));
    if (Math.abs(fieldPoint.x) <= FIELD_WIDTH_YARDS / 2 ||
      Math.abs(fieldPoint.z) > FIELD_LENGTH_YARDS / 2) return null;

    ground.computeWorldMatrix(true);
    const groundPoint = Vector3.TransformCoordinates(point, Matrix.Invert(ground.getWorldMatrix()));
    const bounds = ground.getBoundingInfo().boundingBox;
    if (groundPoint.x < bounds.minimum.x || groundPoint.x > bounds.maximum.x ||
      groundPoint.z < bounds.minimum.z || groundPoint.z > bounds.maximum.z) return null;

    pathRoot.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(point, Matrix.Invert(pathRoot.getWorldMatrix()));
  }

  function isHandMarcherInteraction(handedness: string, point: Vector3) {
    return marcherPinchHands.has(handedness) ||
      [...marcherGrabs.values()].some((grab) => grab.source === 'hand') ||
      !!findMarcherNearHand(point) || !!getSidelineDraftPosition(point);
  }

  function otherHand(handedness: 'left' | 'right') {
    return handedness === 'left' ? 'right' : 'left';
  }

  function beginFormationPull(handedness: 'left' | 'right', point: Vector3) {
    const from = otherHand(handedness);
    const grab = marcherGrabs.get(from);
    if (grab?.source !== 'hand' || findMarcherNearHand(point, from) !== grab.robot) return false;
    formationPull = {
      anchorHand: from,
      pullHand: handedness,
      robot: grab.robot,
      endPoint: point.clone(),
      pinchOffset: grab.robot.getAbsolutePosition().subtract(point),
      tracedOffsets: [Vector3.Zero()],
      previewRobots: [],
      shapedOffsets: null,
      shapedRotationY: grab.robot.rotation.y,
      floating: false,
      originalGrab: grab,
    };
    marcherPinchHands.add(from);
    marcherPinchHands.add(handedness);
    highlightPendingMarcher(grab.robot);
    return true;
  }

  function getFormationPullControlPoints() {
    const pull = formationPull;
    if (!pull) return [];
    if (pull.shapedOffsets) {
      const rotation = pull.robot.rotation.y - pull.shapedRotationY;
      return pull.shapedOffsets.map((point) =>
        rotateAroundY(point, rotation).add(pull.robot.position)
      );
    }
    pathRoot.computeWorldMatrix(true);
    const end = Vector3.TransformCoordinates(
      pull.endPoint.add(pull.pinchOffset), Matrix.Invert(pathRoot.getWorldMatrix())
    ).subtract(pull.robot.position);
    const last = pull.tracedOffsets[pull.tracedOffsets.length - 1];
    if (Vector3.Distance(last, end) >= pathPointMinDistance) {
      pull.tracedOffsets.push(end.clone());
    }
    const offsets = pull.tracedOffsets.map((point) => point.clone());
    if (Vector3.Distance(offsets[offsets.length - 1], end) > 0.001) offsets.push(end);
    // Close a completed loop, but not a tiny movement near the starting pinch.
    if (offsets.length >= 5 && end.length() <= pathPointMinDistance &&
      offsets.some((point) => point.length() >= pathPointMinDistance * 4)) {
      offsets[offsets.length - 1] = Vector3.Zero();
    }
    return offsets.map((point) => point.add(pull.robot.position));
  }

  function finishFormationShaping() {
    const pull = formationPull;
    if (!pull || pull.shapedOffsets) return;
    pull.shapedOffsets = getFormationPullControlPoints().map((point) => point.subtract(pull.robot.position));
    pull.shapedRotationY = pull.robot.rotation.y;
    marcherPinchHands.delete(pull.pullHand);
  }

  function updateFormationPullPreview() {
    const pull = formationPull;
    if (!pull) return;
    const grab = pull.floating ? pull.originalGrab : marcherGrabs.get(pull.anchorHand);
    if (!grab || grab.robot !== pull.robot || pull.robot.isDisposed()) {
      finishFormationPull(false);
      return;
    }
    const points = getFormationPoints(getFormationPullControlPoints());
    const previewCount = points.length - 1;
    while (pull.previewRobots.length > previewCount) {
      pull.previewRobots.pop()!.dispose();
    }
    for (let index = 0; index < previewCount; index++) {
      let robot = pull.previewRobots[index];
      if (!robot) {
        robot = createStandingMarcher(points[index + 1]);
        robot.getChildMeshes().forEach((mesh) => {
          mesh.isPickable = true;
          mesh.renderingGroupId = GRABBED_MARCHER_RENDERING_GROUP;
        });
        pull.previewRobots.push(robot);
        highlightPendingMarcher(robot);
      }
      robot.position.copyFrom(points[index + 1]);
      robot.rotation.y = pull.robot.rotation.y;
    }
  }

  function finishFormationPull(commit: boolean) {
    const pull = formationPull;
    const controlPoints = commit ? getFormationPullControlPoints() : [];
    formationPull = null;
    pendingFormationGlow?.dispose();
    pendingFormationGlow = null;
    if (!pull) return;
    pull.previewRobots.forEach((robot) => robot.dispose());
    marcherPinchHands.delete(pull.pullHand);
    const grab = pull.floating ? pull.originalGrab : marcherGrabs.get(pull.anchorHand);
    if (!grab || grab.robot !== pull.robot) return;
    if (!commit) {
      marcherGrabs.set(pull.anchorHand, pull.originalGrab);
      marcherPinchHands.delete(pull.anchorHand);
      finishMarcherGrab(pull.anchorHand, false);
      return;
    }

    pathRoot.computeWorldMatrix(true);
    const fieldPoints: Vector3[] = [];
    for (const point of controlPoints) {
      const projected = getFormationFieldPoint(Vector3.TransformCoordinates(point, pathRoot.getWorldMatrix()));
      if (!projected) break;
      fieldPoints.push(projected);
    }
    const length = fieldPoints.slice(1).reduce(
      (sum, point, index) => sum + Vector3.Distance(fieldPoints[index], point), 0
    );
    if (fieldPoints.length !== controlPoints.length || length < 0.1) {
      marcherGrabs.set(pull.anchorHand, grab);
      marcherPinchHands.delete(pull.anchorHand);
      finishMarcherGrab(pull.anchorHand, true);
      return;
    }

    marcherGrabs.delete(pull.anchorHand);
    restoreMarcherRendering(grab);
    handPlacementDrafts.delete(pull.robot);
    createHandFormation(pull.robot, fieldPoints);
    setRobotHeld(pull.robot, false);
    selectRobot(pull.robot);
    marcherPinchHands.delete(pull.anchorHand);
  }

  function finishCircleResize(commit: boolean) {
    const resize = circleResize;
    circleResize = null;
    if (!resize) return;
    if (!commit && segments.includes(resize.segment)) {
      resizeCircleFormation(resize.segment, resize.originalControlPoints);
    }
  }

  function updateCircleResize(left: Vector3 | undefined, right: Vector3 | undefined) {
    if (!circleResize) return false;
    if (!left || !right || !segments.includes(circleResize.segment)) {
      finishCircleResize(true);
      return true;
    }
    pathRoot.computeWorldMatrix(true);
    const inverse = Matrix.Invert(pathRoot.getWorldMatrix());
    const leftPoint = Vector3.TransformCoordinates(left, inverse);
    const rightPoint = Vector3.TransformCoordinates(right, inverse);
    const distance = Math.hypot(rightPoint.x - leftPoint.x, rightPoint.z - leftPoint.z);
    if (distance > 0.001) {
      const scale = distance / circleResize.startDistance;
      resizeCircleFormation(circleResize.segment, circleResize.originalControlPoints.map((point) =>
        point.subtract(circleResize!.center).scale(scale).add(circleResize!.center)
      ));
    }
    return true;
  }

  function beginCircleResize(left: Vector3, right: Vector3) {
    if (formationPull || sceneGesture) return false;
    const leftGrab = marcherGrabs.get('left');
    const rightGrab = marcherGrabs.get('right');
    if ((leftGrab && leftGrab.source !== 'hand') || (rightGrab && rightGrab.source !== 'hand')) return false;
    const leftRobot = leftGrab?.robot ?? findMarcherNearHand(left);
    const rightRobot = rightGrab?.robot ?? findMarcherNearHand(right);
    if (!leftRobot || !rightRobot || leftRobot === rightRobot) return false;
    const leftCircle = getMarcherCircle(leftRobot);
    const rightCircle = getMarcherCircle(rightRobot);
    if (!leftCircle || leftCircle.segment !== rightCircle?.segment) return false;
    pathRoot.computeWorldMatrix(true);
    const inverse = Matrix.Invert(pathRoot.getWorldMatrix());
    const leftPoint = Vector3.TransformCoordinates(left, inverse);
    const rightPoint = Vector3.TransformCoordinates(right, inverse);
    const distance = Math.hypot(rightPoint.x - leftPoint.x, rightPoint.z - leftPoint.z);
    if (distance <= 0.001) return false;
    if (leftGrab) finishMarcherGrab('left', false);
    if (rightGrab) finishMarcherGrab('right', false);
    circleResize = {
      segment: leftCircle.segment,
      center: leftCircle.center,
      startDistance: distance,
      originalControlPoints: leftCircle.segment.controlPoints.map((point) => point.clone()),
    };
    for (const handedness of ['left', 'right']) {
      handPinches.set(handedness, true);
      marcherPinchHands.add(handedness);
    }
    selectRobot(leftCircle.segment.robots[0]);
    finishFingerPath(false);
    return true;
  }

  function updateTabletopHands() {
    if (floorCalibrationToggle?.checked || !handTracking) {
      sceneGesture = null;
      finishFormationPull(false);
      finishCircleResize(false);
      return;
    }
    if (circleResize && (
      !handTracking.getHandByHandedness('left') || !handTracking.getHandByHandedness('right')
    )) finishCircleResize(false);
    if (formationPull && (
      (!formationPull.floating && !handTracking.getHandByHandedness(formationPull.anchorHand)) ||
      (!formationPull.shapedOffsets && !handTracking.getHandByHandedness(formationPull.pullHand))
    )) finishFormationPull(false);
    const pinchedPoints = new Map<string, Vector3>();
    for (const handedness of ['left', 'right'] as const) {
      const hand = handTracking.getHandByHandedness(handedness);
      if (!hand) continue;
      const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      const index = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const distance = Vector3.Distance(thumb, index);
      if (distance > 0.002 && distance < (handPinches.get(handedness) ? 0.04 : 0.025)) {
        pinchedPoints.set(handedness, thumb.add(index).scale(0.5));
      }
    }
    const left = pinchedPoints.get('left');
    const right = pinchedPoints.get('right');
    if (formationPull && !formationPull.shapedOffsets &&
      !pinchedPoints.has(formationPull.pullHand)) {
      finishFormationShaping();
    }
    if (updateCircleResize(left, right)) {
      for (const handedness of ['left', 'right'] as const) {
        const pinching = pinchedPoints.has(handedness);
        handPinches.set(handedness, pinching);
        if (!pinching) marcherPinchHands.delete(handedness);
      }
      return;
    }
    if (left && right && beginCircleResize(left, right)) return;
    const marcherHandsBusy = !sceneGesture && (
      formationPull !== null || marcherPinchHands.size > 0 ||
      [...marcherGrabs.values()].some((grab) => grab.source === 'hand')
    );
    if (left && right && !marcherHandsBusy) {
      finishFingerPath(false);
      for (const handedness of ['left', 'right']) {
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, false);
        handPinches.set(handedness, true);
      }
      const distance = Vector3.Distance(left, right);
      if (distance < 0.05) return;
      const midpoint = left.add(right).scale(0.5);
      const yaw = getControllerYaw(left, right);
      if (!sceneGesture) {
        const startScale = getARScale();
        const startRotation = getARRotation();
        const offset = midpoint.subtract(getARPosition());
        offset.y = 0;
        sceneGesture = {
          startSurfaceY: getARSurfaceHeight(), startMidpointY: midpoint.y,
          startDistance: distance, startYaw: yaw, startScale, startRotation,
          localAnchor: rotateAroundY(offset, -startRotation).scale(1 / startScale),
        };
      } else {
        const previousScale = getARScale();
        const scale = setARScale(sceneGesture.startScale * distance / sceneGesture.startDistance);
        const yawDelta = yaw - sceneGesture.startYaw;
        const rotation = sceneGesture.startRotation + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
        setARRotation(rotation);
        setARPosition(midpoint.subtract(rotateAroundY(sceneGesture.localAnchor.scale(scale), rotation)));
        // Keep the field surface at its height so zooming in can't bury or lift it out of view.
        const surfaceHeight = sceneGesture.startSurfaceY + midpoint.y - sceneGesture.startMidpointY;
        sceneGesture.startSurfaceY += setARSurfaceHeightForScaleGesture(previousScale, surfaceHeight) - surfaceHeight;
      }
      return;
    }
    sceneGesture = null;
    for (const handedness of ['left', 'right'] as const) {
      const hand = handTracking.getHandByHandedness(handedness);
      if (!hand) {
        handPinches.delete(handedness);
        marcherPinchHands.delete(handedness);
        if (formationPull && (formationPull.anchorHand === handedness || formationPull.pullHand === handedness)) {
          if ((!formationPull.floating && formationPull.anchorHand === handedness) || !formationPull.shapedOffsets) {
            finishFormationPull(false);
            continue;
          }
        }
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, false);
        continue;
      }
      const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      const index = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const distance = Vector3.Distance(thumb, index);
      const wasPinching = handPinches.get(handedness) ?? false;
      const pinching = distance > 0.002 && distance < (wasPinching ? 0.04 : 0.025);
      handPinches.set(handedness, pinching);
      if (!pinching) {
        marcherPinchHands.delete(handedness);
        if (formationPull?.pullHand === handedness) {
          continue;
        }
        if (formationPull?.anchorHand === handedness) {
          if (formationPull.shapedOffsets) {
            marcherGrabs.delete(handedness);
            formationPull.floating = true;
          } else finishFormationPull(false);
          continue;
        }
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, true);
        continue;
      }
      const point = thumb.add(index).scale(0.5);
      if (!wasPinching && activateHandMenuAtPoint(point)) {
        marcherPinchHands.add(handedness);
        continue;
      }
      if (formationPull?.floating) {
        if (!wasPinching) {
          const robot = findMarcherNearHand(point);
          if (robot === formationPull.robot || (robot && formationPull.previewRobots.includes(robot))) {
            const pull = formationPull;
            pull.anchorHand = handedness;
            pull.pullHand = otherHand(handedness);
            const grab = pull.originalGrab;
            pull.robot.computeWorldMatrix(true);
            grab.offset = pull.robot.getAbsolutePosition().subtract(point);
            grab.initialRotationY = pull.robot.rotation.y;
            grab.initialFacingYaw = getHandFacingYaw(handedness);
            marcherGrabs.set(handedness, grab);
            pull.floating = false;
            marcherPinchHands.add(handedness);
          }
        }
        continue;
      }
      if (formationPull?.pullHand === handedness) {
        if (!formationPull.shapedOffsets) formationPull.endPoint.copyFrom(point);
        continue;
      }
      const facingYaw = getHandFacingYaw(handedness);
      const marcherGrab = marcherGrabs.get(handedness);
      if (marcherGrab?.source === 'hand') {
        moveMarcherGrab(handedness, point, facingYaw);
        continue;
      }
      if (marcherGrab || wasPinching) continue;
      if (beginFormationPull(handedness, point)) {
        continue;
      }
      const robot = findMarcherNearHand(point);
      if (robot) {
        beginMarcherGrab(handedness, robot, point, 'hand', 0, facingYaw);
        marcherPinchHands.add(handedness);
      } else {
        const position = getSidelineDraftPosition(point);
        if (!position) continue;
        const draft = createStandingMarcher(position);
        handPlacementDrafts.add(draft);
        beginMarcherGrab(handedness, draft, point, 'hand', 0, facingYaw);
        marcherPinchHands.add(handedness);
      }
    }
    updateFormationPullPreview();
  }

  function finishFingerPath(commit: boolean) {
    const stroke = fingerPath;
    fingerPath = null;
    if (!stroke) return;
    if (!commit) {
      stroke.robot?.dispose();
      return;
    }
    if (stroke.robot) selectRobot(stroke.robot);
  }

  function getFingerFieldPoint(handedness: 'left' | 'right', touching: boolean) {
    const hand = handTracking?.getHandByHandedness(handedness);
    const field = scene.getMeshByName('field');
    if (!hand || !field || !field.isEnabled() || marcherGrabs.size > 0) return null;
    const finger = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
    const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
    if (Vector3.Distance(finger, thumb) < 0.04) return null;
    field.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(finger, Matrix.Invert(field.getWorldMatrix()));
    if (Math.abs(local.x) > FIELD_WIDTH_YARDS / 2 || Math.abs(local.z) > FIELD_LENGTH_YARDS / 2) return null;
    local.y = 0;
    const contact = Vector3.TransformCoordinates(local, field.getWorldMatrix());
    if (Vector3.Distance(finger, contact) > (touching ? 0.025 : 0.012)) return null;
    pathRoot.computeWorldMatrix(true);
    const point = Vector3.TransformCoordinates(contact, Matrix.Invert(pathRoot.getWorldMatrix()));
    point.y += 0.02;
    return snapToStepGrid(point);
  }

  function updateHandPathDrawing() {
    if (floorCalibrationToggle?.checked || !handTracking || sceneGesture || !isPlacementMode()) {
      finishFingerPath(false);
      return;
    }
    if (fingerPath && floorContactHands.has(fingerPath.handedness)) {
      finishFingerPath(false);
      return;
    }
    if (!fingerPath) {
      for (const handedness of ['left', 'right'] as const) {
        if (floorContactHands.has(handedness)) continue;
        const point = getFingerFieldPoint(handedness, false);
        if (!point) continue;
        fingerPath = {
          handedness,
          robot: null,
          placement: true,
        };
        break;
      }
    }
    const stroke = fingerPath;
    if (!stroke) return;
    const point = getFingerFieldPoint(stroke.handedness, true);
    if (!point) {
      finishFingerPath(true);
      return;
    }
    if (!stroke.robot) stroke.robot = createStandingMarcher(point);
    stroke.robot.position.copyFrom(point);
  }

  function setHandTracking(tracking: WebXRHandTracking | null) {
    finishFingerPath(false);
    finishCircleResize(false);
    floorContactHands.clear();
    finishFormationPull(false);
    [...marcherGrabs.entries()].forEach(([handedness, grab]) => {
      if (grab.source === 'hand') finishMarcherGrab(handedness, false);
    });
    handTracking = tracking;
    sceneGesture = null;
    handPinches.clear();
    marcherPinchHands.clear();
  }

  function setHandFloorContact(handedness: string, touching: boolean) {
    if (touching) {
      floorContactHands.add(handedness);
      if (fingerPath?.handedness === handedness) finishFingerPath(false);
    } else floorContactHands.delete(handedness);
  }

  function consumeFloorCalibrationGesture(handedness: string) {
    handPinches.set(handedness, true);
  }

  scene.onBeforeRenderObservable.add(() => {
    if (floorCalibrationToggle?.checked) {
      sceneGesture = null;
      finishCircleResize(false);
      finishFormationPull(false);
      marcherPinchHands.clear();
      finishFingerPath(false);
      [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, false));
      placementDrafts.forEach((robot) => robot.dispose());
      placementDrafts.clear();
    }
    if (!isTabletopInteractionMode()) {
      [...marcherGrabs.entries()].forEach(([handedness, grab]) => {
        if (grab.source === 'controller') finishMarcherGrab(handedness, false);
      });
    }
  });

  return {
    beginMarcherGrab,
    commitFormation: () => {
      if (formationPull?.shapedOffsets) finishFormationPull(true);
    },
    hasPendingFormation: () => formationPull?.shapedOffsets !== null && formationPull !== null,
    consumeFloorCalibrationGesture,
    finishFingerPath,
    finishMarcherGrab,
    getMarcherGrab: (handedness: string) => marcherGrabs.get(handedness),
    getMarcherGrabHandedness: () => [...marcherGrabs.keys()],
    marcherGrabs,
    isFingerPathPlacement: () => fingerPath?.placement ?? false,
    isHandMarcherInteraction,
    getFacingYaw,
    moveMarcherGrab,
    setHandFloorContact,
    setHandTracking,
    updateHandPathDrawing,
    updateTabletopHands,
  };
}
