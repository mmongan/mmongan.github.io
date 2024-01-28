import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader, Mesh, AbstractMesh, WebXRInputSource, WebXRDefaultExperience, MeshBuilder, WebXRFeatureName, Ray, AnimationGroup, Nullable } from "@babylonjs/core";
import { fetchProfile, MotionController } from '@webxr-input-profiles/motion-controllers'

import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';

import '@babylonjs/loaders';


const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;

// Associate a Babylon Engine to it.
const engine = new Engine(canvas);

// Create our first scene.
var scene = new Scene(engine);

// This creates and positions a free camera (non-mesh)
var camera = new FreeCamera("camera1", new Vector3(0, 1, -.7), scene);

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


const xaxis = new Vector3(1,0,0);
const yaxis = new Vector3(0,1,0);
const zaxis = new Vector3(0,0,1);

let leftController : any;
let rightController : any;
let trumpet: AbstractMesh;
let pressfingerbone1 : Nullable<AnimationGroup>;
let pressfingerbone2 : Nullable<AnimationGroup>;
let pressfingerbone3 : Nullable<AnimationGroup>;



// Get the canvas element from the DOM.

const importResult = SceneLoader.ImportMesh(
    null,
    "../assets/models/trumpet.glb","", scene, 
    function (meshes, particleSystems, skeletons, animationGroups) {
        

        trumpet = scene.getMeshByName("LEADPIPE") as AbstractMesh;        
        trumpet.position = new Vector3(0,1,0);
        trumpet.rotate(zaxis,Math.PI);
        trumpet.rotate(xaxis,Math.PI/2);


        pressfingerbone1 = scene.getAnimationGroupByName("pressfingerbone1action");        
        pressfingerbone2 = scene.getAnimationGroupByName("pressfingerbone2action");
        pressfingerbone3 = scene.getAnimationGroupByName("pressfingerbone3action");
        
    
        for (var i = 0; i < animationGroups.length; i++) {
            console.log("animation " + animationGroups[i].name);
            if (scene.animationGroups[i].name.startsWith("pressfingerbone")) {
            
                animationGroups[i].stop();

                const animation = animationGroups[i];

                //animation.start(false, 1.0, 1, 3, false);
                animation.onAnimationGroupEndObservable.add(function () {
                    console.log("end animation" + animation.name);
                    animation.stop();
                })
            }
        }        
        
        
        scene.onPointerDown = function (evt, pickResult) {
            
            
    
            // if (true) { //pickResult.pickedMesh) {
            //     for (var i = 0; i < scene.animationGroups.length; i++) {
            //         console.log("animation" + scene.animationGroups[i].name);
            //         //if (scene.animationGroups[i].name.startsWith("pressfingerbones")) {
            //             scene.animationGroups[i].play();
            //             scene.animationGroups[i].onAnimationGroupEndObservable.add(function () {
            //                 console.log("animation" + scene.animationGroups[i].name);
            //                 scene.animationGroups[i].play();
            //             })
            //         //}
            //     }
            // }
        };
    
    });




    const setupcontrollers = function(xr : WebXRDefaultExperience) {

            


        xr.input.onControllerAddedObservable.add((controller : any) => {
            controller.onMotionControllerInitObservable.add((motionController : any) => {
                if (motionController.handness === 'left') {
    
                    leftController = motionController;
    
                    
    
                     const xr_ids = motionController.getComponentIds();
                     let triggerComponent = motionController.getComponent(xr_ids[0]);//xr-standard-trigger
                     triggerComponent.onButtonStateChangedObservable.add(() => {
                         if (triggerComponent.pressed) {

                           
                          
                            //trumpet.position = new Vector3(0,1,0);
                             //Box_Left_Trigger.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                         
                         }else{
                             //Box_Left_Trigger.scaling= new BABYLON.Vector3(1,1,1);                             

                             
                         }
                     });
                     let squeezeComponent = motionController.getComponent(xr_ids[1]);//xr-standard-squeeze
                     squeezeComponent.onButtonStateChangedObservable.add(() => {
                         if (squeezeComponent.pressed) {
                             //Box_Left_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                             trumpet.setParent(motionController.rootMesh);                            
                         }else{
                             //Box_Left_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                             trumpet.setParent(null);
                         }
                     });
                     let thumbstickComponent = motionController.getComponent(xr_ids[2]);//xr-standard-thumbstick
                     thumbstickComponent.onButtonStateChangedObservable.add(() => {
                         if (thumbstickComponent.pressed) {
                             //Box_Left_ThumbStick.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                         }else{
                             //Box_Left_ThumbStick.scaling=new BABYLON.Vector3(1,1,1);
                         }
                     /*
                         let axes = thumbstickComponent.axes;
                         Box_Left_ThumbStick.position.x += axes.x;
                         Box_Left_ThumbStick.position.y += axes.y;
                     */
                     });
                     thumbstickComponent.onAxisValueChangedObservable.add((axes : any) => {
                         //https://playground.babylonjs.com/#INBVUY#87
                         //inactivate camera rotation : not working so far
     
                         /*
                         let rotationValue = 0;
                         const matrix = new BABYLON.Matrix();
                         let deviceRotationQuaternion = webXRInput.xrCamera.getDirection(BABYLON.Axis.Z).toQuaternion(); // webXRInput.xrCamera.rotationQuaternion;
                         var angle = rotationValue * (Math.PI / 8);
                         var quaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, angle);
                         const move = new BABYLON.Vector3(0,0,0);
                         deviceRotationQuaternion = deviceRotationQuaternion.multiply(quaternion);
                         BABYLON.Matrix.FromQuaternionToRef(deviceRotationQuaternion, matrix);
                         const addPos = BABYLON.Vector3.TransformCoordinates(move, matrix);
                         addPos.y = 0;
     
                         webXRInput.xrCamera.position = webXRInput.xrCamera.position.add(addPos);
                        // webXRInput.xrCamera.rotationQuaternion = BABYLON.Quaternion.Identity();
                         
                         //webXRInput.xrCamera.rotation = new BABYLON.Vector3(0,0,0);
                         */
                         //Box_Left_ThumbStick is moving according to stick axes but camera rotation is also changing..
                        // Box_Left_ThumbStick.position.x += (axes.x)/100;
                       //  Box_Left_ThumbStick.position.y -= (axes.y)/100;
                        // console.log(values.x, values.y);
                     });
     
                     let xbuttonComponent = motionController.getComponent(xr_ids[3]);//x-button
                     xbuttonComponent.onButtonStateChangedObservable.add(() => {
                         if (xbuttonComponent.pressed) {
                             //Sphere_Left_XButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                            
                         }else{
                             //Sphere_Left_XButton.scaling=new BABYLON.Vector3(1,1,1);  
                         }
                     });
                     let ybuttonComponent = motionController.getComponent(xr_ids[4]);//y-button
                     ybuttonComponent.onButtonStateChangedObservable.add(() => {
                         if (ybuttonComponent.pressed) {
                             //Sphere_Left_YButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                            
                         }else{
                             //Sphere_Left_YButton.scaling=new BABYLON.Vector3(1,1,1);  
                         }
                     });
                     /* not worked.
                     let thumbrestComponent = motionController.getComponent(xr_ids[5]);//thumrest
                     thumbrestComponent.onButtonStateChangedObservable.add(() => {
                         //not worked
                         if ((thumbrestComponent.value>0.1&&thumbrestComponent.value<0.6) {
                             sphere1.position.y=10;
                         }
                         if(thumbrestComponent.touched){
                              sphere1.position.y=10;
                         }
     
                     });  
                     */              
                }
                if (motionController.handness === 'right') {


    
                    rightController = motionController;                    
    
                     const xr_ids = motionController.getComponentIds();
                     let triggerComponent = motionController.getComponent(xr_ids[0]);//xr-standard-trigger
                     triggerComponent.onButtonStateChangedObservable.add(() => {
                         if (triggerComponent.pressed) {
                             //Box_Right_Trigger.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                             
                             
                         
                         }else{
                             //Box_Right_Trigger.scaling= new BABYLON.Vector3(1,1,1);
                             
                         
                         }
                     });
                     let squeezeComponent = motionController.getComponent(xr_ids[1]);//xr-standard-squeeze
                     squeezeComponent.onButtonStateChangedObservable.add(() => {
                         if (squeezeComponent.pressed) {
                             //Box_Right_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                             trumpet.setParent(motionController.rootMesh);
                         }else{
                             //Box_Right_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                             trumpet.setParent(null);
                         }
                     });
                     let thumbstickComponent = motionController.getComponent(xr_ids[2]);//xr-standard-thumbstick
                     thumbstickComponent.onButtonStateChangedObservable.add(() => {
                         if (thumbstickComponent.pressed) {
                             //Box_Right_ThumbStick.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                         }else{
                             //Box_Right_ThumbStick.scaling=new BABYLON.Vector3(1,1,1);
                         }
     
                     });
                     thumbstickComponent.onAxisValueChangedObservable.add((axes : any) => {
                         //Box_Right_ThumbStick is moving according to stick axes but camera rotation is also changing..
                        // Box_Right_ThumbStick.position.x += (axes.x)/100;
                        // Box_Right_ThumbStick.position.y += (axes.y)/100;
                        // console.log(values.x, values.y);
                     });
     
                     let abuttonComponent = motionController.getComponent(xr_ids[3]);//a-button
                     abuttonComponent.onButtonStateChangedObservable.add(() => {
                         if (abuttonComponent.pressed) {
                             //Sphere_Right_AButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                         }else{
                             //Sphere_Right_AButton.scaling=new BABYLON.Vector3(1,1,1);  
                         }
                     });
                     let bbuttonComponent = motionController.getComponent(xr_ids[4]);//b-button
                     bbuttonComponent.onButtonStateChangedObservable.add(() => {
                         if (bbuttonComponent.pressed) {
                             //Sphere_Right_BButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                            
                         }else{
                             //Sphere_Right_BButton.scaling=new BABYLON.Vector3(1,1,1);  
                         }
                     });
                     /* not worked.
                     let thumbrestComponent = motionController.getComponent(xr_ids[5]);//thumrest
                     thumbrestComponent.onButtonStateChangedObservable.add(() => {
                         //not worked
                         if ((thumbrestComponent.value>0.1&&thumbrestComponent.value<0.6) {
                             sphere1.position.y=10;
                         }
                         if(thumbrestComponent.touched){
                              sphere1.position.y=10;
                         }
     
                     });  
                     */              
       
                    /*
                     const xr_ids = motionController.getComponentIds();
                     for (let i=0;i<xr_ids.length;i++){
                         console.log("right:"+xr_ids[i]);
                     }
                    */
                }
     
            })
     
        });
    
    
    
    }

    scene.createDefaultXRExperienceAsync().then( 
        xr => {
        // Render every frame



        const featuresManager = xr.baseExperience.featuresManager;

        const pointerSelection = featuresManager.enableFeature(WebXRFeatureName.POINTER_SELECTION, "stable", {
            xrInput: xr.input,
            enablePointerSelectionOnAllControllers: true        
        });
    
    
        const ground = MeshBuilder.CreateGround("ground", {width: 400, height: 400});
    

        const teleportation = featuresManager.enableFeature(WebXRFeatureName.TELEPORTATION, "stable", {
            xrInput: xr.input,
            floorMeshes: [ground],
            snapPositions: [new Vector3(2.4*3.5*1, 0, -10*1)],
        });        
        
        setupcontrollers(xr);
        
    
        engine.runRenderLoop(() => {


            if (trumpet) {
                scene.registerBeforeRender(function() {    
                    if (trumpet) {
                        // trumpet.rotate(yaxis, Math.PI/(360.0*4));
                        // trumpet.rotate(zaxis, Math.PI/(360.0*3));
    
                        // if (trumpet) {
                        //     trumpet.position = new Vector3(1, 1, 1);
                        
                        //trumpet.position = leftController                                                            
    
                        if (leftController && leftController.pointer) {
                            const tmpRay = new Ray(
                                leftController.pointer.absolutePosition,
                                leftController.pointer.forward,
                                0.5
                            );
    
                            leftController.getWorldPointerRayToRef(tmpRay, true);
                
                            const newPosition = new Vector3(
                                tmpRay.origin.x + tmpRay.direction.x,
                                tmpRay.origin.y,
                                tmpRay.origin.z + tmpRay.direction.z
                            );              
                            
                            trumpet.position = newPosition;
                        }
    
                        
                    
                    }
                });
            }
    

            scene.render();
        });    

    });
