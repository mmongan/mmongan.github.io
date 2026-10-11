import { Axis } from '@babylonjs/core/Maths/math.axis';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer';
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
  setARSurfaceHeightForScaleGesture,
} from '../xr/ar';
import { scene } from '../scene/engine';
import {
  findRobotRoot,
  getGlobalCountIndex,
  getMarcherRenderingGroup,
  getRobotCounts,
  placeRobot,
  setMarcherRenderingGroup,
  setRobotFacing,
  setRobotHeld,
} from '../robot/robot';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { floorCalibrationToggle } from '../ui/dom';
import {
  beginDrillChartPadGrab,
  endDrillChartPadGrab,
  isDrillChartPadGrabbed,
  isPointNearDrillChartPad,
  getDrillChartButtonNearPoint,
  pickDrillChartPad,
  updateDrillChartPadGrab,
} from '../menu/drillChartPad';
import { getHandMenuHit } from '../menu/handMenu';
import { getControllerYaw, rotateAroundY } from './controllers';

type TrackedHand = NonNullable<ReturnType<WebXRHandTracking['getHandByHandedness']>>;

function getHandGrabMatrix(hand: TrackedHand) {
  return hand.getJointMesh(WebXRHandJoint.WRIST).computeWorldMatrix(true);
}

// Clear the hand/controller depth before drawing held marchers, below XR notices.
const GRABBED_MARCHER_RENDERING_GROUP = 2;
const MARCHER_TWIST_COMMIT_RADIANS = (20 * Math.PI) / 180;

export interface HandSegment {
  kind: 'formation' | 'path';
  controlPoints: Vector3[];
  line: Mesh;
  moveHandle: Mesh;
  pointHandles: Mesh[];
  rotationHandles: Mesh[];
  copyHandle: Mesh | null;
  robots: TransformNode[];
  fitClosedCircle: boolean;
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
  originalRenderingGroup: number | null;
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
  isEraseMode: () => boolean;
  eraseMarcher: (robot: TransformNode) => void;
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
  activateChartButton: (action: NonNullable<ReturnType<typeof getHandMenuHit>>) => void;
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
    isEraseMode,
    eraseMarcher,
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
    activateChartButton,
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
  const fingerPushes = new Set<string>();
  const eraseContacts = new Map<string, Vector3>();
  const padHands = new Set<string>();
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
    deformation: {
      controlIndex: number;
      originalOffsets: Vector3[];
      originalRobotPosition: Vector3;
      grabOffset: Vector3;
      closed: boolean;
    } | null;
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
    const originalRenderingGroup = getMarcherRenderingGroup(robot);
    setMarcherRenderingGroup(robot, GRABBED_MARCHER_RENDERING_GROUP);
    marcherGrabs.set(handedness, {
      robot, source, rayDistance, originalRenderingGroup,
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
    if (grab.originalRenderingGroup === null) return;
    setMarcherRenderingGroup(grab.robot, grab.originalRenderingGroup);
    grab.originalRenderingGroup = null;
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

  // A deliberate wrist twist on a scheduled marcher sets the facing it holds
  // for its route, so auto gait turns the move into a slide or back-march.
  // Twisting back to face the path restores facing the direction of travel.
  function commitMarcherTwist(grab: MarcherGrab) {
    if (grab.source !== 'hand') return;
    const counts = getRobotCounts(grab.robot);
    if (!counts || counts.length < 2) return;
    const yaw = grab.robot.rotation.y;
    const twist = Math.atan2(Math.sin(yaw - grab.initialRotationY), Math.cos(yaw - grab.initialRotationY));
    if (Math.abs(twist) < MARCHER_TWIST_COMMIT_RADIANS) return;
    const travel = counts[Math.min(counts.length - 1, getGlobalCountIndex())].rotationY;
    const fromTravel = Math.atan2(Math.sin(yaw - travel), Math.cos(yaw - travel));
    setRobotFacing(grab.robot, Math.abs(fromTravel) < MARCHER_TWIST_COMMIT_RADIANS ? null : yaw);
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
    commitMarcherTwist(grab);
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

  function getFormationFieldPoint(point: Vector3, snap = true, preserveHeight = false) {
    const field = scene.getMeshByName('field');
    if (!field?.isEnabled()) return null;
    field.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(point, Matrix.Invert(field.getWorldMatrix()));
    local.x = Math.min(FIELD_WIDTH_YARDS / 2, Math.max(-FIELD_WIDTH_YARDS / 2, local.x));
    local.z = Math.min(FIELD_LENGTH_YARDS / 2, Math.max(-FIELD_LENGTH_YARDS / 2, local.z));
    if (!preserveHeight) local.y = 0;
    const onField = Vector3.TransformCoordinates(local, field.getWorldMatrix());
    pathRoot.computeWorldMatrix(true);
    const position = Vector3.TransformCoordinates(onField, Matrix.Invert(pathRoot.getWorldMatrix()));
    position.y += 0.02;
    return snap ? snapToStepGrid(position) : position;
  }

  function getSidelineDraftPosition(point: Vector3) {
    const field = scene.getMeshByName('field');
    const ground = scene.getMeshByName('outerBase');
    if (!field?.isEnabled() || !ground?.isEnabled()) return null;

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

  function isPointOnField(point: Vector3) {
    const field = scene.getMeshByName('field');
    if (!field?.isEnabled()) return true;
    field.computeWorldMatrix(true);
    const local = Vector3.TransformCoordinates(point, Matrix.Invert(field.getWorldMatrix()));
    return Math.abs(local.x) <= FIELD_WIDTH_YARDS / 2 &&
      Math.abs(local.z) <= FIELD_LENGTH_YARDS / 2;
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
      deformation: null,
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
    let end: Vector3 | null = null;
    if (!pull.deformation) {
      pathRoot.computeWorldMatrix(true);
      end = Vector3.TransformCoordinates(
        pull.endPoint.add(pull.pinchOffset), Matrix.Invert(pathRoot.getWorldMatrix())
      ).subtract(pull.robot.position);
      end.y = 0;
      const last = pull.tracedOffsets[pull.tracedOffsets.length - 1];
      if (Vector3.Distance(last, end) >= pathPointMinDistance) {
        pull.tracedOffsets.push(end.clone());
      }
    }
    const offsets = pull.tracedOffsets.map((point) => point.clone());
    if (end) {
      if (Vector3.Distance(offsets[offsets.length - 1], end) > 0.001) offsets.push(end);
      // Close a completed loop, but not a tiny movement near the starting pinch.
      if (offsets.length >= 5 && end.length() <= pathPointMinDistance &&
        offsets.some((point) => point.length() >= pathPointMinDistance * 4)) {
        offsets[offsets.length - 1] = Vector3.Zero();
      }
    }
    return offsets.map((offset) =>
      pull.robot.position.add(new Vector3(offset.x, 0, offset.z))
    );
  }

  function beginFormationDeformation(
    pull: NonNullable<typeof formationPull>,
    robot: TransformNode,
    point: Vector3
  ) {
    const previewIndex = pull.previewRobots.indexOf(robot);
    if (previewIndex < 0) return false;
    pull.tracedOffsets = getFormationPullControlPoints().map((controlPoint) =>
      controlPoint.subtract(pull.robot.position)
    );
    let controlIndex = Math.min(1, pull.tracedOffsets.length - 1);
    let nearestDistance = Number.POSITIVE_INFINITY;
    const robotOffset = robot.position.subtract(pull.robot.position);
    pull.tracedOffsets.forEach((offset, index) => {
      if (index === 0) return;
      const distance = Vector3.Distance(offset, robotOffset);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        controlIndex = index;
      }
    });
    const closed = pull.tracedOffsets.length >= 5 &&
      Vector3.Distance(pull.tracedOffsets[0], pull.tracedOffsets[pull.tracedOffsets.length - 1]) <=
        pathPointMinDistance;
    pathRoot.computeWorldMatrix(true);
    const localPoint = Vector3.TransformCoordinates(point, Matrix.Invert(pathRoot.getWorldMatrix()));
    pull.deformation = {
      controlIndex,
      originalOffsets: pull.tracedOffsets.map((offset) => offset.clone()),
      originalRobotPosition: robot.position.clone(),
      grabOffset: robot.position.subtract(localPoint),
      closed,
    };
    return true;
  }

  function updateFormationDeformation(pull: NonNullable<typeof formationPull>, point: Vector3) {
    const deformation = pull.deformation;
    if (!deformation) return;
    pathRoot.computeWorldMatrix(true);
    const localPoint = Vector3.TransformCoordinates(point, Matrix.Invert(pathRoot.getWorldMatrix()));
    const target = localPoint.add(deformation.grabOffset);
    const delta = target.subtract(deformation.originalRobotPosition);
    const constrainedDelta = new Vector3(delta.x, 0, delta.z);
    if (deformation.closed) {
      const pulledOffset = deformation.originalRobotPosition.subtract(pull.robot.position);
      const axisLength = pulledOffset.length();
      if (axisLength <= 1e-4) return;
      const axis = pulledOffset.scale(1 / axisLength);
      const stretch = Vector3.Dot(constrainedDelta, axis) / axisLength;
      pull.tracedOffsets = deformation.originalOffsets.map((offset, index) =>
        index === 0 || index === deformation.originalOffsets.length - 1
          ? offset.clone()
          : offset.add(axis.scale(Vector3.Dot(offset, axis) * stretch))
      );
      return;
    }
    if (deformation.controlIndex >= deformation.originalOffsets.length - 2) {
      const offsets = deformation.originalOffsets;
      const originalEnd = offsets[offsets.length - 1];
      const chordLength = originalEnd.length();
      if (chordLength > 1e-4) {
        const chordDirection = originalEnd.scale(1 / chordLength);
        const extension = Vector3.Dot(constrainedDelta, chordDirection);
        let maximumSagitta = 0;
        offsets.forEach((offset) => {
          const along = Vector3.Dot(offset, chordDirection);
          maximumSagitta = Math.max(maximumSagitta, Vector3.Distance(
            offset,
            chordDirection.scale(along)
          ));
        });
        if (extension > 0 && maximumSagitta > 1e-4) {
          const straightening = Math.min(1, extension / maximumSagitta);
          const end = originalEnd.add(constrainedDelta);
          const distances = [0];
          for (let index = 1; index < offsets.length; index++) {
            distances.push(distances[index - 1] + Vector3.Distance(offsets[index - 1], offsets[index]));
          }
          const totalLength = distances[distances.length - 1] || 1;
          pull.tracedOffsets = offsets.map((offset, index) => {
            if (index === 0) return offset.clone();
            const straightPoint = end.scale(distances[index] / totalLength);
            return Vector3.Lerp(offset, straightPoint, straightening);
          });
          return;
        }
      }
    }
    const distances = [0];
    for (let index = 1; index < deformation.originalOffsets.length; index++) {
      distances.push(
        distances[index - 1] + Vector3.Distance(
          deformation.originalOffsets[index - 1], deformation.originalOffsets[index]
        )
      );
    }
    const controlDistance = distances[deformation.controlIndex] ?? 0;
    const totalLength = distances[distances.length - 1] ?? 0;
    const influenceRadius = 3.5;
    pull.tracedOffsets = deformation.originalOffsets.map((offset, index) => {
      if (index === 0 || (deformation.closed && index === deformation.originalOffsets.length - 1)) {
        return offset.clone();
      }
      const linearDistance = Math.abs(distances[index] - controlDistance);
      const distance = deformation.closed
        ? Math.min(linearDistance, totalLength - linearDistance)
        : linearDistance;
      const influence = Math.exp(-(distance ** 2) / (2 * influenceRadius ** 2));
      return offset.add(constrainedDelta.scale(influence));
    });
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
        setMarcherRenderingGroup(robot, GRABBED_MARCHER_RENDERING_GROUP);
        robot.getChildMeshes().forEach((mesh) => {
          mesh.isPickable = true;
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
      const projected = getFormationFieldPoint(
        Vector3.TransformCoordinates(point, pathRoot.getWorldMatrix()),
        true,
        true
      );
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
      padHands.forEach((handedness) => endDrillChartPadGrab(handedness));
      padHands.clear();
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
    // Pinches that start on the drill chart pad belong to it (page buttons or
    // a grab) until released, so they never also move marchers or the scene.
    for (const handedness of ['left', 'right'] as const) {
      const hand = handTracking.getHandByHandedness(handedness);
      const point = pinchedPoints.get(handedness);
      if (isDrillChartPadGrabbed(handedness)) {
        if (hand && point) updateDrillChartPadGrab(handedness, getHandGrabMatrix(hand));
        else endDrillChartPadGrab(handedness);
      } else if (hand && point && !(handPinches.get(handedness) ?? false)) {
        const pointer = hand.xrController.pointer;
        const ray = new Ray(pointer.getAbsolutePosition(), pointer.getDirection(Axis.Z), 3);
        const pick = pickDrillChartPad(ray);
        const action = getDrillChartButtonNearPoint(point) ?? (pick ? getHandMenuHit(pick) : null);
        if (action || isPointNearDrillChartPad(point) || pick) {
          padHands.add(handedness);
          if (action) activateChartButton(action);
          else beginDrillChartPadGrab(handedness, getHandGrabMatrix(hand));
        }
      }
      if (!point) padHands.delete(handedness);
      if (padHands.has(handedness)) {
        handPinches.set(handedness, true);
        pinchedPoints.delete(handedness);
      }
    }
    const left = pinchedPoints.get('left');
    const right = pinchedPoints.get('right');
    if (isEraseMode()) {
      sceneGesture = null;
      for (const handedness of ['left', 'right'] as const) {
        if (padHands.has(handedness)) continue;
        const hand = handTracking.getHandByHandedness(handedness);
        const point = pinchedPoints.get(handedness);
        const wasPinching = handPinches.get(handedness) ?? false;
        handPinches.set(handedness, !!point);
        if (!hand) {
          eraseContacts.delete(handedness);
          continue;
        }
        if (point && wasPinching) continue;
        if (point && activateHandMenuAtPoint(point)) continue;
        if (!isEraseMode()) break;
        const finger = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
        const targetPoint = point ?? finger;
        const lastContact = eraseContacts.get(handedness);
        if (!point && lastContact && Vector3.Distance(lastContact, finger) < 0.04) continue;
        eraseContacts.delete(handedness);
        const robot = findMarcherNearHand(targetPoint);
        if (robot && (point || isFingerNearRobot(finger, robot, 0.012))) {
          eraseContacts.set(handedness, targetPoint.clone());
          eraseMarcher(robot);
        }
      }
      return;
    }
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
    const pinchesOutsideField = left && right && !isPointOnField(left) && !isPointOnField(right);
    if (left && right && pinchesOutsideField && !marcherHandsBusy) {
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
      if (padHands.has(handedness)) continue;
      const hand = handTracking.getHandByHandedness(handedness);
      if (!hand) {
        finishFingerPush(handedness);
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
      if (fingerPushes.has(handedness)) {
        if (!pinching) continue;
        finishFingerPush(handedness);
      }
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
        if (!formationPull.shapedOffsets) {
          if (formationPull.deformation) {
            updateFormationDeformation(formationPull, point);
          } else {
            const previewRobot = findMarcherNearHand(point);
            if (!previewRobot || !beginFormationDeformation(formationPull, previewRobot, point)) {
              formationPull.endPoint.copyFrom(point);
            }
          }
        }
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
    if (!hand || !field || !field.isEnabled() || marcherGrabs.size > 0 ||
      formationPull || fingerPushes.has(handedness)) return null;
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

  function finishFingerPush(handedness: string) {
    if (!fingerPushes.delete(handedness)) return;
    finishMarcherGrab(handedness, true);
  }

  function isFingerNearRobot(point: Vector3, robot: TransformNode, tolerance: number) {
    return robot.getChildMeshes().some((mesh) => {
      if (!mesh.isEnabled() || !mesh.isVisible || !mesh.isPickable) return false;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      return Math.hypot(
        Math.max(bounds.minimumWorld.x - point.x, 0, point.x - bounds.maximumWorld.x),
        Math.max(bounds.minimumWorld.y - point.y, 0, point.y - bounds.maximumWorld.y),
        Math.max(bounds.minimumWorld.z - point.z, 0, point.z - bounds.maximumWorld.z)
      ) < tolerance;
    });
  }

  function updateFingerPushes() {
    for (const handedness of ['left', 'right'] as const) {
      const hand = handTracking?.getHandByHandedness(handedness);
      const blocked = !hand || floorCalibrationToggle?.checked || sceneGesture ||
        formationPull || circleResize || floorContactHands.has(handedness) || handPinches.get(handedness);
      if (blocked) {
        finishFingerPush(handedness);
        continue;
      }
      const finger = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      if (Vector3.Distance(finger, thumb) < 0.04) {
        finishFingerPush(handedness);
        continue;
      }
      let grab = fingerPushes.has(handedness) ? marcherGrabs.get(handedness) : undefined;
      if (grab && (grab.robot.isDisposed() || !isFingerNearRobot(finger, grab.robot, 0.04))) {
        finishFingerPush(handedness);
        continue;
      }
      if (!grab) {
        if (marcherGrabs.has(handedness)) continue;
        const robot = findMarcherNearHand(finger);
        if (!robot || handPlacementDrafts.has(robot)) continue;
        robot.computeWorldMatrix(true);
        const onField = getFormationFieldPoint(robot.getAbsolutePosition(), false);
        if (!onField || Vector3.Distance(robot.position, onField) > 0.05 ||
          !isFingerNearRobot(finger, robot, 0.012)) continue;
        beginMarcherGrab(handedness, robot, finger, 'hand');
        grab = marcherGrabs.get(handedness);
        if (!grab) continue;
        restoreMarcherRendering(grab);
        fingerPushes.add(handedness);
      }
      const position = getFormationFieldPoint(finger.add(grab.offset), false);
      if (position) grab.robot.position.copyFrom(position);
    }
  }

  function updateHandPathDrawing() {
    if (isEraseMode()) return;
    updateFingerPushes();
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
    eraseContacts.clear();
    [...fingerPushes].forEach(finishFingerPush);
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
      finishFingerPush(handedness);
      floorContactHands.add(handedness);
      if (fingerPath?.handedness === handedness) finishFingerPath(false);
    } else floorContactHands.delete(handedness);
  }

  function consumeFloorCalibrationGesture(handedness: string) {
    handPinches.set(handedness, true);
  }

  scene.onBeforeRenderObservable.add(() => {
    if (floorCalibrationToggle?.checked) {
      [...fingerPushes].forEach(finishFingerPush);
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
    prepareForErase: () => {
      sceneGesture = null;
      finishFingerPath(true);
      finishCircleResize(true);
      if (formationPull) {
        if (!formationPull.shapedOffsets) finishFormationShaping();
        finishFormationPull(true);
      }
      [...fingerPushes].forEach(finishFingerPush);
      [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, true));
    },
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
