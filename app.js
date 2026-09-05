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

const camera = new BABYLON.ArcRotateCamera(
  "camera",
  -Math.PI / 2,
  Math.PI / 3,
  45,
  new BABYLON.Vector3(0, 1.4, 0),
  scene
);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 4;
camera.upperRadiusLimit = 140;
camera.wheelPrecision = 8;

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

  function setHashMarkLevel(level) {
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

  setHashMarkLevel("nfl");

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
  standsMat.diffuseColor = new BABYLON.Color3(0.7, 0.71, 0.75);
  standsMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const leftStand = BABYLON.MeshBuilder.CreateBox(
    "leftStand",
    { width: 12, height: 3.5, depth: fieldLengthYards + 18 },
    scene
  );
  leftStand.position = new BABYLON.Vector3(-fieldWidthYards / 2 - 8, 1.25, 0);
  leftStand.material = standsMat;

  const rightStand = BABYLON.MeshBuilder.CreateBox(
    "rightStand",
    { width: 12, height: 3.5, depth: fieldLengthYards + 18 },
    scene
  );
  rightStand.position = new BABYLON.Vector3(fieldWidthYards / 2 + 8, 1.25, 0);
  rightStand.material = standsMat;

  const upperDeckLeft = BABYLON.MeshBuilder.CreateBox(
    "upperDeckLeft",
    { width: 14, height: 2.4, depth: fieldLengthYards + 20 },
    scene
  );
  upperDeckLeft.position = new BABYLON.Vector3(-fieldWidthYards / 2 - 9.8, 3.8, 0);
  upperDeckLeft.material = standsMat;

  const upperDeckRight = BABYLON.MeshBuilder.CreateBox(
    "upperDeckRight",
    { width: 14, height: 2.4, depth: fieldLengthYards + 20 },
    scene
  );
  upperDeckRight.position = new BABYLON.Vector3(fieldWidthYards / 2 + 9.8, 3.8, 0);
  upperDeckRight.material = standsMat;

  const goalPosts = new BABYLON.Mesh("goalPosts", scene);
  for (let i = -1; i <= 1; i += 2) {
    const postLeft = BABYLON.MeshBuilder.CreateCylinder(
      `goalPostLeft${i}`,
      { diameter: 0.12, height: 3.3 },
      scene
    );
    postLeft.position = new BABYLON.Vector3(i * 18.5, 1.65, -60);
    postLeft.material = sidelineMat;
    postLeft.parent = goalPosts;

    const postRight = BABYLON.MeshBuilder.CreateCylinder(
      `goalPostRight${i}`,
      { diameter: 0.12, height: 3.3 },
      scene
    );
    postRight.position = new BABYLON.Vector3(i * 18.5, 1.65, 60);
    postRight.material = sidelineMat;
    postRight.parent = goalPosts;

    const crossbar = BABYLON.MeshBuilder.CreateBox(
      `crossbar${i}`,
      { width: 3.3, height: 0.12, depth: 0.12 },
      scene
    );
    crossbar.position = new BABYLON.Vector3(i * 18.5, 3.2, -60);
    crossbar.material = sidelineMat;
    crossbar.parent = goalPosts;

    const crossbar2 = BABYLON.MeshBuilder.CreateBox(
      `crossbar2${i}`,
      { width: 3.3, height: 0.12, depth: 0.12 },
      scene
    );
    crossbar2.position = new BABYLON.Vector3(i * 18.5, 3.2, 60);
    crossbar2.material = sidelineMat;
    crossbar2.parent = goalPosts;
  }

  const lightMat = new BABYLON.StandardMaterial("lightMat", scene);
  lightMat.emissiveColor = new BABYLON.Color3(1, 1, 0.9);
  lightMat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9);

  for (const x of [-30, 0, 30]) {
    const light = BABYLON.MeshBuilder.CreateCylinder(
      `stadiumLight${x}`,
      { diameter: 0.6, height: 10 },
      scene
    );
    light.position = new BABYLON.Vector3(x, 6, -68);
    light.material = lightMat;

    const light2 = BABYLON.MeshBuilder.CreateCylinder(
      `stadiumLight2${x}`,
      { diameter: 0.6, height: 10 },
      scene
    );
    light2.position = new BABYLON.Vector3(x, 6, 68);
    light2.material = lightMat;
  }

  return { setHashMarkLevel };
}

const footballField = createFootballField();

if (fieldLevelSelect) {
  fieldLevelSelect.addEventListener("change", (event) => {
    footballField.setHashMarkLevel(event.target.value);
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

async function startXR(mode) {
  if (!(await checkSessionSupport(mode))) {
    return;
  }

  try {
    const xrExperience = await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: mode,
        referenceSpaceType: "local-floor",
        ignoreNativeCamera: false,
      },
      optionalFeatures: true,
      floorMeshes: [ground],
      disableTeleportation: true,
      inputOptions: {
        doNotLoadControllerMeshes: false,
        disableControllerAnimation: false,
      },
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
