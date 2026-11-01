// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { footballFutureGhosts, footballFutureStatus, floorCalibrationToggle } from '../ui/dom';
import { getDrillTransportState, getRobotCounts, getBlankChartPageState } from './robot';
import { createMarcherDragGhost } from './marcherGhost';
import { getFootballPlaybackPosition } from './footballPresentation';
import { buildChartArrowGeometry } from './fieldChartMode';
import { FIELD_SURFACE_Y } from '../field/constants';

export function createFootballFuturePreview(players: readonly TransformNode[], root: TransformNode,
  span: (beat: number) => { startCount: number; endCount: number; label: string } | null) {
  let ghosts: TransformNode[] = [];
  let lines: ReturnType<typeof MeshBuilder.CreateLineSystem> | null = null;
  let arrows: Mesh | null = null;
  let signature = '';
  const material = new StandardMaterial('footballFutureArrowMaterial', scene);
  material.diffuseColor = Color3.FromHexString('#ffe45c');
  material.emissiveColor.copyFrom(material.diffuseColor);
  material.disableLighting = true; material.backFaceCulling = false;
  const clear = () => {
    ghosts.forEach(ghost => ghost.dispose()); ghosts = [];
    lines?.dispose(); lines = null;
    arrows?.dispose(); arrows = null; signature = '';
  };
  const status = (text: string) => {
    if (footballFutureStatus && footballFutureStatus.value !== text) footballFutureStatus.value = text;
  };
  const update = () => {
    const transport = getDrillTransportState();
    const window = span(transport.beat);
    if (!footballFutureGhosts?.checked || transport.playing || floorCalibrationToggle?.checked ||
      getBlankChartPageState() || !window) {
      clear();
      status(!footballFutureGhosts?.checked ? 'Future ghosts off.'
        : transport.playing ? 'Future ghosts hidden during playback; pause to preview.'
        : floorCalibrationToggle?.checked ? 'Finish calibration to preview routes.'
        : getBlankChartPageState() ? 'Finish blank-page placement to preview routes.' : 'No future play remains.');
      return;
    }
    const entries = players.flatMap(robot => {
      const counts = getRobotCounts(robot);
      const first = Math.max(window.startCount, Math.floor(transport.beat));
      const route = counts?.slice(first, window.endCount + 1);
      return !robot.isDisposed() && robot.isEnabled() && route?.length &&
        counts?.[window.endCount] ? [{ robot, route: route.map((count, index) => {
          const position = count.position.clone(), resolved = getFootballPlaybackPosition(robot, first + index);
          if (resolved) { position.x = resolved.x; position.z = resolved.z; }
          return { ...count, position };
        }), end: counts[window.endCount] }] : [];
    });
    const nextSignature = JSON.stringify([window, Math.floor(transport.beat), entries.map(entry => [
      entry.robot.uniqueId, entry.route.map(count => [count.position.x, count.position.y, count.position.z]),
      entry.end.facingY ?? entry.end.rotationY,
    ])]);
    if (signature === nextSignature) return;
    clear(); signature = nextSignature;
    const paths: Vector3[][] = [], moves: { from: Vector3; to: Vector3 }[] = [];
    for (const { robot, route, end } of entries) {
      const color = new Color3(.35, .8, 1);
      const ghost = createMarcherDragGhost(robot, robot, color);
      ghost.name = 'footballFutureGhost'; ghost.parent = root;
      ghost.position.copyFrom(route[route.length - 1].position);
      ghost.rotationQuaternion = Quaternion.FromEulerAngles(0, end.facingY ?? end.rotationY, 0);
      ghost.scaling.copyFrom(robot.scaling); ghosts.push(ghost);
      const path = route.map(count => new Vector3(count.position.x, FIELD_SURFACE_Y + .07, count.position.z));
      if (path.length > 1 && path.some(point => Vector3.DistanceSquared(point, path[0]) > 1e-8)) {
        paths.push(path);
        for (let index = 1; index < path.length; index++) {
          if (index % 4 === 0 || index === path.length - 1) moves.push({ from: path[index - 1], to: path[index] });
        }
      }
    }
    if (paths.length) {
      lines = MeshBuilder.CreateLineSystem('footballFutureRoutes', { lines: paths }, scene);
      lines.parent = root; lines.color = new Color3(.35, .8, 1); lines.isPickable = false;
    }
    const geometry = buildChartArrowGeometry(moves);
    if (geometry.positions.length) {
      arrows = new Mesh('footballFutureArrows', scene);
      const data = new VertexData();
      data.positions = geometry.positions; data.indices = geometry.indices; data.normals = geometry.normals;
      data.applyToMesh(arrows); arrows.parent = root; arrows.material = material; arrows.isPickable = false;
    }
    status(`${window.label}: ${entries.length}/${players.length} destination ghosts with authored routes and gold direction arrows. Holds have ghosts only; these are not collision-free predictions.`);
  };
  const observer = scene.onBeforeRenderObservable.add(update);
  footballFutureGhosts?.addEventListener('change', update);
  update();
  return () => {
    footballFutureGhosts?.removeEventListener('change', update);
    scene.onBeforeRenderObservable.remove(observer); clear(); material.dispose();
    status('Load a football play to preview its routes.');
  };
}
