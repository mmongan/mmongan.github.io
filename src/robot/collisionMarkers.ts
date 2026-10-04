import * as BABYLON from 'babylonjs';

export const COLLISION_MARKER_RADIUS_YARDS = 0.35;

const COLLISION_MARKER_RADIUS_SQUARED = COLLISION_MARKER_RADIUS_YARDS * COLLISION_MARKER_RADIUS_YARDS;
const COLLISION_CONE_HEIGHT_YARDS = 28 / 36;
const COLLISION_CONE_BASE_DIAMETER_YARDS = 14 / 36;
const COLLISION_CONE_TIP_DIAMETER_YARDS = 0.03;
const COLLISION_CONE_BAND_BOTTOM_FRACTION = 0.72;
const COLLISION_CONE_BAND_TOP_FRACTION = 0.86;

interface CollisionInfo {
  robotA: BABYLON.TransformNode;
  robotB: BABYLON.TransformNode;
  countIndexA: number;
  countIndexB: number;
}

export interface CollisionRobotPath {
  robot: BABYLON.TransformNode;
  counts: ReadonlyArray<{ position: BABYLON.Vector3 }>;
}

export interface CollisionMarkerManager {
  setParent: (node: BABYLON.TransformNode) => void;
  seekToMarker: (mesh: BABYLON.AbstractMesh) => boolean;
  refresh: (scene: BABYLON.Scene, paths: Iterable<CollisionRobotPath>) => void;
}

export function createCollisionMarkerManager(seekToCount: (countIndex: number) => void): CollisionMarkerManager {
  let markers: BABYLON.Mesh[] = [];
  let markerParent: BABYLON.TransformNode | null = null;
  let markerMaterial: BABYLON.StandardMaterial | null = null;
  let markerBandMaterial: BABYLON.StandardMaterial | null = null;
  let rebuild: Generator<void> | null = null;
  let rebuildScene: BABYLON.Scene | null = null;
  let rebuildObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  const markerInfo = new Map<BABYLON.Mesh, CollisionInfo>();

  function getMarkerMaterial(scene: BABYLON.Scene): BABYLON.StandardMaterial {
    if (!markerMaterial) {
      markerMaterial = new BABYLON.StandardMaterial("collisionMarkerMaterial", scene);
      markerMaterial.diffuseColor = new BABYLON.Color3(1, 0.45, 0);
      markerMaterial.emissiveColor = new BABYLON.Color3(0.6, 0.27, 0);
      markerMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    }
    return markerMaterial;
  }

  function getBandMaterial(scene: BABYLON.Scene): BABYLON.StandardMaterial {
    if (!markerBandMaterial) {
      markerBandMaterial = new BABYLON.StandardMaterial("collisionMarkerBandMaterial", scene);
      markerBandMaterial.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.95);
      markerBandMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9);
      markerBandMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    }
    return markerBandMaterial;
  }

  function clearMarkers() {
    markers.forEach((marker) => marker.dispose());
    markers = [];
    markerInfo.clear();
  }

  function coneDiameterAt(fraction: number): number {
    return (
      COLLISION_CONE_BASE_DIAMETER_YARDS +
      (COLLISION_CONE_TIP_DIAMETER_YARDS - COLLISION_CONE_BASE_DIAMETER_YARDS) * fraction
    );
  }

  function addMarker(
    scene: BABYLON.Scene,
    position: BABYLON.Vector3,
    robotA: BABYLON.TransformNode,
    robotB: BABYLON.TransformNode,
    countIndexA: number,
    countIndexB: number
  ) {
    const info: CollisionInfo = { robotA, robotB, countIndexA, countIndexB };
    const marker = BABYLON.MeshBuilder.CreateCylinder(
      "robotCollisionMarker",
      {
        height: COLLISION_CONE_HEIGHT_YARDS,
        diameterBottom: COLLISION_CONE_BASE_DIAMETER_YARDS,
        diameterTop: COLLISION_CONE_TIP_DIAMETER_YARDS,
        tessellation: 16,
      },
      scene
    );
    marker.position.copyFrom(position);
    marker.position.y += COLLISION_CONE_HEIGHT_YARDS / 2;
    marker.material = getMarkerMaterial(scene);
    if (markerParent) marker.parent = markerParent;
    markers.push(marker);
    markerInfo.set(marker, info);

    const bandHeight =
      COLLISION_CONE_HEIGHT_YARDS * (COLLISION_CONE_BAND_TOP_FRACTION - COLLISION_CONE_BAND_BOTTOM_FRACTION);
    const band = BABYLON.MeshBuilder.CreateCylinder(
      "robotCollisionMarkerBand",
      {
        height: bandHeight,
        diameterBottom: coneDiameterAt(COLLISION_CONE_BAND_BOTTOM_FRACTION) + 0.01,
        diameterTop: coneDiameterAt(COLLISION_CONE_BAND_TOP_FRACTION) + 0.01,
        tessellation: 16,
      },
      scene
    );
    const bandCenterFraction = (COLLISION_CONE_BAND_BOTTOM_FRACTION + COLLISION_CONE_BAND_TOP_FRACTION) / 2;
    band.position.copyFrom(position);
    band.position.y += COLLISION_CONE_HEIGHT_YARDS * bandCenterFraction;
    band.material = getBandMaterial(scene);
    if (markerParent) band.parent = markerParent;
    markers.push(band);
    markerInfo.set(band, info);
  }

  function* rebuildMarkers(scene: BABYLON.Scene, paths: CollisionRobotPath[]): Generator<void> {
    while (markers.length > 0) {
      const marker = markers.pop()!;
      markerInfo.delete(marker);
      marker.dispose();
      yield;
    }
    clearMarkers();

    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const pathA = paths[i];
        const pathB = paths[j];
        const maxCount = Math.max(pathA.counts.length, pathB.counts.length);
        let wasColliding = false;
        for (let countIndex = 0; countIndex < maxCount; countIndex++) {
          const indexA = Math.min(countIndex, pathA.counts.length - 1);
          const indexB = Math.min(countIndex, pathB.counts.length - 1);
          const positionA = pathA.counts[indexA]?.position;
          const positionB = pathB.counts[indexB]?.position;
          if (!positionA || !positionB) continue;
          const colliding = BABYLON.Vector3.DistanceSquared(positionA, positionB) < COLLISION_MARKER_RADIUS_SQUARED;
          if (colliding && !wasColliding) {
            addMarker(scene, BABYLON.Vector3.Center(positionA, positionB), pathA.robot, pathB.robot, indexA, indexB);
          }
          wasColliding = colliding;
          yield;
        }
      }
    }
  }

  function refresh(scene: BABYLON.Scene, paths: Iterable<CollisionRobotPath>) {
    rebuild = rebuildMarkers(scene, Array.from(paths));
    if (rebuildScene === scene && rebuildObserver) return;
    if (rebuildScene && rebuildObserver) {
      rebuildScene.onAfterRenderObservable.remove(rebuildObserver);
    }
    rebuildScene = scene;
    rebuildObserver = scene.onAfterRenderObservable.add(() => {
      const started = performance.now();
      for (let step = 0; rebuild && step < 16384 && performance.now() - started < 2; step++) {
        if (rebuild.next().done) rebuild = null;
      }
    });
  }

  return {
    setParent(node) {
      markerParent = node;
    },
    seekToMarker(mesh) {
      const info = markerInfo.get(mesh as BABYLON.Mesh);
      if (!info) return false;
      seekToCount(Math.max(info.countIndexA, info.countIndexB));
      return true;
    },
    refresh,
  };
}