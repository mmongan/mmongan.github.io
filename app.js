import * as BABYLON from 'babylonjs';

const canvas = document.getElementById("renderCanvas");
const vrButton = document.getElementById("vrButton");
const arButton = document.getElementById("arButton");
const statusText = document.getElementById("statusText");
const fieldLevelSelect = document.getElementById("fieldLevelSelect");

const engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true,
});

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.09, 1);

// Distance haze so the horizon ground fades out instead of ending at a hard edge.
scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
scene.fogColor = new BABYLON.Color3(0.75, 0.88, 0.95);
scene.fogStart = 90;
scene.fogEnd = 260;

// FPS-style fly camera: mouse-drag looks around, WASD moves in the direction
// you're actually facing (including up/down when looking up or down) — the
// standard control scheme for a free-fly/spectator camera in most games.
const camera = new BABYLON.UniversalCamera(
  "camera",
  new BABYLON.Vector3(0, 5, -45),
  scene
);
camera.setTarget(new BABYLON.Vector3(0, 1.4, 0));
camera.attachControl(canvas, true);
camera.keysUp = [87]; // W
camera.keysDown = [83]; // S
camera.keysLeft = [65]; // A
camera.keysRight = [68]; // D
camera.speed = 0.6;
camera.angularSensibility = 4000;
camera.minZ = 0.1;
camera.maxZ = 2000;
camera.inertia = 0.7;

// Arrow keys turn/look around (yaw with left/right, pitch with up/down),
// same idea as mouse-look but for keyboard-only navigation.
const turnKeysHeld = {};
window.addEventListener("keydown", (event) => {
  if (event.key.startsWith("Arrow")) {
    turnKeysHeld[event.key] = true;
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow")) {
    turnKeysHeld[event.key] = false;
  }
});

const TURN_SPEED = 1.6; // radians per second
const PITCH_LIMIT = 1.5;

scene.onBeforeRenderObservable.add(() => {
  const turnAmount = (TURN_SPEED * engine.getDeltaTime()) / 1000;
  if (turnKeysHeld["ArrowLeft"]) camera.rotation.y -= turnAmount;
  if (turnKeysHeld["ArrowRight"]) camera.rotation.y += turnAmount;
  if (turnKeysHeld["ArrowUp"]) camera.rotation.x -= turnAmount;
  if (turnKeysHeld["ArrowDown"]) camera.rotation.x += turnAmount;
  camera.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camera.rotation.x));
});

const hemiLight = new BABYLON.HemisphericLight(
  "hemiLight",
  new BABYLON.Vector3(0, 1, 0),
  scene
);
hemiLight.intensity = 1.1;

const dirLight = new BABYLON.DirectionalLight(
  "dirLight",
  new BABYLON.Vector3(-1, -1, -1),
  scene
);
dirLight.intensity = 0.8;

// Procedural gradient skybox with soft clouds (day sky, no external texture assets needed).
const skyCanvas = document.createElement("canvas");
skyCanvas.width = 512;
skyCanvas.height = 512;
const skyCtx = skyCanvas.getContext("2d");
const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
skyGradient.addColorStop(0, "#1a3d8f");
skyGradient.addColorStop(0.45, "#4d8fd6");
skyGradient.addColorStop(0.75, "#bfe0f2");
skyGradient.addColorStop(1, "#eaf6ff");
skyCtx.fillStyle = skyGradient;
skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

// Scatter soft, fluffy cloud clumps in the blue-sky band (avoids the zenith and the horizon glow).
function drawCloudPuff(cx, cy, radius, alpha) {
  // Draw wrapped copies too so clouds near the left/right edge don't create a seam
  // where the sphere's UV wraps from x=width back to x=0.
  const offsets = [0];
  if (cx - radius < 0) offsets.push(skyCanvas.width);
  if (cx + radius > skyCanvas.width) offsets.push(-skyCanvas.width);

  for (const dx of offsets) {
    const puffGradient = skyCtx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, radius);
    puffGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    puffGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    skyCtx.fillStyle = puffGradient;
    skyCtx.beginPath();
    skyCtx.arc(cx + dx, cy, radius, 0, Math.PI * 2);
    skyCtx.fill();
  }
}

const cloudCount = 14;
for (let i = 0; i < cloudCount; i++) {
  const clusterX = Math.random() * skyCanvas.width;
  const clusterY = skyCanvas.height * (0.16 + Math.random() * 0.38);
  const puffs = 4 + Math.floor(Math.random() * 4);
  for (let p = 0; p < puffs; p++) {
    const offsetX = (Math.random() - 0.5) * 70;
    const offsetY = (Math.random() - 0.5) * 18;
    const radius = 18 + Math.random() * 26;
    drawCloudPuff(clusterX + offsetX, clusterY + offsetY, radius, 0.35 + Math.random() * 0.3);
  }
}

const skyTexture = new BABYLON.DynamicTexture(
  "skyTexture",
  skyCanvas,
  scene,
  false,
  BABYLON.Texture.TRILINEAR_SAMPLINGMODE
);
skyTexture.update(false);
skyTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
skyTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;

const skyMaterial = new BABYLON.StandardMaterial("skyMaterial", scene);
skyMaterial.diffuseTexture = skyTexture;
skyMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
skyMaterial.disableLighting = true;
skyMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
skyMaterial.backFaceCulling = false;
// Never let the huge sky sphere win the depth test and occlude real geometry.
skyMaterial.disableDepthWrite = true;

const skyBox = BABYLON.MeshBuilder.CreateSphere("skyBox", { diameter: 900, segments: 16 }, scene);
skyBox.material = skyMaterial;
skyBox.infiniteDistance = true;
skyBox.applyFog = false;
skyBox.renderingGroupId = 0;

// Large horizon ground so the terrain doesn't just stop at a visible edge.
// A circular disc (radius kept inside the fog-out distance) avoids visible
// square corners poking through the haze at the horizon.
const horizonGround = BABYLON.MeshBuilder.CreateDisc(
  "horizonGround",
  { radius: 240, tessellation: 64 },
  scene
);
horizonGround.rotation.x = Math.PI / 2;
horizonGround.position.y = -0.9;
const horizonGroundMat = new BABYLON.StandardMaterial("horizonGroundMat", scene);
horizonGroundMat.diffuseColor = new BABYLON.Color3(0.22, 0.32, 0.16);
horizonGroundMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
horizonGroundMat.backFaceCulling = false;
horizonGround.material = horizonGroundMat;

const ground = BABYLON.MeshBuilder.CreateGround(
  "ground",
  { width: 80, height: 120 },
  scene
);
ground.position.y = -0.51;

ground.material = new BABYLON.StandardMaterial("groundMat", scene);
ground.material.diffuseColor = new BABYLON.Color3(0.12, 0.18, 0.22);
ground.material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

function createFootballField() {
  const fieldLengthYards = 120;
  const fieldWidthYards = 53.333;
  const endZoneDepthYards = 10;
  // Distance from the field's centerline to each hash mark, by level of play.
  const HASH_OFFSETS_YARDS = {
    nfl: 3.0833,
    college: 6.6667,
    highschool: 8.8889,
  };
  // Distance between goalpost uprights, by level of play.
  const GOAL_POST_WIDTH_YARDS = {
    nfl: 6.1667,
    college: 6.1667,
    highschool: 7.7778,
  };

  const outerBase = BABYLON.MeshBuilder.CreateGround(
    "outerBase",
    { width: fieldWidthYards + 22, height: fieldLengthYards + 16 },
    scene
  );
  outerBase.position.y = -0.8;

  const outerBaseMat = new BABYLON.StandardMaterial("outerBaseMat", scene);
  outerBaseMat.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.22);
  outerBase.material = outerBaseMat;

  const turfCanvas = document.createElement("canvas");
  turfCanvas.width = 512;
  turfCanvas.height = 512;
  const turfCtx = turfCanvas.getContext("2d");

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

  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * turfCanvas.width;
    const y = Math.random() * turfCanvas.height;
    const length = 4 + Math.random() * 10;
    const angle = Math.random() * Math.PI;
    turfCtx.strokeStyle = `rgba(16, ${66 + Math.random() * 30}, 18, ${0.28 + Math.random() * 0.42})`;
    turfCtx.lineWidth = 1 + Math.random() * 1.4;
    turfCtx.beginPath();
    turfCtx.moveTo(x, y);
    turfCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    turfCtx.stroke();
  }

  for (let i = 0; i < 400; i++) {
    const x = Math.random() * turfCanvas.width;
    const y = Math.random() * turfCanvas.height;
    const radius = 4 + Math.random() * 12;
    turfCtx.beginPath();
    turfCtx.fillStyle = `rgba(20, 90, 25, ${0.08 + Math.random() * 0.2})`;
    turfCtx.arc(x, y, radius, 0, Math.PI * 2);
    turfCtx.fill();
  }

  // Tile the grass detail once per yard so blades stay a realistic size.
  const turfTexture = new BABYLON.DynamicTexture(
    "grassTexture",
    turfCanvas,
    scene,
    true,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  turfTexture.update(false);
  turfTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  turfTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  turfTexture.uScale = fieldWidthYards;
  turfTexture.vScale = fieldLengthYards;
  turfTexture.anisotropicFilteringLevel = 16;

  const fieldMaterial = new BABYLON.StandardMaterial("fieldMat", scene);
  fieldMaterial.diffuseTexture = turfTexture;
  fieldMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.95, 0.9);
  fieldMaterial.specularColor = new BABYLON.Color3(0.08, 0.14, 0.08);

  const field = BABYLON.MeshBuilder.CreateGround(
    "field",
    { width: fieldWidthYards, height: fieldLengthYards, subdivisions: 48 },
    scene
  );
  field.position.y = -0.5;
  field.material = fieldMaterial;

  // Mow-stripe bands as a flat, non-tiled overlay so the grass texture never stretches.
  const stripeCanvas = document.createElement("canvas");
  stripeCanvas.width = 4;
  const yardsPerBand = 5;
  const bandCount = fieldLengthYards / yardsPerBand;
  stripeCanvas.height = bandCount * 4;
  const stripeCtx = stripeCanvas.getContext("2d");
  for (let band = 0; band < bandCount; band++) {
    stripeCtx.fillStyle = band % 2 === 0 ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.12)";
    stripeCtx.fillRect(0, band * 4, stripeCanvas.width, 4);
  }

  const stripeTexture = new BABYLON.DynamicTexture(
    "mowStripeTexture",
    stripeCanvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  stripeTexture.update(false);
  stripeTexture.hasAlpha = true;

  const stripeMaterial = new BABYLON.StandardMaterial("stripeMat", scene);
  stripeMaterial.diffuseTexture = stripeTexture;
  stripeMaterial.opacityTexture = stripeTexture;
  stripeMaterial.disableLighting = true;
  stripeMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
  stripeMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

  const mowStripes = BABYLON.MeshBuilder.CreateGround(
    "mowStripes",
    { width: fieldWidthYards, height: fieldLengthYards, subdivisions: 24 },
    scene
  );
  mowStripes.position.y = -0.499;
  mowStripes.material = stripeMaterial;

  const whiteMaterial = new BABYLON.StandardMaterial("fieldLineMat", scene);
  whiteMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
  whiteMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const endZoneMatLeft = new BABYLON.StandardMaterial("endZoneMatLeft", scene);
  endZoneMatLeft.diffuseColor = new BABYLON.Color3(0.16, 0.34, 0.78);
  endZoneMatLeft.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);

  const endZoneMatRight = new BABYLON.StandardMaterial("endZoneMatRight", scene);
  endZoneMatRight.diffuseColor = new BABYLON.Color3(0.75, 0.16, 0.18);
  endZoneMatRight.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);

  const leftEndZone = BABYLON.MeshBuilder.CreateBox(
    "leftEndZone",
    { width: fieldWidthYards, height: 0.06, depth: endZoneDepthYards },
    scene
  );
  leftEndZone.position = new BABYLON.Vector3(0, -0.47, -55);
  leftEndZone.material = endZoneMatLeft;

  const rightEndZone = BABYLON.MeshBuilder.CreateBox(
    "rightEndZone",
    { width: fieldWidthYards, height: 0.06, depth: endZoneDepthYards },
    scene
  );
  rightEndZone.position = new BABYLON.Vector3(0, -0.47, 55);
  rightEndZone.material = endZoneMatRight;

  const fieldLines = new BABYLON.Mesh("fieldLines", scene);

  for (let z = -50; z <= 50; z += 5) {
    const line = BABYLON.MeshBuilder.CreateBox(
      `yardLine${z}`,
      { width: fieldWidthYards, height: 0.05, depth: 0.18 },
      scene
    );
    line.position = new BABYLON.Vector3(0, -0.48, z);
    line.material = whiteMaterial;
    line.parent = fieldLines;

    if (Math.abs(z) === 0) {
      line.scaling.z = 2.4;
    }
  }

  const hashMarksGroup = new BABYLON.Mesh("hashMarks", scene);

  function updateHashMarks(level) {
    const offset = HASH_OFFSETS_YARDS[level] ?? HASH_OFFSETS_YARDS.nfl;
    hashMarksGroup.getChildMeshes().forEach((mesh) => mesh.dispose());

    for (let z = -49; z <= 49; z += 1) {
      for (const x of [-offset, offset]) {
        const hashMark = BABYLON.MeshBuilder.CreateBox(
          `hashMark${z}_${x}`,
          { width: 0.7, height: 0.04, depth: 0.18 },
          scene
        );
        hashMark.position = new BABYLON.Vector3(x, -0.48, z);
        hashMark.material = whiteMaterial;
        hashMark.parent = hashMarksGroup;
      }
    }
  }

  const midfieldLine = BABYLON.MeshBuilder.CreateBox(
    "midfieldLine",
    { width: fieldWidthYards, height: 0.05, depth: 0.32 },
    scene
  );
  midfieldLine.position = new BABYLON.Vector3(0, -0.48, 0);
  midfieldLine.material = whiteMaterial;
  midfieldLine.parent = fieldLines;

  const goalLineNorth = BABYLON.MeshBuilder.CreateBox(
    "goalLineNorth",
    { width: fieldWidthYards, height: 0.05, depth: 0.26 },
    scene
  );
  goalLineNorth.position = new BABYLON.Vector3(0, -0.48, -60);
  goalLineNorth.material = whiteMaterial;

  const goalLineSouth = BABYLON.MeshBuilder.CreateBox(
    "goalLineSouth",
    { width: fieldWidthYards, height: 0.05, depth: 0.26 },
    scene
  );
  goalLineSouth.position = new BABYLON.Vector3(0, -0.48, 60);
  goalLineSouth.material = whiteMaterial;

  const sidelineMat = new BABYLON.StandardMaterial("sidelineMat", scene);
  sidelineMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.92);

  const leftSideline = BABYLON.MeshBuilder.CreateBox(
    "leftSideline",
    { width: 0.2, height: 0.05, depth: fieldLengthYards },
    scene
  );
  leftSideline.position = new BABYLON.Vector3(-fieldWidthYards / 2, -0.48, 0);
  leftSideline.material = whiteMaterial;

  const rightSideline = BABYLON.MeshBuilder.CreateBox(
    "rightSideline",
    { width: 0.2, height: 0.05, depth: fieldLengthYards },
    scene
  );
  rightSideline.position = new BABYLON.Vector3(fieldWidthYards / 2, -0.48, 0);
  rightSideline.material = whiteMaterial;

  // Yard-number markings at every decade line, offset from each sideline.
  const numberCanvas = document.createElement("canvas");
  numberCanvas.width = 256;
  numberCanvas.height = 256;
  const numberCtx = numberCanvas.getContext("2d");

  function createYardNumberTexture(label) {
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

  const numberSideOffset = fieldWidthYards / 2 - 12;
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

  const standsMat = new BABYLON.StandardMaterial("standsMat", scene);
  standsMat.diffuseColor = new BABYLON.Color3(0.62, 0.63, 0.67);
  standsMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);

  const benchMat = new BABYLON.StandardMaterial("benchMat", scene);
  benchMat.diffuseColor = new BABYLON.Color3(0.78, 0.79, 0.82);
  benchMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const supportMat = new BABYLON.StandardMaterial("supportMat", scene);
  supportMat.diffuseColor = new BABYLON.Color3(0.28, 0.29, 0.32);
  supportMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  // Bleacher tier counts and proportions differ a lot by level of play.
  const STAND_CONFIGS = {
    highschool: {
      rows: 6,
      standLength: fieldLengthYards * 0.55,
      offset: 4,
      hasUpperDeck: false,
    },
    college: {
      rows: 11,
      standLength: fieldLengthYards + 4,
      offset: 4,
      hasUpperDeck: false,
    },
    nfl: {
      rows: 13,
      standLength: fieldLengthYards + 18,
      offset: 4,
      hasUpperDeck: true,
      upperRows: 9,
      upperStandLength: fieldLengthYards + 20,
    },
  };

  const ROW_HEIGHT = 0.35;
  const ROW_DEPTH = 0.65;
  const CONCOURSE_GAP = 0.9;
  const STAND_GROUND_Y = -0.51;

  const standsGroup = new BABYLON.Mesh("stands", scene);

  // Builds one terraced tier as a hollow staircase profile (riser face + tread),
  // not a solid filled wedge, so it reads as bleacher steps instead of a building.
  function buildBleacherTier(side, rows, standLength, baseOffset, startY, parent) {
    for (let row = 0; row < rows; row++) {
      const stepFrontOffset = baseOffset + row * ROW_DEPTH;
      const riserCenterX = side * (fieldWidthYards / 2 + stepFrontOffset);
      const treadCenterX = side * (fieldWidthYards / 2 + stepFrontOffset + ROW_DEPTH / 2);
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
    const backWallCenterX = side * (fieldWidthYards / 2 + baseOffset + rows * ROW_DEPTH + 0.1);
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

  function updateStands(level) {
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
        const upperSpan = config.upperRows * ROW_DEPTH;

        const concourseWall = BABYLON.MeshBuilder.CreateBox(
          `concourseWall${side}`,
          { width: upperSpan, height: CONCOURSE_GAP, depth: config.upperStandLength },
          scene
        );
        concourseWall.position = new BABYLON.Vector3(
          side * (fieldWidthYards / 2 + upperBaseOffset + upperSpan / 2),
          STAND_GROUND_Y + lowerTopY + CONCOURSE_GAP / 2,
          0
        );
        concourseWall.material = supportMat;
        concourseWall.parent = standsGroup;

        buildBleacherTier(
          side,
          config.upperRows,
          config.upperStandLength,
          upperBaseOffset,
          lowerTopY + CONCOURSE_GAP,
          standsGroup
        );
      }
    }
  }

  const goalPosts = new BABYLON.Mesh("goalPosts", scene);

  function updateGoalPosts(level) {
    const postHalfWidth = (GOAL_POST_WIDTH_YARDS[level] ?? GOAL_POST_WIDTH_YARDS.nfl) / 2;
    goalPosts.getChildMeshes().forEach((mesh) => mesh.dispose());

    for (const goalZ of [-60, 60]) {
      for (const i of [-1, 1]) {
        const upright = BABYLON.MeshBuilder.CreateCylinder(
          `goalUpright${goalZ}_${i}`,
          { diameter: 0.12, height: 1.6 },
          scene
        );
        upright.position = new BABYLON.Vector3(i * postHalfWidth, 3.4, goalZ);
        upright.material = sidelineMat;
        upright.parent = goalPosts;
      }

      const crossbar = BABYLON.MeshBuilder.CreateBox(
        `goalCrossbar${goalZ}`,
        { width: postHalfWidth * 2, height: 0.12, depth: 0.12 },
        scene
      );
      crossbar.position = new BABYLON.Vector3(0, 2.6, goalZ);
      crossbar.material = sidelineMat;
      crossbar.parent = goalPosts;

      const supportPost = BABYLON.MeshBuilder.CreateCylinder(
        `goalSupportPost${goalZ}`,
        { diameter: 0.16, height: 2.6 },
        scene
      );
      supportPost.position = new BABYLON.Vector3(0, 1.3, goalZ);
      supportPost.material = sidelineMat;
      supportPost.parent = goalPosts;
    }
  }

  function createScoreboard() {
    const boardWidth = 16;
    const boardHeight = 8;
    const boardZ = -68;
    const boardY = 12;

    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 512;
    boardCanvas.height = 256;
    const boardCtx = boardCanvas.getContext("2d");

    boardCtx.fillStyle = "#0a0f0a";
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardCtx.strokeStyle = "#3a4a3a";
    boardCtx.lineWidth = 6;
    boardCtx.strokeRect(3, 3, boardCanvas.width - 6, boardCanvas.height - 6);

    boardCtx.fillStyle = "#ff9d1f";
    boardCtx.font = "bold 34px 'Segoe UI', Arial";
    boardCtx.textAlign = "center";
    boardCtx.fillText("HOME", boardCanvas.width * 0.22, 70);
    boardCtx.fillText("GUEST", boardCanvas.width * 0.78, 70);

    boardCtx.fillStyle = "#f5fff5";
    boardCtx.font = "bold 96px 'Segoe UI', Arial";
    boardCtx.fillText("0", boardCanvas.width * 0.22, 170);
    boardCtx.fillText("0", boardCanvas.width * 0.78, 170);

    boardCtx.fillStyle = "#7fffb0";
    boardCtx.font = "bold 28px 'Segoe UI', Arial";
    boardCtx.fillText("1ST QTR", boardCanvas.width * 0.5, 110);
    boardCtx.fillText("15:00", boardCanvas.width * 0.5, 160);

    const boardTexture = new BABYLON.DynamicTexture(
      "scoreboardTexture",
      boardCanvas,
      scene,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    boardTexture.update(true);

    const boardMaterial = new BABYLON.StandardMaterial("scoreboardMaterial", scene);
    boardMaterial.diffuseTexture = boardTexture;
    boardMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9);
    boardMaterial.disableLighting = true;
    boardMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

    const frameMaterial = new BABYLON.StandardMaterial("scoreboardFrameMaterial", scene);
    frameMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.16, 0.18);
    frameMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const frame = BABYLON.MeshBuilder.CreateBox(
      "scoreboardFrame",
      { width: boardWidth + 0.6, height: boardHeight + 0.6, depth: 0.6 },
      scene
    );
    frame.position = new BABYLON.Vector3(0, boardY, boardZ);
    frame.material = frameMaterial;

    const screen = BABYLON.MeshBuilder.CreatePlane(
      "scoreboardScreen",
      { width: boardWidth, height: boardHeight },
      scene
    );
    screen.position = new BABYLON.Vector3(0, boardY, boardZ + 0.31);
    screen.rotation.y = Math.PI;
    screen.material = boardMaterial;

    const poleMaterial = new BABYLON.StandardMaterial("scoreboardPoleMaterial", scene);
    poleMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.21, 0.23);

    for (const x of [-3, 3]) {
      const pole = BABYLON.MeshBuilder.CreateCylinder(
        `scoreboardPole${x}`,
        { diameter: 0.5, height: boardY - boardHeight / 2 + 0.3 },
        scene
      );
      pole.position = new BABYLON.Vector3(x, (boardY - boardHeight / 2 + 0.3) / 2, boardZ);
      pole.material = poleMaterial;
    }
  }

  function createVideoBoard() {
    const boardWidth = 24;
    const boardHeight = 13;
    const boardZ = 68;
    const boardY = 14;

    const videoCanvas = document.createElement("canvas");
    videoCanvas.width = 640;
    videoCanvas.height = 360;
    const videoCtx = videoCanvas.getContext("2d");

    const bgGradient = videoCtx.createLinearGradient(0, 0, videoCanvas.width, videoCanvas.height);
    bgGradient.addColorStop(0, "#0b1a3d");
    bgGradient.addColorStop(0.5, "#123a6b");
    bgGradient.addColorStop(1, "#0b1a3d");
    videoCtx.fillStyle = bgGradient;
    videoCtx.fillRect(0, 0, videoCanvas.width, videoCanvas.height);

    videoCtx.strokeStyle = "#1c2a4a";
    videoCtx.lineWidth = 8;
    videoCtx.strokeRect(4, 4, videoCanvas.width - 8, videoCanvas.height - 8);

    videoCtx.fillStyle = "#ffcf40";
    videoCtx.font = "bold 78px 'Segoe UI', Arial";
    videoCtx.textAlign = "center";
    videoCtx.textBaseline = "middle";
    videoCtx.fillText("GAME DAY", videoCanvas.width / 2, videoCanvas.height * 0.5);

    const barColors = ["#e63946", "#f1a208", "#2a9d8f", "#457b9d", "#e63946"];
    const barWidth = videoCanvas.width / barColors.length;
    for (let i = 0; i < barColors.length; i++) {
      videoCtx.fillStyle = barColors[i];
      videoCtx.fillRect(i * barWidth, videoCanvas.height - 24, barWidth, 24);
    }

    const videoTexture = new BABYLON.DynamicTexture(
      "videoBoardTexture",
      videoCanvas,
      scene,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    videoTexture.update(true);

    const videoMaterial = new BABYLON.StandardMaterial("videoBoardMaterial", scene);
    videoMaterial.diffuseTexture = videoTexture;
    videoMaterial.emissiveColor = new BABYLON.Color3(0.95, 0.95, 0.95);
    videoMaterial.disableLighting = true;
    videoMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    videoMaterial.backFaceCulling = false;

    const frameMaterial = new BABYLON.StandardMaterial("videoBoardFrameMaterial", scene);
    frameMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.16, 0.18);
    frameMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const frame = BABYLON.MeshBuilder.CreateBox(
      "videoBoardFrame",
      { width: boardWidth + 0.8, height: boardHeight + 0.8, depth: 0.7 },
      scene
    );
    frame.position = new BABYLON.Vector3(0, boardY, boardZ);
    frame.material = frameMaterial;

    const screen = BABYLON.MeshBuilder.CreatePlane(
      "videoBoardScreen",
      { width: boardWidth, height: boardHeight },
      scene
    );
    screen.position = new BABYLON.Vector3(0, boardY, boardZ - 0.36);
    screen.material = videoMaterial;

    const poleMaterial = new BABYLON.StandardMaterial("videoBoardPoleMaterial", scene);
    poleMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.21, 0.23);

    for (const x of [-4.5, 4.5]) {
      const pole = BABYLON.MeshBuilder.CreateCylinder(
        `videoBoardPole${x}`,
        { diameter: 0.6, height: boardY - boardHeight / 2 + 0.3 },
        scene
      );
      pole.position = new BABYLON.Vector3(x, (boardY - boardHeight / 2 + 0.3) / 2, boardZ);
      pole.material = poleMaterial;
    }
  }

  createScoreboard();
  createVideoBoard();

  function setFieldLevel(level) {
    updateHashMarks(level);
    updateGoalPosts(level);
    updateStands(level);
  }

  setFieldLevel("highschool");

  return { setFieldLevel };
}

const footballField = createFootballField();

if (fieldLevelSelect) {
  fieldLevelSelect.addEventListener("change", (event) => {
    footballField.setFieldLevel(event.target.value);
  });
}

const platform = BABYLON.MeshBuilder.CreateCylinder(
  "platform",
  { diameter: 2.5, height: 0.25, tessellation: 24 },
  scene
);
platform.position.y = 0.1;
const platformMat = new BABYLON.StandardMaterial("platformMat", scene);
platformMat.diffuseColor = new BABYLON.Color3(0.3, 0.48, 0.8);
platformMat.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.2);
platform.material = platformMat;

const box = BABYLON.MeshBuilder.CreateBox("box", { size: 0.9 }, scene);
box.position = new BABYLON.Vector3(0, 1.2, 0);
const boxMat = new BABYLON.StandardMaterial("boxMat", scene);
boxMat.diffuseColor = new BABYLON.Color3(1, 0.52, 0.2);
boxMat.emissiveColor = new BABYLON.Color3(0.18, 0.1, 0.03);
box.material = boxMat;

const torus = BABYLON.MeshBuilder.CreateTorus(
  "torus",
  { diameter: 1.4, thickness: 0.24, tessellation: 32 },
  scene
);
torus.position = new BABYLON.Vector3(1.8, 1.6, -1.1);
torus.rotation.x = Math.PI / 2;
const torusMat = new BABYLON.StandardMaterial("torusMat", scene);
torusMat.diffuseColor = new BABYLON.Color3(0.34, 0.92, 0.75);
torusMat.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.18);
torus.material = torusMat;

const moon = BABYLON.MeshBuilder.CreateSphere(
  "moon",
  { diameter: 0.7, segments: 32 },
  scene
);
moon.position = new BABYLON.Vector3(-1.7, 1.6, 1.2);
const moonMat = new BABYLON.StandardMaterial("moonMat", scene);
moonMat.diffuseColor = new BABYLON.Color3(0.88, 0.92, 1);
moonMat.emissiveColor = new BABYLON.Color3(0.15, 0.17, 0.2);
moon.material = moonMat;

const ring = BABYLON.MeshBuilder.CreateTorus(
  "ring",
  { diameter: 2.4, thickness: 0.06, tessellation: 40 },
  scene
);
ring.position = new BABYLON.Vector3(-1.7, 1.5, 1.2);
ring.rotation.x = Math.PI / 2;
ring.rotation.z = Math.PI / 4;
const ringMat = new BABYLON.StandardMaterial("ringMat", scene);
ringMat.diffuseColor = new BABYLON.Color3(0.8, 0.76, 1);
ringMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.25);
ring.material = ringMat;

const globe = BABYLON.MeshBuilder.CreateSphere(
  "globe",
  { diameter: 0.8, segments: 32 },
  scene
);
globe.position = new BABYLON.Vector3(2.2, 0.8, 1.7);
const globeMat = new BABYLON.StandardMaterial("globeMat", scene);
globeMat.diffuseColor = new BABYLON.Color3(0.72, 0.88, 1);
globeMat.emissiveColor = new BABYLON.Color3(0.1, 0.18, 0.25);
globe.material = globeMat;

const interactiveObjects = [
  { mesh: box, label: "Core Cube" },
  { mesh: torus, label: "Orbit Ring" },
  { mesh: moon, label: "Lunar Orb" },
  { mesh: globe, label: "Crystal Sphere" },
];

// AR tabletop mode: shrink the whole stadium onto a table and hide the
// world-scale sky/ground, which only make sense for the full-scale VR view.
const AR_HIDDEN_MESH_NAMES = new Set(["skyBox", "horizonGround", "ground"]);
const AR_SCALE = 0.02;
const contentRootMeshes = scene.meshes.filter((mesh) => !mesh.parent);
const arRoot = new BABYLON.TransformNode("arRoot", scene);
let arTabletopModeActive = false;

function enterARTabletopMode() {
  if (arTabletopModeActive) return;
  arTabletopModeActive = true;
  contentRootMeshes.forEach((mesh) => {
    if (AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setEnabled(false);
    } else {
      mesh.setParent(arRoot);
    }
  });
  arRoot.scaling.setAll(AR_SCALE);
  arRoot.position = new BABYLON.Vector3(0, 0, 0.6);
}

function exitARTabletopMode() {
  if (!arTabletopModeActive) return;
  arTabletopModeActive = false;
  contentRootMeshes.forEach((mesh) => {
    if (AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setEnabled(true);
    } else {
      mesh.setParent(null);
    }
  });
  arRoot.scaling.setAll(1);
  arRoot.position.setAll(0);
}

const selectedState = {
  current: null,
  previous: null,
};

let activeController = null;

function applySelection(mesh, label) {
  if (!mesh) {
    return;
  }

  if (selectedState.previous && selectedState.previous !== mesh) {
    selectedState.previous.scaling = new BABYLON.Vector3(1, 1, 1);
  }

  selectedState.current = mesh;
  selectedState.previous = mesh;
  mesh.scaling = new BABYLON.Vector3(1.18, 1.18, 1.18);
  statusText.textContent = `Selected: ${label} — rotate with the controller`;
}

function attachSelectionActions() {
  interactiveObjects.forEach(({ mesh, label }) => {
    const actionManager = new BABYLON.ActionManager(scene);
    mesh.actionManager = actionManager;

    actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickTrigger,
        () => applySelection(mesh, label)
      )
    );

    actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickDownTrigger,
        () => applySelection(mesh, label)
      )
    );
  });
}

attachSelectionActions();

scene.registerBeforeRender(() => {
  box.rotation.y += 0.014;
  box.rotation.x += 0.012;
  torus.rotation.z += 0.015;
  moon.rotation.y += 0.01;
  ring.rotation.y += 0.01;
  globe.rotation.y += 0.012;
  globe.position.y = 0.8 + Math.sin((performance.now() / 800) % (Math.PI * 2)) * 0.25;

  if (selectedState.current && activeController && activeController.pointer) {
    const rotation = activeController.pointer.absoluteRotationQuaternion;
    if (rotation) {
      selectedState.current.rotationQuaternion = rotation.clone();
    }
  }
});

async function checkSessionSupport(mode) {
  if (!navigator.xr) {
    alert("WebXR is not available in this browser. Use Meta Quest Browser or another WebXR-enabled browser.");
    return false;
  }

  const supported = await navigator.xr.isSessionSupported(mode);
  if (!supported) {
    alert(`The ${mode} session mode is not supported on this device or browser.`);
    return false;
  }

  return true;
}

// Grid overlay shown across the whole floor while aiming to teleport in VR.
const teleportGridCanvas = document.createElement("canvas");
teleportGridCanvas.width = 64;
teleportGridCanvas.height = 64;
const teleportGridCtx = teleportGridCanvas.getContext("2d");
teleportGridCtx.clearRect(0, 0, 64, 64);
teleportGridCtx.strokeStyle = "rgba(120, 220, 255, 0.9)";
teleportGridCtx.lineWidth = 2;
teleportGridCtx.strokeRect(0, 0, 64, 64);

const teleportGridTexture = new BABYLON.DynamicTexture(
  "teleportGridTexture",
  teleportGridCanvas,
  scene,
  false,
  BABYLON.Texture.TRILINEAR_SAMPLINGMODE
);
teleportGridTexture.update(true);
teleportGridTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
teleportGridTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
teleportGridTexture.hasAlpha = true;
teleportGridTexture.uScale = 160;
teleportGridTexture.vScale = 160;

const teleportGridMaterial = new BABYLON.StandardMaterial("teleportGridMaterial", scene);
teleportGridMaterial.diffuseTexture = teleportGridTexture;
teleportGridMaterial.opacityTexture = teleportGridTexture;
teleportGridMaterial.disableLighting = true;
teleportGridMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.9, 1);
teleportGridMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
teleportGridMaterial.backFaceCulling = false;

const teleportGrid = BABYLON.MeshBuilder.CreateDisc(
  "teleportGrid",
  { radius: 240, tessellation: 64 },
  scene
);
teleportGrid.rotation.x = Math.PI / 2;
teleportGrid.position.y = -0.45;
teleportGrid.material = teleportGridMaterial;
teleportGrid.isPickable = false;
teleportGrid.setEnabled(false);

async function startXR(mode) {
  if (!(await checkSessionSupport(mode))) {
    return;
  }

  try {
    const teleportFloorMeshes = ["ground", "field", "horizonGround", "outerBase"]
      .map((name) => scene.getMeshByName(name))
      .filter((mesh) => mesh !== null);

    const xrExperience = await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: mode,
        referenceSpaceType: "local-floor",
        ignoreNativeCamera: false,
      },
      optionalFeatures: true,
      floorMeshes: teleportFloorMeshes,
      inputOptions: {
        doNotLoadControllerMeshes: false,
        disableControllerAnimation: false,
      },
    });

    const teleportation = xrExperience.teleportation;
    if (teleportation) {
      let gridHideTimeout = null;
      teleportation.onTargetMeshPositionUpdatedObservable.add(() => {
        teleportGrid.setEnabled(true);
        clearTimeout(gridHideTimeout);
        gridHideTimeout = setTimeout(() => teleportGrid.setEnabled(false), 150);
      });
    }

    if (mode === "immersive-ar") {
      enterARTabletopMode();
    }

    xrExperience.baseExperience.onStateChangedObservable.add((state) => {
      if (state === BABYLON.WebXRState.NOT_IN_XR) {
        teleportGrid.setEnabled(false);
        exitARTabletopMode();
      }
    });

    xrExperience.input.onControllerAddedObservable.add((controller) => {
      activeController = controller;
      const handedness = controller.inputSource.handedness || "unknown";
      console.log(`Quest 3 controller connected: ${handedness}`);

      const pointerMaterial = new BABYLON.StandardMaterial(
        `pointerMat-${controller.uniqueId}`,
        scene
      );
      pointerMaterial.emissiveColor = new BABYLON.Color3(0.55, 0.9, 1);
      pointerMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.3, 0.5);
      controller.pointer.material = pointerMaterial;

      if (controller.grip) {
        const gripMaterial = new BABYLON.StandardMaterial(
          `gripMat-${controller.uniqueId}`,
          scene
        );
        gripMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.9, 1);
        controller.grip.material = gripMaterial;
      }

      if (controller.motionController?.rootMesh) {
        controller.motionController.rootMesh.scaling = new BABYLON.Vector3(1.04, 1.04, 1.04);
      }
    });
  } catch (error) {
    console.error(`Failed to start ${mode}:`, error);
    alert(`Unable to start ${mode}. Make sure your headset is connected and WebXR is enabled.`);
  }
}

vrButton.addEventListener("click", () => startXR("immersive-vr"));
arButton.addEventListener("click", () => startXR("immersive-ar"));

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});
