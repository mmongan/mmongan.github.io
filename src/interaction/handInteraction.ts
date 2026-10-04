import * as BABYLON from 'babylonjs';
import {
  getARPosition,
  getARScale,
  setARScale,
  setARPosition,
  setARRotation,
  getARScaleRange,
  getARRotation,
  getTabletopCorner,
  setTabletopCornerHandlesVisible,
  isARTabletopModeActive,
} from '../xr/ar';
import { scene } from '../scene/engine';
import { findRobotRoot, placeRobot, setRobotHeld } from '../robot/robot';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { floorCalibrationToggle } from '../ui/dom';
import { getControllerYaw, rotateAroundY } from './controllers';

export interface HandSegment {
  kind: 'formation' | 'path';
  controlPoints: BABYLON.Vector3[];
  line: BABYLON.Mesh;
  moveHandle: BABYLON.Mesh;
  pointHandles: BABYLON.Mesh[];
  copyHandle: BABYLON.Mesh | null;
  robots: BABYLON.TransformNode[];
}

export interface MarcherGrab {
  robot: BABYLON.TransformNode;
  source: 'hand' | 'controller';
  offset: BABYLON.Vector3;
  originalPosition: BABYLON.Vector3;
  rayDistance: number;
}

export interface CornerDrag {
  opposite: BABYLON.Vector3;
  diagonal: BABYLON.Vector3;
  localOpposite: BABYLON.Vector3;
  localCorner: BABYLON.Vector3;
  point: BABYLON.Vector3;
  source: 'hand' | 'controller';
  rayDistance: number;
  offset: BABYLON.Vector3;
}

export interface HandPathDependencies {
  pathRoot: BABYLON.TransformNode;
  robotPaths: Map<BABYLON.TransformNode, BABYLON.Vector3[]>;
  robotPathLines: Map<BABYLON.TransformNode, BABYLON.Mesh>;
  storedPaths: BABYLON.Vector3[][];
  saveStoredPaths: (paths: BABYLON.Vector3[][]) => void;
  pathSegmentByRobot: ReadonlyMap<BABYLON.TransformNode, HandSegment>;
  segments: ReadonlyArray<HandSegment>;
  placementDrafts: Map<string, BABYLON.TransformNode>;
  pathPointMinDistance: number;
  isPlacementMode: () => boolean;
  getSelectedRobot: () => BABYLON.TransformNode | null;
  selectRobot: (robot: BABYLON.TransformNode | null) => void;
  createStandingMarcher: (position: BABYLON.Vector3) => BABYLON.TransformNode;
  updateRobotPathLine: (robot: BABYLON.TransformNode, points: BABYLON.Vector3[]) => void;
  createTubeLine: (
    name: string,
    points: BABYLON.Vector3[],
    color: BABYLON.Color3,
    existingMaterial?: BABYLON.StandardMaterial
  ) => BABYLON.Mesh;
  createSegment: (kind: 'path', points: BABYLON.Vector3[], robots: BABYLON.TransformNode[]) => HandSegment;
  refreshSegmentVisuals: (segment: HandSegment) => void;
  rebuildFormationConnections: (segment: HandSegment) => void;
  refreshStepHandles: () => void;
  snapToStepGrid: (point: BABYLON.Vector3) => BABYLON.Vector3;
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
    updateRobotPathLine,
    createTubeLine,
    createSegment,
    refreshSegmentVisuals,
    rebuildFormationConnections,
    refreshStepHandles,
    snapToStepGrid,
    cancelControllerPathDrawing,
  } = paths;

  const cornerDrags = new Map<string, CornerDrag>();
  let twoCornerGesture: {
    first: CornerDrag;
    second: CornerDrag;
    startDistance: number;
    startYaw: number;
    startScale: number;
    startRotation: number;
    localAnchor: BABYLON.Vector3;
  } | null = null;
  const handPinches = new Map<string, boolean>();
  const marcherGrabs = new Map<string, MarcherGrab>();
  let handTracking: BABYLON.WebXRHandTracking | null = null;
  const floorContactHands = new Set<string>();
  let fingerPath: {
    handedness: 'left' | 'right';
    points: BABYLON.Vector3[];
    robot: BABYLON.TransformNode | null;
    line: BABYLON.Mesh | null;
    placement: boolean;
    previewUpdateTime: number;
    previewPointCount: number;
  } | null = null;

  function isTabletopInteractionMode() {
    return getARScale() < getARScaleRange().max;
  }

  function beginMarcherGrab(
    handedness: string,
    robot: BABYLON.TransformNode,
    point: BABYLON.Vector3,
    source: 'hand' | 'controller',
    rayDistance = 0
  ) {
    if ([...marcherGrabs.values()].some((grab) => grab.robot === robot) || robot === fingerPath?.robot) return;
    robot.computeWorldMatrix(true);
    marcherGrabs.set(handedness, {
      robot, source, rayDistance,
      offset: robot.getAbsolutePosition().subtract(point),
      originalPosition: robot.position.clone(),
    });
    setRobotHeld(robot, true);
    selectRobot(robot);
  }

  function moveMarcherGrab(handedness: string, point: BABYLON.Vector3) {
    const grab = marcherGrabs.get(handedness);
    if (!grab || grab.robot.isDisposed()) {
      marcherGrabs.delete(handedness);
      return;
    }
    pathRoot.computeWorldMatrix(true);
    grab.robot.position.copyFrom(BABYLON.Vector3.TransformCoordinates(
      point.add(grab.offset), BABYLON.Matrix.Invert(pathRoot.getWorldMatrix())
    ));
  }

  function finishMarcherGrab(handedness: string, commit: boolean) {
    const grab = marcherGrabs.get(handedness);
    marcherGrabs.delete(handedness);
    if (!grab || grab.robot.isDisposed()) return;
    const field = scene.getMeshByName('field');
    if (!commit || !field) {
      grab.robot.position.copyFrom(grab.originalPosition);
      setRobotHeld(grab.robot, false);
      return;
    }
    grab.robot.computeWorldMatrix(true);
    field.computeWorldMatrix(true);
    pathRoot.computeWorldMatrix(true);
    const local = BABYLON.Vector3.TransformCoordinates(
      grab.robot.getAbsolutePosition(), BABYLON.Matrix.Invert(field.getWorldMatrix())
    );
    local.x = Math.min(FIELD_WIDTH_YARDS / 2, Math.max(-FIELD_WIDTH_YARDS / 2, local.x));
    local.z = Math.min(FIELD_LENGTH_YARDS / 2, Math.max(-FIELD_LENGTH_YARDS / 2, local.z));
    local.y = 0;
    const position = BABYLON.Vector3.TransformCoordinates(
      BABYLON.Vector3.TransformCoordinates(local, field.getWorldMatrix()),
      BABYLON.Matrix.Invert(pathRoot.getWorldMatrix())
    );
    position.y += 0.02;
    const delta = placeRobot(grab.robot, position, scene);
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

  function findMarcherNearHand(point: BABYLON.Vector3) {
    let nearest: BABYLON.TransformNode | null = null;
    let nearestDistance = 0.025;
    scene.meshes.forEach((mesh) => {
      if (!mesh.isEnabled() || !mesh.isVisible || !mesh.isPickable) return;
      const robot = findRobotRoot(mesh);
      if (!robot || robot === fingerPath?.robot || [...marcherGrabs.values()].some((grab) => grab.robot === robot)) return;
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

  function beginCornerDrag(
    handedness: string,
    handle: BABYLON.AbstractMesh,
    point: BABYLON.Vector3,
    source: 'hand' | 'controller',
    rayDistance = 0
  ) {
    const corner = getTabletopCorner(handle);
    if (!corner) return;
    const localOpposite = new BABYLON.Vector3(-corner.x, corner.y, -corner.z);
    const rotation = getARRotation();
    const scale = getARScale();
    const opposite = getARPosition().add(rotateAroundY(localOpposite.scale(scale), rotation));
    cornerDrags.set(handedness, {
      opposite,
      diagonal: rotateAroundY(corner.subtract(localOpposite), rotation),
      localOpposite,
      localCorner: corner,
      point: point.clone(),
      source,
      rayDistance,
      offset: handle.getAbsolutePosition().subtract(point),
    });
    setTabletopCornerHandlesVisible(true);
  }

  function moveCornerDrag(drag: CornerDrag, point: BABYLON.Vector3) {
    drag.point.copyFrom(point);
  }

  function updateCornerDrags() {
    if (!isARTabletopModeActive()) return;
    const [first, second] = [...cornerDrags.values()];
    if (first && second) {
      const distance = Math.hypot(second.point.x - first.point.x, second.point.z - first.point.z);
      if (distance < 0.02) return;
      const midpoint = first.point.add(second.point).scale(0.5);
      const yaw = getControllerYaw(first.point, second.point);
      if (!twoCornerGesture || twoCornerGesture.first !== first || twoCornerGesture.second !== second) {
        const startScale = getARScale();
        const startRotation = getARRotation();
        twoCornerGesture = {
          first,
          second,
          startDistance: distance,
          startYaw: yaw,
          startScale,
          startRotation,
          localAnchor: rotateAroundY(midpoint.subtract(getARPosition()), -startRotation).scale(1 / startScale),
        };
        return;
      }
      const scale = setARScale(twoCornerGesture.startScale * distance / twoCornerGesture.startDistance);
      const yawDelta = yaw - twoCornerGesture.startYaw;
      const rotation = twoCornerGesture.startRotation + Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
      setARRotation(rotation);
      setARPosition(midpoint.subtract(rotateAroundY(twoCornerGesture.localAnchor.scale(scale), rotation)));
      return;
    }

    if (twoCornerGesture) {
      twoCornerGesture = null;
      if (first) {
        const rotation = getARRotation();
        const scale = getARScale();
        first.opposite = getARPosition().add(rotateAroundY(first.localOpposite.scale(scale), rotation));
        first.diagonal = rotateAroundY(first.localCorner.subtract(first.localOpposite), rotation);
        first.offset = getARPosition().add(rotateAroundY(first.localCorner.scale(scale), rotation)).subtract(first.point);
      }
      return;
    }
    if (!first) return;
    const drag = first;
    const displacement = drag.point.add(drag.offset).subtract(drag.opposite);
    const scale = BABYLON.Vector3.Dot(displacement, drag.diagonal) / drag.diagonal.lengthSquared();
    const clampedScale = setARScale(scale);
    const oppositeOffset = rotateAroundY(drag.localOpposite.scale(clampedScale), getARRotation());
    setARPosition(drag.opposite.subtract(oppositeOffset));
  }

  function updateTabletopHands() {
    if (floorCalibrationToggle?.checked) return;
    if (!handTracking || (!isARTabletopModeActive() && !isTabletopInteractionMode())) return;
    for (const handedness of ['left', 'right'] as const) {
      const hand = handTracking.getHandByHandedness(handedness);
      if (!hand) {
        handPinches.delete(handedness);
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, false);
        if (cornerDrags.get(handedness)?.source === 'hand') cornerDrags.delete(handedness);
        continue;
      }
      const thumb = hand.getJointMesh(BABYLON.WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      const index = hand.getJointMesh(BABYLON.WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const distance = BABYLON.Vector3.Distance(thumb, index);
      const wasPinching = handPinches.get(handedness) ?? false;
      const pinching = distance < (wasPinching ? 0.04 : 0.025);
      handPinches.set(handedness, pinching);
      if (!pinching) {
        if (marcherGrabs.get(handedness)?.source === 'hand') finishMarcherGrab(handedness, true);
        if (cornerDrags.get(handedness)?.source === 'hand') cornerDrags.delete(handedness);
        continue;
      }
      const point = thumb.add(index).scale(0.5);
      const marcherGrab = marcherGrabs.get(handedness);
      if (marcherGrab?.source === 'hand') {
        moveMarcherGrab(handedness, point);
        continue;
      }
      if (marcherGrab) continue;
      const drag = cornerDrags.get(handedness);
      if (drag?.source === 'hand') {
        moveCornerDrag(drag, point);
      } else if (!drag && !wasPinching) {
        const pick = scene.meshes.find((mesh) =>
          getTabletopCorner(mesh) && BABYLON.Vector3.Distance(mesh.getAbsolutePosition(), point) < 0.07
        );
        if (pick) {
          beginCornerDrag(handedness, pick, point, 'hand');
        } else if (isTabletopInteractionMode()) {
          const robot = findMarcherNearHand(point);
          if (robot) beginMarcherGrab(handedness, robot, point, 'hand');
        }
      }
    }
    updateCornerDrags();
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
    if (!hand || !field || !field.isEnabled() || cornerDrags.size > 0 || marcherGrabs.size > 0) return null;
    const finger = hand.getJointMesh(BABYLON.WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
    const thumb = hand.getJointMesh(BABYLON.WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
    if (BABYLON.Vector3.Distance(finger, thumb) < 0.04) return null;
    field.computeWorldMatrix(true);
    const local = BABYLON.Vector3.TransformCoordinates(finger, BABYLON.Matrix.Invert(field.getWorldMatrix()));
    if (Math.abs(local.x) > FIELD_WIDTH_YARDS / 2 || Math.abs(local.z) > FIELD_LENGTH_YARDS / 2) return null;
    local.y = 0;
    const contact = BABYLON.Vector3.TransformCoordinates(local, field.getWorldMatrix());
    if (BABYLON.Vector3.Distance(finger, contact) > (touching ? 0.025 : 0.012)) return null;
    pathRoot.computeWorldMatrix(true);
    const point = BABYLON.Vector3.TransformCoordinates(contact, BABYLON.Matrix.Invert(pathRoot.getWorldMatrix()));
    point.y += 0.02;
    return snapToStepGrid(point);
  }

  function updateHandPathDrawing() {
    if (floorCalibrationToggle?.checked || !handTracking) {
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
      finishFingerPath(cornerDrags.size === 0);
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
    if (!previous || BABYLON.Vector3.Distance(previous, point) >= pathPointMinDistance) stroke.points.push(point);
    const now = performance.now();
    if (stroke.points.length >= 2 && stroke.points.length !== stroke.previewPointCount &&
      (!stroke.line || !isARTabletopModeActive() || now - stroke.previewUpdateTime >= 1000 / 30)) {
      const material = stroke.line?.material as BABYLON.StandardMaterial | undefined;
      stroke.line?.dispose(false, false);
      stroke.line = createTubeLine('fingerPathPreview', stroke.points, new BABYLON.Color3(1, 0.85, 0.2), material);
      stroke.line.isPickable = false;
      stroke.previewUpdateTime = now;
      stroke.previewPointCount = stroke.points.length;
    }
  }

  function setHandTracking(tracking: BABYLON.WebXRHandTracking | null) {
    finishFingerPath(false);
    floorContactHands.clear();
    [...marcherGrabs.entries()].forEach(([handedness, grab]) => {
      if (grab.source === 'hand') finishMarcherGrab(handedness, false);
    });
    handTracking = tracking;
    handPinches.clear();
    cornerDrags.clear();
    twoCornerGesture = null;
    setTabletopCornerHandlesVisible(false);
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
      finishFingerPath(false);
      [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, false));
      placementDrafts.forEach((robot) => robot.dispose());
      placementDrafts.clear();
      cornerDrags.clear();
      twoCornerGesture = null;
      cancelControllerPathDrawing();
    }
    if (!isTabletopInteractionMode()) {
      [...marcherGrabs.keys()].forEach((handedness) => finishMarcherGrab(handedness, false));
    }
    if (!isARTabletopModeActive()) {
      cornerDrags.clear();
      twoCornerGesture = null;
    }
    setTabletopCornerHandlesVisible(cornerDrags.size > 0);
  });

  return {
    beginCornerDrag,
    beginMarcherGrab,
    cancelCornerDrag: (handedness: string) => cornerDrags.delete(handedness),
    consumeFloorCalibrationGesture,
    cornerDrags,
    finishFingerPath,
    finishMarcherGrab,
    getCornerDrag: (handedness: string) => cornerDrags.get(handedness),
    getMarcherGrab: (handedness: string) => marcherGrabs.get(handedness),
    getMarcherGrabHandedness: () => [...marcherGrabs.keys()],
    marcherGrabs,
    isFingerPathPlacement: () => fingerPath?.placement ?? false,
    hasCornerDrags: () => cornerDrags.size > 0,
    moveCornerDrag,
    moveMarcherGrab,
    setHandFloorContact,
    setHandTracking,
    updateCornerDrags,
    updateHandPathDrawing,
    updateTabletopHands,
  };
}
