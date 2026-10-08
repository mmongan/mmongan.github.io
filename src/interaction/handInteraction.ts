import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
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
  setARSurfaceHeight,
  isARTabletopModeActive,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { findRobotRoot, placeRobot, setRobotHeld } from '../robot/robot';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { floorCalibrationToggle } from '../ui/dom';
import { getControllerYaw, rotateAroundY } from './controllers';

export interface HandSegment {
  kind: 'formation' | 'path';
  controlPoints: Vector3[];
  line: Mesh;
  moveHandle: Mesh;
  pointHandles: Mesh[];
  rotationHandles: Mesh[];
  copyHandle: Mesh | null;
  robots: TransformNode[];
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
  createHandFormation: (anchorRobot: TransformNode, start: Vector3, end: Vector3) => void;
  updateRobotPathLine: (robot: TransformNode, points: Vector3[]) => void;
  createTubeLine: (
    name: string,
    points: Vector3[],
    color: Color3,
    existingMaterial?: StandardMaterial
  ) => Mesh;
  createSegment: (kind: 'path', points: Vector3[], robots: TransformNode[]) => HandSegment;
  refreshSegmentVisuals: (segment: HandSegment) => void;
  rebuildFormationConnections: (segment: HandSegment) => void;
  refreshStepHandles: () => void;
  snapToStepGrid: (point: Vector3) => Vector3;
  cancelControllerPathDrawing: () => void;
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
    updateRobotPathLine,
    createTubeLine,
    createSegment,
    refreshSegmentVisuals,
    rebuildFormationConnections,
    refreshStepHandles,
    snapToStepGrid,
    cancelControllerPathDrawing,
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
  let formationPull: {
    anchorHand: 'left' | 'right';
    pullHand: 'left' | 'right';
    robot: TransformNode;
    endPoint: Vector3;
  } | null = null;
  const handPlacementDrafts = new Set<TransformNode>();
  let handTracking: WebXRHandTracking | null = null;
  const floorContactHands = new Set<string>();
  let fingerPath: {
    handedness: 'left' | 'right';
    points: Vector3[];
    robot: TransformNode | null;
    line: Mesh | null;
    placement: boolean;
    previewUpdateTime: number;
    previewPointCount: number;
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
    marcherGrabs.set(handedness, {
      robot, source, rayDistance,
      offset: robot.getAbsolutePosition().subtract(point),
      originalPosition: robot.position.clone(),
      originalRotationY: robot.rotation.y,
      initialRotationY: robot.rotation.y,
      initialFacingYaw: facingYaw,
    });
    setRobotHeld(robot, true);
    selectRobot(robot);
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
    if (!grab || grab.robot.isDisposed()) return;
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

  function getPinchPlacementPoint(point: Vector3) {
    const field = scene.getMeshByName('field');
    if (!field?.isEnabled()) return null;
    field.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(point, Matrix.Invert(field.getWorldMatrix()));
    if (Math.abs(local.x) > FIELD_WIDTH_YARDS / 2 || Math.abs(local.z) > FIELD_LENGTH_YARDS / 2) return null;
    local.y = 0;
    const contact = Vector3.TransformCoordinates(local, field.getWorldMatrix());
    if (Vector3.Distance(point, contact) > 0.15) return null;
    pathRoot.computeWorldMatrix(true);
    const position = Vector3.TransformCoordinates(contact, Matrix.Invert(pathRoot.getWorldMatrix()));
    position.y += 0.02;
    return snapToStepGrid(position);
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

  function getHandDraftPosition(point: Vector3) {
    pathRoot.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(point, Matrix.Invert(pathRoot.getWorldMatrix()));
  }

  function isHandMarcherInteraction(handedness: string, point: Vector3) {
    return marcherPinchHands.has(handedness) ||
      [...marcherGrabs.values()].some((grab) => grab.source === 'hand') ||
      !!findMarcherNearHand(point) || (isPlacementMode() && !!getPinchPlacementPoint(point));
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
    };
    marcherPinchHands.add(from);
    marcherPinchHands.add(handedness);
    return true;
  }

  function finishFormationPull(commit: boolean) {
    const pull = formationPull;
    formationPull = null;
    if (!pull) return;
    marcherPinchHands.delete(pull.pullHand);
    const grab = marcherGrabs.get(pull.anchorHand);
    if (!grab || grab.robot !== pull.robot) return;
    if (!commit) {
      marcherPinchHands.delete(pull.anchorHand);
      finishMarcherGrab(pull.anchorHand, false);
      return;
    }

    const start = getFormationFieldPoint(pull.robot.getAbsolutePosition());
    const end = getFormationFieldPoint(pull.endPoint);
    if (!start || !end || Vector3.Distance(start, end) < 0.1) {
      marcherPinchHands.delete(pull.anchorHand);
      finishMarcherGrab(pull.anchorHand, true);
      return;
    }

    marcherGrabs.delete(pull.anchorHand);
    handPlacementDrafts.delete(pull.robot);
    createHandFormation(pull.robot, start, end);
    setRobotHeld(pull.robot, false);
    selectRobot(pull.robot);
    marcherPinchHands.delete(pull.anchorHand);
  }

  function updateTabletopHands() {
    if (floorCalibrationToggle?.checked || !handTracking) {
      sceneGesture = null;
      finishFormationPull(false);
      return;
    }
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
    const marcherHandsBusy = !sceneGesture && (
      marcherPinchHands.size > 0 || [...marcherGrabs.values()].some((grab) => grab.source === 'hand')
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
        const scale = setARScale(sceneGesture.startScale * distance / sceneGesture.startDistance);
        const yawDelta = yaw - sceneGesture.startYaw;
        const rotation = sceneGesture.startRotation + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
        setARRotation(rotation);
        setARPosition(midpoint.subtract(rotateAroundY(sceneGesture.localAnchor.scale(scale), rotation)));
        // Keep the field surface at its height so zooming in can't bury or lift it out of view.
        setARSurfaceHeight(sceneGesture.startSurfaceY + midpoint.y - sceneGesture.startMidpointY);
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
          finishFormationPull(false);
          continue;
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
          finishFormationPull(true);
          continue;
        }
        if (formationPull?.anchorHand === handedness) continue;
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, true);
        continue;
      }
      const point = thumb.add(index).scale(0.5);
      if (formationPull?.pullHand === handedness) {
        formationPull.endPoint.copyFrom(point);
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
        const draft = createStandingMarcher(getHandDraftPosition(point));
        handPlacementDrafts.add(draft);
        beginMarcherGrab(handedness, draft, point, 'hand', 0, facingYaw);
        marcherPinchHands.add(handedness);
      }
    }
  }

  function finishFingerPath(commit: boolean) {
    const stroke = fingerPath;
    fingerPath = null;
    if (!stroke) return;
    stroke.line?.dispose(false, true);
    if (!commit) {
      stroke.robot?.dispose();
      return;
    }
    if (stroke.placement) {
      if (stroke.robot) selectRobot(stroke.robot);
    } else if (stroke.robot && stroke.points.length >= 2) {
      robotPaths.set(stroke.robot, stroke.points);
      createSegment('path', stroke.points, [stroke.robot]);
      selectRobot(stroke.robot);
      storedPaths.push(stroke.points);
      saveStoredPaths(storedPaths);
    } else {
      stroke.robot?.dispose();
    }
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
    if (floorCalibrationToggle?.checked || !handTracking || sceneGesture) {
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
          points: [],
          robot: null,
          line: null,
          placement: isPlacementMode(),
          previewUpdateTime: -Infinity,
          previewPointCount: 0,
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
    if (!stroke.placement) {
      const movement = point.subtract(stroke.robot.position);
      if (Math.hypot(movement.x, movement.z) > 0.01) {
        stroke.robot.rotation.y = Math.atan2(movement.x, movement.z);
      }
    }
    stroke.robot.position.copyFrom(point);
    if (stroke.placement) {
      stroke.points = [point];
      return;
    }
    const previous = stroke.points[stroke.points.length - 1];
    if (!previous || Vector3.Distance(previous, point) >= pathPointMinDistance) stroke.points.push(point);
    const now = performance.now();
    if (stroke.points.length >= 2 && stroke.points.length !== stroke.previewPointCount &&
      (!stroke.line || !isARTabletopModeActive() || now - stroke.previewUpdateTime >= 1000 / 30)) {
      const material = stroke.line?.material as StandardMaterial | undefined;
      stroke.line?.dispose(false, false);
      stroke.line = createTubeLine('fingerPathPreview', stroke.points, new Color3(1, 0.85, 0.2), material);
      stroke.line.isPickable = false;
      stroke.previewUpdateTime = now;
      stroke.previewPointCount = stroke.points.length;
    }
  }

  function setHandTracking(tracking: WebXRHandTracking | null) {
    finishFingerPath(false);
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
      marcherPinchHands.clear();
      finishFingerPath(false);
      [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, false));
      placementDrafts.forEach((robot) => robot.dispose());
      placementDrafts.clear();
      cancelControllerPathDrawing();
    }
    if (!isTabletopInteractionMode()) {
      [...marcherGrabs.entries()].forEach(([handedness, grab]) => {
        if (grab.source === 'controller') finishMarcherGrab(handedness, false);
      });
    }
  });

  return {
    beginMarcherGrab,
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
