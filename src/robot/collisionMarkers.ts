import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observer } from '@babylonjs/core/Misc/observable.pure';
import { Scene } from '@babylonjs/core/scene.pure';

export const COLLISION_MARKER_RADIUS_YARDS = 0.35;

const COLLISION_MARKER_RADIUS_SQUARED = COLLISION_MARKER_RADIUS_YARDS * COLLISION_MARKER_RADIUS_YARDS;
const COLLISION_CONE_HEIGHT_YARDS = 28 / 36;
const COLLISION_CONE_BASE_DIAMETER_YARDS = 14 / 36;
const COLLISION_CONE_TIP_DIAMETER_YARDS = 0.03;
const COLLISION_CONE_BAND_BOTTOM_FRACTION = 0.72;
const COLLISION_CONE_BAND_TOP_FRACTION = 0.86;

interface CollisionInfo {
  robotA: TransformNode;
  robotB: TransformNode;
  countIndexA: number;
  countIndexB: number;
}

export interface CollisionRobotPath {
  robot: TransformNode;
  counts: ReadonlyArray<{ position: Vector3 }>;
}

export interface CollisionMarkerManager {
  setParent: (node: TransformNode) => void;
  setVisible: (visible: boolean) => void;
  seekToMarker: (mesh: AbstractMesh) => boolean;
  refresh: (scene: Scene, paths: Iterable<CollisionRobotPath>) => void;
}

export function createCollisionMarkerManager(seekToCount: (countIndex: number) => void): CollisionMarkerManager {
  let markers: Mesh[] = [];
  let markerParent: TransformNode | null = null;
  let markersVisible = true;
  let markerMaterial: StandardMaterial | null = null;
  let markerBandMaterial: StandardMaterial | null = null;
  let rebuild: Generator<void> | null = null;
  let rebuildScene: Scene | null = null;
  let rebuildObserver: Observer<Scene> | null = null;
  const markerInfo = new Map<Mesh, CollisionInfo>();

  function getMarkerMaterial(scene: Scene): StandardMaterial {
    if (!markerMaterial) {
      markerMaterial = new StandardMaterial("collisionMarkerMaterial", scene);
      markerMaterial.diffuseColor = new Color3(1, 0.45, 0);
      markerMaterial.emissiveColor = new Color3(0.6, 0.27, 0);
      markerMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    }
    return markerMaterial;
  }

  function getBandMaterial(scene: Scene): StandardMaterial {
    if (!markerBandMaterial) {
      markerBandMaterial = new StandardMaterial("collisionMarkerBandMaterial", scene);
      markerBandMaterial.diffuseColor = new Color3(0.95, 0.95, 0.95);
      markerBandMaterial.emissiveColor = new Color3(0.9, 0.9, 0.9);
      markerBandMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
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
    scene: Scene,
    position: Vector3,
    robotA: TransformNode,
    robotB: TransformNode,
    countIndexA: number,
    countIndexB: number
  ) {
    const info: CollisionInfo = { robotA, robotB, countIndexA, countIndexB };
    const marker = MeshBuilder.CreateCylinder(
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
    marker.setEnabled(markersVisible);
    if (markerParent) marker.parent = markerParent;
    markers.push(marker);
    markerInfo.set(marker, info);

    const bandHeight =
      COLLISION_CONE_HEIGHT_YARDS * (COLLISION_CONE_BAND_TOP_FRACTION - COLLISION_CONE_BAND_BOTTOM_FRACTION);
    const band = MeshBuilder.CreateCylinder(
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
    band.setEnabled(markersVisible);
    if (markerParent) band.parent = markerParent;
    markers.push(band);
    markerInfo.set(band, info);
  }

  function* rebuildMarkers(scene: Scene, paths: CollisionRobotPath[]): Generator<void> {
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
          const colliding = Vector3.DistanceSquared(positionA, positionB) < COLLISION_MARKER_RADIUS_SQUARED;
          if (colliding && !wasColliding) {
            addMarker(scene, Vector3.Center(positionA, positionB), pathA.robot, pathB.robot, indexA, indexB);
          }
          wasColliding = colliding;
          yield;
        }
      }
    }
  }

  function refresh(scene: Scene, paths: Iterable<CollisionRobotPath>) {
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
    setVisible(visible) {
      markersVisible = visible;
      markers.forEach((marker) => marker.setEnabled(visible));
    },
    seekToMarker(mesh) {
      const info = markerInfo.get(mesh as Mesh);
      if (!info) return false;
      seekToCount(Math.max(info.countIndexA, info.countIndexB));
      return true;
    },
    refresh,
  };
}