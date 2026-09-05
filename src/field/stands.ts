import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';
import { FIELD_WIDTH_YARDS, STAND_CONFIGS } from './constants';

const ROW_HEIGHT = 0.35;
const ROW_DEPTH = 0.65;
const CONCOURSE_GAP = 0.9;
const STAND_GROUND_Y = -0.51;

export function createStands(): { updateStands: (level: string) => void } {
  const standsMat = new BABYLON.StandardMaterial("standsMat", scene);
  standsMat.diffuseColor = new BABYLON.Color3(0.62, 0.63, 0.67);
  standsMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);

  const benchMat = new BABYLON.StandardMaterial("benchMat", scene);
  benchMat.diffuseColor = new BABYLON.Color3(0.78, 0.79, 0.82);
  benchMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const supportMat = new BABYLON.StandardMaterial("supportMat", scene);
  supportMat.diffuseColor = new BABYLON.Color3(0.28, 0.29, 0.32);
  supportMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const standsGroup = new BABYLON.Mesh("stands", scene);

  // Builds one terraced tier as a hollow staircase profile (riser face + tread),
  // not a solid filled wedge, so it reads as bleacher steps instead of a building.
  function buildBleacherTier(
    side: number,
    rows: number,
    standLength: number,
    baseOffset: number,
    startY: number,
    parent: BABYLON.Mesh
  ): number {
    for (let row = 0; row < rows; row++) {
      const stepFrontOffset = baseOffset + row * ROW_DEPTH;
      const riserCenterX = side * (FIELD_WIDTH_YARDS / 2 + stepFrontOffset);
      const treadCenterX = side * (FIELD_WIDTH_YARDS / 2 + stepFrontOffset + ROW_DEPTH / 2);
      const riserTopY = startY + (row + 1) * ROW_HEIGHT;

      const riser = BABYLON.MeshBuilder.CreateBox(
        `standRiser${side}_${startY}_${row}`,
        { width: 0.06, height: ROW_HEIGHT, depth: standLength },
        scene
      );
      riser.position = new BABYLON.Vector3(
        riserCenterX,
        STAND_GROUND_Y + riserTopY - ROW_HEIGHT / 2,
        0
      );
      riser.material = supportMat;
      riser.parent = parent;

      const bench = BABYLON.MeshBuilder.CreateBox(
        `standBench${side}_${startY}_${row}`,
        { width: ROW_DEPTH, height: 0.08, depth: standLength },
        scene
      );
      bench.position = new BABYLON.Vector3(treadCenterX, STAND_GROUND_Y + riserTopY, 0);
      bench.material = row % 2 === 0 ? benchMat : standsMat;
      bench.parent = parent;
    }

    // Solid back wall behind the top row so the stand reads as an enclosed
    // structure from outside instead of showing open space under the seats.
    const tierTopY = startY + rows * ROW_HEIGHT;
    const backWallCenterX = side * (FIELD_WIDTH_YARDS / 2 + baseOffset + rows * ROW_DEPTH + 0.1);
    const backWall = BABYLON.MeshBuilder.CreateBox(
      `standBackWall${side}_${startY}`,
      { width: 0.2, height: tierTopY - startY, depth: standLength },
      scene
    );
    backWall.position = new BABYLON.Vector3(
      backWallCenterX,
      STAND_GROUND_Y + startY + (tierTopY - startY) / 2,
      0
    );
    backWall.material = supportMat;
    backWall.parent = parent;

    return tierTopY;
  }

  function updateStands(level: string) {
    const config = STAND_CONFIGS[level] ?? STAND_CONFIGS.nfl;
    standsGroup.getChildMeshes().forEach((mesh) => mesh.dispose());

    for (const side of [-1, 1]) {
      const lowerTopY = buildBleacherTier(
        side,
        config.rows,
        config.standLength,
        config.offset,
        0,
        standsGroup
      );

      if (config.hasUpperDeck) {
        // Upper deck starts right where the lower bowl's footprint ends, so the
        // concourse wall below it lines up flush with the lower tier's back wall.
        const upperBaseOffset = config.offset + config.rows * ROW_DEPTH;
        const upperSpan = config.upperRows! * ROW_DEPTH;

        const concourseWall = BABYLON.MeshBuilder.CreateBox(
          `concourseWall${side}`,
          { width: upperSpan, height: CONCOURSE_GAP, depth: config.upperStandLength! },
          scene
        );
        concourseWall.position = new BABYLON.Vector3(
          side * (FIELD_WIDTH_YARDS / 2 + upperBaseOffset + upperSpan / 2),
          STAND_GROUND_Y + lowerTopY + CONCOURSE_GAP / 2,
          0
        );
        concourseWall.material = supportMat;
        concourseWall.parent = standsGroup;

        buildBleacherTier(
          side,
          config.upperRows!,
          config.upperStandLength!,
          upperBaseOffset,
          lowerTopY + CONCOURSE_GAP,
          standsGroup
        );
      }
    }
  }

  return { updateStands };
}
