import * as BABYLON from '@babylonjs/core';

// Identify canvas element to script.
const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;

// Initialize Babylon.js variables.
let engine: BABYLON.Engine;
    

const createDefaultEngine = function () {
  return new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true
  });
};

  
// Create scene and create XR experience.
const createScene = async function () : Promise<BABYLON.Scene> {

  // Create a basic Babylon Scene object.
  let scene = new BABYLON.Scene(engine);

  // Create and position a free camera.
  let camera = new BABYLON.FreeCamera('camera-1', new BABYLON.Vector3(0, 5, -10), scene);

  // Point the camera at scene origin.
  camera.setTarget(BABYLON.Vector3.Zero());

  // Attach camera to canvas.
  camera.attachControl(canvas, true);

  // Create a light and aim it vertically to the sky (0, 1, 0).
  let light = new BABYLON.HemisphericLight('light-1', new BABYLON.Vector3(0, 1, 0), scene);

  // Set light intensity to a lower value (default is 1).
  light.intensity = 0.5;

  // Add one of Babylon's built-in sphere shapes.
  let sphere = BABYLON.MeshBuilder.CreateSphere('sphere-1', {
    diameter: 2,
    segments: 32
  }, scene);

  // Position the sphere up by half of its height.
  sphere.position.y = 1;

  // Create a default environment for the scene.
  scene.createDefaultEnvironment();

  // Initialize XR experience with default experience helper.
  const xrHelper = await scene.createDefaultXRExperienceAsync();
  if (!xrHelper.baseExperience) {
    // XR support is unavailable.
    console.log('WebXR support is unavailable');          
  } else {
    // XR support is available.
    console.log('XR support is available; proceed.');          
  }

  return scene;

};

  // Create engine.
  engine = createDefaultEngine();
  if (!engine) {
    throw 'Engine should not be null';
  }

(async () => {
  const scene = await createScene();
  
  // Run render loop to render future frames.
  engine.runRenderLoop(function () {
    if (scene) {
      scene.render();
    }
  });

  // Handle browser resize.
  window.addEventListener('resize', function () {
    engine.resize();
  });

})().catch(e => {
  // Deal with the fact the chain failed
});      

