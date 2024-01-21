import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader, Mesh, AbstractMesh } from "@babylonjs/core";

import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';

import '@babylonjs/loaders';

(async () => {


// Get the canvas element from the DOM.
const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;

// Associate a Babylon Engine to it.
const engine = new Engine(canvas);

// Create our first scene.
var scene = new Scene(engine);

// This creates and positions a free camera (non-mesh)
var camera = new FreeCamera("camera1", new Vector3(1, 1, -1), scene);

// This targets the camera to scene origin
camera.setTarget(Vector3.Zero());

// This attaches the camera to the canvas
camera.attachControl(canvas, true);

// This creates a light, aiming 0,1,0 - to the sky (non-mesh)
var light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);

// Default intensity is 1. Let's dim the light a small amount
light.intensity = 0.9;

// Create a grid material
var material = new GridMaterial("grid", scene);

// Our built-in 'sphere' shape.
//var sphere = CreateSphere('sphere1', { segments: 16, diameter: 2 }, scene);

// Move the sphere upward 1/2 its height
//sphere.position.y = 2;

// Affect a material
//sphere.material = material;

// Our built-in 'ground' shape.
//var ground = CreateGround('ground1', { width: 6, height: 6, subdivisions: 2 }, scene);

// Affect a material
//ground.material = material;


const yaxis = new Vector3(0,1,0);

let trumpetmesh : AbstractMesh;

const importResult = await SceneLoader.ImportMeshAsync(
    "",
    "",
    "../assets/models/trumpet.glb",
    scene,
    undefined,
    ".glb"
    ).then(value => { for (let v of value.meshes) {
            if (v.name == "VALVE2") {
                v.scaling = v.scaling.scale(2);
                //v.movePOV(0,0,0);
                trumpetmesh = v;

            }

            if (v.name == "MOUTHPIECE") {
                

            }

    } });

    let r = 3.1415926/180.0;
    // Render every frame
engine.runRenderLoop(() => {

  trumpetmesh.rotate(yaxis, r);

  

  scene.render();
});

})().catch(e => {
    // Deal with the fact the chain failed
});   

