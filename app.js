const canvas = document.getElementById("renderCanvas");
const vrButton = document.getElementById("vrButton");
const arButton = document.getElementById("arButton");

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
  8,
  new BABYLON.Vector3(0, 1.4, 0),
  scene
);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 4;
camera.upperRadiusLimit = 18;

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
  { width: 25, height: 25 },
  scene
);
ground.position.y = -0.51;

ground.material = new BABYLON.StandardMaterial("groundMat", scene);
ground.material.diffuseColor = new BABYLON.Color3(0.12, 0.18, 0.22);
ground.material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

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

scene.registerBeforeRender(() => {
  box.rotation.y += 0.014;
  box.rotation.x += 0.012;
  torus.rotation.z += 0.015;
  moon.rotation.y += 0.01;
  ring.rotation.y += 0.01;
  globe.rotation.y += 0.012;
  globe.position.y = 0.8 + Math.sin((performance.now() / 800) % (Math.PI * 2)) * 0.25;
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
    await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: mode,
        referenceSpaceType: "local-floor",
        ignoreNativeCamera: false,
      },
      optionalFeatures: true,
      floorMeshes: [ground],
      disableTeleportation: false,
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
