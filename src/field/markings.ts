import * as BABYLON from 'babylonjs';
import { scene } from '../engineScene';
import { FIELD_WIDTH_YARDS, HASH_OFFSETS_YARDS } from './constants';

export function createHashMarks(whiteMaterial: BABYLON.StandardMaterial): {
  updateHashMarks: (level: string) => void;
} {
  const hashMarksGroup = new BABYLON.Mesh("hashMarks", scene);

  function updateHashMarks(level: string) {
    const offset = HASH_OFFSETS_YARDS[level] ?? HASH_OFFSETS_YARDS.nfl;
    hashMarksGroup.getChildMeshes().forEach((mesh) => mesh.dispose());

    // Build all the individual tick marks, then merge them into a single mesh
    // — hundreds of tiny separate boxes is a lot of draw calls for no reason.
    const hashBoxes: BABYLON.Mesh[] = [];
    for (let z = -49; z <= 49; z += 1) {
      for (const x of [-offset, offset]) {
        const hashMark = BABYLON.MeshBuilder.CreateBox(
          `hashMark${z}_${x}`,
          { width: 0.7, height: 0.012, depth: 0.18 },
          scene
        );
        hashMark.position = new BABYLON.Vector3(x, -0.48, z);
        hashBoxes.push(hashMark);
      }
    }

    const mergedHashMarks = BABYLON.Mesh.MergeMeshes(hashBoxes, true, true, undefined, false, true)!;
    mergedHashMarks.name = `hashMarksMerged_${level}`;
    mergedHashMarks.material = whiteMaterial;
    mergedHashMarks.parent = hashMarksGroup;
  }

  return { updateHashMarks };
}

// Yard-number markings at every decade line, offset from each sideline.
export function createYardNumbers(): void {
  const numberCanvas = document.createElement("canvas");
  numberCanvas.width = 256;
  numberCanvas.height = 256;
  const numberCtx = numberCanvas.getContext("2d")!;

  function createYardNumberTexture(label: string) {
    numberCtx.clearRect(0, 0, numberCanvas.width, numberCanvas.height);
    numberCtx.fillStyle = "white";
    numberCtx.font = "bold 200px Arial";
    numberCtx.textAlign = "center";
    numberCtx.textBaseline = "middle";
    // Ground planes viewed from above render text mirrored, so pre-flip it here.
    numberCtx.save();
    numberCtx.translate(numberCanvas.width, 0);
    numberCtx.scale(-1, 1);
    numberCtx.fillText(label, numberCanvas.width / 2, numberCanvas.height / 2 + 10);
    numberCtx.restore();

    const texture = new BABYLON.DynamicTexture(
      `yardNumberTexture${label}_${Math.random()}`,
      numberCanvas,
      scene,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    texture.update(false);
    texture.hasAlpha = true;
    return texture;
  }

  const numberSideOffset = FIELD_WIDTH_YARDS / 2 - 12;
  for (let z = -40; z <= 40; z += 10) {
    const yardValue = 50 - Math.abs(z);
    if (yardValue === 50 && z !== 0) continue;
    const label = String(yardValue);

    for (const x of [-numberSideOffset, numberSideOffset]) {
      const numberMat = new BABYLON.StandardMaterial(`yardNumberMat${z}_${x}`, scene);
      numberMat.diffuseTexture = createYardNumberTexture(label);
      numberMat.opacityTexture = numberMat.diffuseTexture;
      numberMat.disableLighting = true;
      numberMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      numberMat.specularColor = new BABYLON.Color3(0, 0, 0);
      numberMat.backFaceCulling = false;

      const numberPlane = BABYLON.MeshBuilder.CreateGround(
        `yardNumber${z}_${x}`,
        { width: 3, height: 4 },
        scene
      );
      numberPlane.position = new BABYLON.Vector3(x, -0.47, z);
      // Numbers face the nearest sideline, readable when facing across the field.
      numberPlane.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
      numberPlane.material = numberMat;
    }
  }
}
