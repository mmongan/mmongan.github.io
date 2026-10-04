import * as BABYLON from 'babylonjs';
import { scene } from '../scene/engine';
import { getARScale, getARScaleRange, isARTabletopModeActive } from '../xr/ar';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS, FIELD_SURFACE_Y, END_ZONE_DEPTH_YARDS, HASH_OFFSETS_YARDS } from './constants';

export interface TurfResult {
  outerBase: BABYLON.Mesh;
  field: BABYLON.Mesh;
  fieldLines: BABYLON.Mesh;
  whiteMaterial: BABYLON.StandardMaterial;
  sidelineMat: BABYLON.StandardMaterial;
  updateFieldLevel: (level: string) => void;
  setTopDownDetailOverride: (enabled: boolean) => void;
}

interface TurfStripeSection {
  index: number;
  mesh: BABYLON.Mesh;
  materials: BABYLON.StandardMaterial[];
  topDownMaterial: BABYLON.StandardMaterial;
}

const YARDS_PER_STRIPE = 5;
const STRIPE_LOD_RESOLUTIONS = [1024, 256, 64];
const FULL_DETAIL_DISTANCE_YARDS = 25;
const MEDIUM_DETAIL_DISTANCE_YARDS = 60;
const AR_FULL_DETAIL_SCALE = 0.5;
const AR_MEDIUM_DETAIL_SCALE = 0.05;
const TOP_DOWN_TEXTURE_RESOLUTION = 256;
const TOP_DOWN_YARD_LINE_WIDTH_YARDS = 0.24;
export const TOP_DOWN_FIELD_MARKING_LAYER_MASK = 0x20000000;

function createStripeMaterial(
  turfCanvas: HTMLCanvasElement,
  stripeIndex: number,
  level: string,
  resolution: number,
  yardLineWidthYards = 0.24
): BABYLON.StandardMaterial {
  const height = Math.round((resolution / FIELD_WIDTH_YARDS) * YARDS_PER_STRIPE);
  const canvas = document.createElement("canvas");
  canvas.width = resolution;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const pixelsPerYard = resolution / FIELD_WIDTH_YARDS;
  const startZ = -FIELD_LENGTH_YARDS / 2 + stripeIndex * YARDS_PER_STRIPE;

  for (let x = 0; x < resolution; x += pixelsPerYard) {
    for (let y = 0; y < height; y += pixelsPerYard) {
      ctx.drawImage(turfCanvas, 0, 0, turfCanvas.width, turfCanvas.height, x, y, pixelsPerYard, pixelsPerYard);
    }
  }

  ctx.fillStyle = stripeIndex % 2 === 0 ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.12)";
  ctx.fillRect(0, 0, resolution, height);

  ctx.strokeStyle = "rgba(250, 250, 250, 0.95)";
  for (let z = -50; z <= 50; z += 5) {
    if (z < startZ || z > startZ + YARDS_PER_STRIPE) continue;
    const lineWidth = (z === 0 ? 0.32 : yardLineWidthYards) * pixelsPerYard;
    let y = ((z - startZ) / YARDS_PER_STRIPE) * height;
    if (z === startZ) y = lineWidth / 2;
    if (z === startZ + YARDS_PER_STRIPE) y = height - lineWidth / 2;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(resolution, y);
    ctx.stroke();
  }

  const hashOffset = HASH_OFFSETS_YARDS[level] ?? HASH_OFFSETS_YARDS.nfl;
  ctx.fillStyle = "rgba(250, 250, 250, 0.95)";
  for (let z = -49; z <= 49; z++) {
    if (z < startZ || z >= startZ + YARDS_PER_STRIPE) continue;
    const y = ((z - startZ) / YARDS_PER_STRIPE) * height;
    for (const x of [-hashOffset, hashOffset]) {
      const px = ((x + FIELD_WIDTH_YARDS / 2) / FIELD_WIDTH_YARDS) * resolution;
      ctx.fillRect(px - 0.35 * pixelsPerYard, y - 0.09 * pixelsPerYard, 0.7 * pixelsPerYard, 0.18 * pixelsPerYard);
    }
  }

  const numberSideOffset = FIELD_WIDTH_YARDS / 2 - 12;
  ctx.fillStyle = "rgba(250, 250, 250, 0.95)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${4 * pixelsPerYard}px Arial`;
  for (let z = -40; z <= 40; z += 10) {
    const yardValue = 50 - Math.abs(z);
    if (yardValue === 50 && z !== 0) continue;
    if (z < startZ - 2 || z > startZ + YARDS_PER_STRIPE + 2) continue;

    const py = ((z - startZ) / YARDS_PER_STRIPE) * height;
    for (const x of [-numberSideOffset, numberSideOffset]) {
      const px = ((x + FIELD_WIDTH_YARDS / 2) / FIELD_WIDTH_YARDS) * resolution;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(x < 0 ? Math.PI / 2 : -Math.PI / 2);
      ctx.scale(-0.58, 1);
      ctx.fillText(String(yardValue), 0, 0);
      ctx.restore();
    }
  }

  const texture = new BABYLON.DynamicTexture(
    `turfStripeTexture${stripeIndex}_${resolution}`,
    canvas,
    scene,
    true,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  texture.update(false);
  texture.anisotropicFilteringLevel = 16;

  const material = new BABYLON.StandardMaterial(`turfStripeMaterial${stripeIndex}_${resolution}`, scene);
  material.diffuseTexture = texture;
  material.specularColor = new BABYLON.Color3(0.08, 0.14, 0.08);
  return material;
}

export function createTurf(): TurfResult {
  const outerBaseThickness = 0.4;
  const outerBase = BABYLON.MeshBuilder.CreateBox(
    "outerBase",
    { width: FIELD_WIDTH_YARDS + 22, depth: FIELD_LENGTH_YARDS + 16, height: outerBaseThickness },
    scene
  );
  outerBase.position.y = -0.8 - outerBaseThickness / 2;

  const outerBaseMat = new BABYLON.StandardMaterial("outerBaseMat", scene);
  outerBaseMat.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
  outerBase.material = outerBaseMat;
  outerBase.checkCollisions = true;

  const turfCanvas = document.createElement("canvas");
  turfCanvas.width = 512;
  turfCanvas.height = 512;
  const turfCtx = turfCanvas.getContext("2d")!;

  const baseGradient = turfCtx.createLinearGradient(0, 0, turfCanvas.width, turfCanvas.height);
  baseGradient.addColorStop(0, "rgb(48, 116, 52)");
  baseGradient.addColorStop(0.5, "rgb(82, 152, 62)");
  baseGradient.addColorStop(1, "rgb(36, 103, 46)");
  turfCtx.fillStyle = baseGradient;
  turfCtx.fillRect(0, 0, turfCanvas.width, turfCanvas.height);

  for (let y = 0; y < turfCanvas.height; y += 4) {
    for (let x = 0; x < turfCanvas.width; x += 4) {
      const variance = Math.random() * 26;
      const green = 110 + variance;
      const red = 60 + Math.random() * 20;
      const blue = 42 + Math.random() * 18;
      turfCtx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      turfCtx.fillRect(x, y, 4, 4);
    }
  }

  // for (let i = 0; i < 2500; i++) {
  //   const x = Math.random() * turfCanvas.width;
  //   const y = Math.random() * turfCanvas.height;
  //   const length = 4 + Math.random() * 10;
  //   const angle = Math.random() * Math.PI;
  //   turfCtx.strokeStyle = `rgba(16, ${66 + Math.random() * 30}, 18, ${0.28 + Math.random() * 0.42})`;
  //   turfCtx.lineWidth = 1 + Math.random() * 1.4;
  //   turfCtx.beginPath();
  //   turfCtx.moveTo(x, y);
  //   turfCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  //   turfCtx.stroke();
  // }

  // for (let i = 0; i < 400; i++) {
  //   const x = Math.random() * turfCanvas.width;
  //   const y = Math.random() * turfCanvas.height;
  //   const radius = 4 + Math.random() * 12;
  //   turfCtx.beginPath();
  //   turfCtx.fillStyle = `rgba(20, 90, 25, ${0.08 + Math.random() * 0.2})`;
  //   turfCtx.arc(x, y, radius, 0, Math.PI * 2);
  //   turfCtx.fill();
  // }

  const field = BABYLON.MeshBuilder.CreateGround(
    "field",
    { width: FIELD_WIDTH_YARDS, height: FIELD_LENGTH_YARDS, subdivisions: 48 },
    scene
  );
  field.position.y = -0.5;
  const fieldMaterial = new BABYLON.StandardMaterial("fieldMat", scene);
  fieldMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.25);
  fieldMaterial.specularColor = new BABYLON.Color3(0.08, 0.14, 0.08);
  field.material = fieldMaterial;

  const stripeCount = FIELD_LENGTH_YARDS / YARDS_PER_STRIPE;
  const turfStripeSections: TurfStripeSection[] = [];

  for (let index = 0; index < stripeCount; index++) {
    const mesh = BABYLON.MeshBuilder.CreateGround(
      `turfStripe${index}`,
      { width: FIELD_WIDTH_YARDS, height: YARDS_PER_STRIPE, subdivisions: 1 },
      scene
    );
    mesh.position = new BABYLON.Vector3(
      0,
      FIELD_SURFACE_Y,
      -FIELD_LENGTH_YARDS / 2 + (index + 0.5) * YARDS_PER_STRIPE
    );
    mesh.isPickable = false;
    const materials = STRIPE_LOD_RESOLUTIONS.map((resolution) =>
      createStripeMaterial(turfCanvas, index, "highschool", resolution)
    );
    const topDownMaterial = createStripeMaterial(
      turfCanvas,
      index,
      "highschool",
      TOP_DOWN_TEXTURE_RESOLUTION,
      TOP_DOWN_YARD_LINE_WIDTH_YARDS
    );
    mesh.material = materials[0];
    turfStripeSections.push({ index, mesh, materials, topDownMaterial });
  }

  const whiteMaterial = new BABYLON.StandardMaterial("fieldLineMat", scene);
  whiteMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
  whiteMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const topDownYardLineMaterial = new BABYLON.StandardMaterial("topDownEmphasizedYardLineMaterial", scene);
  topDownYardLineMaterial.diffuseColor = BABYLON.Color3.White();
  topDownYardLineMaterial.emissiveColor = BABYLON.Color3.White();
  topDownYardLineMaterial.disableLighting = true;
  topDownYardLineMaterial.specularColor = BABYLON.Color3.Black();
  for (let z = -50; z <= 50; z += 5) {
    if ([-25, -15, 15, 25].includes(z)) continue;
    const line = BABYLON.MeshBuilder.CreateBox(
      `topDownYardLine${z}`,
      { width: FIELD_WIDTH_YARDS, height: 0.02, depth: z === 0 ? 0.5 : 0.42 },
      scene
    );
    line.position = new BABYLON.Vector3(0, -0.44, z);
    line.material = topDownYardLineMaterial;
    line.layerMask = TOP_DOWN_FIELD_MARKING_LAYER_MASK;
    line.isPickable = false;
  }
  for (const z of [-25, -15, 15, 25]) {
    const line = BABYLON.MeshBuilder.CreateBox(
      `topDownEmphasizedYardLine${z}`,
      { width: FIELD_WIDTH_YARDS, height: 0.02, depth: 0.36 },
      scene
    );
    line.position = new BABYLON.Vector3(0, -0.44, z);
    line.material = topDownYardLineMaterial;
    line.layerMask = TOP_DOWN_FIELD_MARKING_LAYER_MASK;
    line.isPickable = false;
  }

  let topDownHashMarks: BABYLON.Mesh | null = null;
  function updateTopDownHashMarks(level: string) {
    topDownHashMarks?.dispose();
    const offset = HASH_OFFSETS_YARDS[level] ?? HASH_OFFSETS_YARDS.nfl;
    const hashBoxes: BABYLON.Mesh[] = [];

    for (let z = -49; z <= 49; z++) {
      for (const x of [-offset, offset]) {
        const hashMark = BABYLON.MeshBuilder.CreateBox(
          `topDownHashMark${z}_${x}`,
          { width: 0.7, height: 0.02, depth: 0.36 },
          scene
        );
        hashMark.position = new BABYLON.Vector3(x, -0.45, z);
        hashBoxes.push(hashMark);
      }
    }

    topDownHashMarks = BABYLON.Mesh.MergeMeshes(hashBoxes, true, true, undefined, false, true)!;
    topDownHashMarks.name = `topDownHashMarks_${level}`;
    topDownHashMarks.material = whiteMaterial;
    topDownHashMarks.layerMask = TOP_DOWN_FIELD_MARKING_LAYER_MASK;
    topDownHashMarks.isPickable = false;
  }

  function createTopDownYardNumberMaterial(label: string): BABYLON.StandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.font = "bold 200px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
    ctx.restore();

    const texture = new BABYLON.DynamicTexture(`topDownYardNumberTexture${label}`, canvas, scene, false);
    texture.update(false);
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial(`topDownYardNumberMaterial${label}`, scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = BABYLON.Color3.White();
    material.disableLighting = true;
    material.specularColor = BABYLON.Color3.Black();
    material.backFaceCulling = false;
    return material;
  }

  const numberSideOffset = FIELD_WIDTH_YARDS / 2 - 12;
  for (let z = -40; z <= 40; z += 10) {
    const yardValue = 50 - Math.abs(z);
    if (yardValue === 50 && z !== 0) continue;

    const material = createTopDownYardNumberMaterial(String(yardValue));
    for (const x of [-numberSideOffset, numberSideOffset]) {
      const number = BABYLON.MeshBuilder.CreateGround(
        `topDownYardNumber${yardValue}_${x}`,
        { width: 3, height: 4 },
        scene
      );
      number.position = new BABYLON.Vector3(x, -0.455, z);
      number.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      number.material = material;
      number.layerMask = TOP_DOWN_FIELD_MARKING_LAYER_MASK;
      number.isPickable = false;
    }
  }
  updateTopDownHashMarks("highschool");

  const endZoneMatLeft = new BABYLON.StandardMaterial("endZoneMatLeft", scene);
  endZoneMatLeft.diffuseColor = new BABYLON.Color3(0.025, 0.07, 0.2);
  endZoneMatLeft.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const endZoneMatRight = new BABYLON.StandardMaterial("endZoneMatRight", scene);
  endZoneMatRight.diffuseColor = new BABYLON.Color3(0.035, 0.11, 0.29);
  endZoneMatRight.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const leftEndZone = BABYLON.MeshBuilder.CreateBox(
    "leftEndZone",
    { width: FIELD_WIDTH_YARDS, height: 0.06, depth: END_ZONE_DEPTH_YARDS },
    scene
  );
  leftEndZone.position = new BABYLON.Vector3(0, -0.47, -55);
  leftEndZone.material = endZoneMatLeft;

  const rightEndZone = BABYLON.MeshBuilder.CreateBox(
    "rightEndZone",
    { width: FIELD_WIDTH_YARDS, height: 0.06, depth: END_ZONE_DEPTH_YARDS },
    scene
  );
  rightEndZone.position = new BABYLON.Vector3(0, -0.47, 55);
  rightEndZone.material = endZoneMatRight;

  const fieldLines = new BABYLON.Mesh("fieldLines", scene);

  const goalLineNorth = BABYLON.MeshBuilder.CreateBox(
    "goalLineNorth",
    { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.26 },
    scene
  );
  goalLineNorth.position = new BABYLON.Vector3(0, -0.48, -60);
  goalLineNorth.material = whiteMaterial;

  const goalLineSouth = BABYLON.MeshBuilder.CreateBox(
    "goalLineSouth",
    { width: FIELD_WIDTH_YARDS, height: 0.015, depth: 0.26 },
    scene
  );
  goalLineSouth.position = new BABYLON.Vector3(0, -0.48, 60);
  goalLineSouth.material = whiteMaterial;

  let currentStripeIndex: number | null = null;
  let currentARLodIndex: number | null = null;
  let wasInARMode = false;
  let currentFieldLevel = "highschool";
  let topDownDetailOverride = false;
  let materialsBeforeTopDownOverride: (BABYLON.Material | null)[] | null = null;

  function updateStripeLod() {
    if (getARScale() < getARScaleRange().max) {
      turfStripeSections.forEach((section) => {
        if (section.mesh.material !== section.materials[0]) section.mesh.material = section.materials[0];
      });
      currentStripeIndex = null;
      currentARLodIndex = null;
      return;
    }

    if (topDownDetailOverride) return;

    if (isARTabletopModeActive()) {
      const scale = getARScale();
      const lodIndex = scale >= AR_FULL_DETAIL_SCALE ? 0 : scale >= AR_MEDIUM_DETAIL_SCALE ? 1 : 2;
      if (!wasInARMode || lodIndex !== currentARLodIndex) {
        turfStripeSections.forEach((section) => {
          section.mesh.material = section.materials[lodIndex];
        });
        currentARLodIndex = lodIndex;
      }
      wasInARMode = true;
      return;
    }

    if (wasInARMode) {
      wasInARMode = false;
      currentARLodIndex = null;
      currentStripeIndex = null;
    }

    const camera = scene.activeCamera;
    if (!camera) return;

    const isDesktopCamera = camera.cameraRigMode === BABYLON.Camera.RIG_MODE_NONE;
    const cameraPosition = camera.globalPosition;
    let nearestStripeIndex = turfStripeSections[0].index;
    let nearestDistance = Infinity;

    turfStripeSections.forEach(({ index, mesh }) => {
      mesh.computeWorldMatrix();
      const stripePosition = mesh.getAbsolutePosition();
      const dx = cameraPosition.x - stripePosition.x;
      const dz = cameraPosition.z - stripePosition.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < nearestDistance) {
        nearestDistance = distanceSquared;
        nearestStripeIndex = index;
      }
    });

    if (!isDesktopCamera && nearestStripeIndex === currentStripeIndex) return;
    currentStripeIndex = nearestStripeIndex;

    const engine = scene.getEngine();
    const projection = camera.getProjectionMatrix().m;
    const focalPixels = Math.max(
      Math.abs(projection[0]) * engine.getRenderWidth() * camera.viewport.width,
      Math.abs(projection[5]) * engine.getRenderHeight() * camera.viewport.height
    ) / 2;

    const lodByStripe = turfStripeSections.map(({ index, mesh, materials }) => {
      if (isDesktopCamera) {
        const bounds = mesh.getBoundingInfo().boundingBox;
        const minimum = bounds.minimumWorld;
        const maximum = bounds.maximumWorld;
        const dx = Math.max(minimum.x - cameraPosition.x, 0, cameraPosition.x - maximum.x);
        const dy = Math.max(minimum.y - cameraPosition.y, 0, cameraPosition.y - maximum.y);
        const dz = Math.max(minimum.z - cameraPosition.z, 0, cameraPosition.z - maximum.z);
        const distance = Math.max(camera.minZ, Math.hypot(dx, dy, dz));
        const pixelsPerWorldUnit = camera.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA
          ? focalPixels
          : focalPixels / distance;
        const requiredResolution = (maximum.x - minimum.x) * pixelsPerWorldUnit * 1.25;
        const activeLod = materials.indexOf(mesh.material as BABYLON.StandardMaterial);
        const threshold = activeLod === 0 ? 0.8 : 1;
        if (requiredResolution > STRIPE_LOD_RESOLUTIONS[1] * threshold) return 0;
        const mediumThreshold = activeLod === 1 ? 0.8 : 1;
        return requiredResolution > STRIPE_LOD_RESOLUTIONS[2] * mediumThreshold ? 1 : 2;
      }

      const stripeDistanceYards = Math.abs(index - currentStripeIndex!) * YARDS_PER_STRIPE;
      return stripeDistanceYards <= FULL_DETAIL_DISTANCE_YARDS
        ? 0
        : stripeDistanceYards <= MEDIUM_DETAIL_DISTANCE_YARDS
          ? 1
          : 2;
    });

    if (isDesktopCamera) {
      const desktopLod = lodByStripe.reduce((bestLod, lod) => lod < bestLod ? lod : bestLod);
      lodByStripe.fill(desktopLod);
    }

    for (let z = -40; z <= 40; z += 10) {
      const boundaryIndex = Math.round((z + FIELD_LENGTH_YARDS / 2) / YARDS_PER_STRIPE);
      if (boundaryIndex <= 0 || boundaryIndex >= stripeCount) continue;
      const previousLod = lodByStripe[boundaryIndex - 1];
      const nextLod = lodByStripe[boundaryIndex];
      const matchingLod = previousLod <= nextLod ? previousLod : nextLod;
      lodByStripe[boundaryIndex - 1] = matchingLod;
      lodByStripe[boundaryIndex] = matchingLod;
    }

    turfStripeSections.forEach((section, index) => {
      section.mesh.material = section.materials[lodByStripe[index]];
    });
  }

  function setTopDownDetailOverride(enabled: boolean) {
    if (enabled === topDownDetailOverride) return;
    topDownDetailOverride = enabled;
    if (enabled) {
      materialsBeforeTopDownOverride = turfStripeSections.map((section) => section.mesh.material);
      turfStripeSections.forEach((section) => {
        section.mesh.material = section.topDownMaterial;
      });
    } else {
      turfStripeSections.forEach((section, index) => {
        section.mesh.material = materialsBeforeTopDownOverride?.[index] ?? section.materials[0];
      });
      materialsBeforeTopDownOverride = null;
    }
  }

  function updateFieldLevel(level: string) {
    if (level === currentFieldLevel) return;
    currentFieldLevel = level;
    updateTopDownHashMarks(level);
    turfStripeSections.forEach((section) => {
      section.materials.forEach((material) => material.dispose(false, true));
      section.topDownMaterial.dispose(false, true);
      section.materials = STRIPE_LOD_RESOLUTIONS.map((resolution) =>
        createStripeMaterial(turfCanvas, section.index, level, resolution)
      );
      section.topDownMaterial = createStripeMaterial(
        turfCanvas,
        section.index,
        level,
        TOP_DOWN_TEXTURE_RESOLUTION,
        TOP_DOWN_YARD_LINE_WIDTH_YARDS
      );
      section.mesh.material = section.materials[0];
    });
    currentStripeIndex = null;
  }

  scene.onBeforeRenderObservable.add(updateStripeLod);

  const sidelineMat = new BABYLON.StandardMaterial("sidelineMat", scene);
  sidelineMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.92);

  const leftSideline = BABYLON.MeshBuilder.CreateBox(
    "leftSideline",
    { width: 0.2, height: 0.015, depth: FIELD_LENGTH_YARDS },
    scene
  );
  leftSideline.position = new BABYLON.Vector3(-FIELD_WIDTH_YARDS / 2, -0.48, 0);
  leftSideline.material = whiteMaterial;

  const rightSideline = BABYLON.MeshBuilder.CreateBox(
    "rightSideline",
    { width: 0.2, height: 0.015, depth: FIELD_LENGTH_YARDS },
    scene
  );
  rightSideline.position = new BABYLON.Vector3(FIELD_WIDTH_YARDS / 2, -0.48, 0);
  rightSideline.material = whiteMaterial;

  return {
    outerBase,
    field,
    fieldLines,
    whiteMaterial,
    sidelineMat,
    updateFieldLevel,
    setTopDownDetailOverride,
  };
}
