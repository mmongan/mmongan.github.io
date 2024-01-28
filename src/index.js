import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader, MeshBuilder, WebXRFeatureName } from "@babylonjs/core";
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import '@babylonjs/loaders';
var canvas = document.getElementById("render-canvas");
// Associate a Babylon Engine to it.
var engine = new Engine(canvas);
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
var yaxis = new Vector3(0, 1, 0);
var zaxis = new Vector3(0, 0, 1);
var leftController;
var rightController;
var setupcontrollers = function (xr) {
    xr.input.onControllerAddedObservable.add(function (controller) {
        controller.onMotionControllerInitObservable.add(function (motionController) {
            if (motionController.handness === 'left') {
                leftController = motionController;
                var xr_ids = motionController.getComponentIds();
                var triggerComponent_1 = motionController.getComponent(xr_ids[0]); //xr-standard-trigger
                triggerComponent_1.onButtonStateChangedObservable.add(function () {
                    if (triggerComponent_1.pressed) {
                        //Box_Left_Trigger.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Left_Trigger.scaling= new BABYLON.Vector3(1,1,1);
                    }
                });
                var squeezeComponent_1 = motionController.getComponent(xr_ids[1]); //xr-standard-squeeze
                squeezeComponent_1.onButtonStateChangedObservable.add(function () {
                    if (squeezeComponent_1.pressed) {
                        //Box_Left_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Left_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                    }
                });
                var thumbstickComponent_1 = motionController.getComponent(xr_ids[2]); //xr-standard-thumbstick
                thumbstickComponent_1.onButtonStateChangedObservable.add(function () {
                    if (thumbstickComponent_1.pressed) {
                        //Box_Left_ThumbStick.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Left_ThumbStick.scaling=new BABYLON.Vector3(1,1,1);
                    }
                    /*
                        let axes = thumbstickComponent.axes;
                        Box_Left_ThumbStick.position.x += axes.x;
                        Box_Left_ThumbStick.position.y += axes.y;
                    */
                });
                thumbstickComponent_1.onAxisValueChangedObservable.add(function (axes) {
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
                var xbuttonComponent_1 = motionController.getComponent(xr_ids[3]); //x-button
                xbuttonComponent_1.onButtonStateChangedObservable.add(function () {
                    if (xbuttonComponent_1.pressed) {
                        //Sphere_Left_XButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Sphere_Left_XButton.scaling=new BABYLON.Vector3(1,1,1);  
                    }
                });
                var ybuttonComponent_1 = motionController.getComponent(xr_ids[4]); //y-button
                ybuttonComponent_1.onButtonStateChangedObservable.add(function () {
                    if (ybuttonComponent_1.pressed) {
                        //Sphere_Left_YButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
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
                var xr_ids = motionController.getComponentIds();
                var triggerComponent_2 = motionController.getComponent(xr_ids[0]); //xr-standard-trigger
                triggerComponent_2.onButtonStateChangedObservable.add(function () {
                    if (triggerComponent_2.pressed) {
                        //Box_Right_Trigger.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Right_Trigger.scaling= new BABYLON.Vector3(1,1,1);
                    }
                });
                var squeezeComponent_2 = motionController.getComponent(xr_ids[1]); //xr-standard-squeeze
                squeezeComponent_2.onButtonStateChangedObservable.add(function () {
                    if (squeezeComponent_2.pressed) {
                        //Box_Right_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Right_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                    }
                });
                var thumbstickComponent_2 = motionController.getComponent(xr_ids[2]); //xr-standard-thumbstick
                thumbstickComponent_2.onButtonStateChangedObservable.add(function () {
                    if (thumbstickComponent_2.pressed) {
                        //Box_Right_ThumbStick.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Box_Right_ThumbStick.scaling=new BABYLON.Vector3(1,1,1);
                    }
                });
                thumbstickComponent_2.onAxisValueChangedObservable.add(function (axes) {
                    //Box_Right_ThumbStick is moving according to stick axes but camera rotation is also changing..
                    // Box_Right_ThumbStick.position.x += (axes.x)/100;
                    // Box_Right_ThumbStick.position.y += (axes.y)/100;
                    // console.log(values.x, values.y);
                });
                var abuttonComponent_1 = motionController.getComponent(xr_ids[3]); //a-button
                abuttonComponent_1.onButtonStateChangedObservable.add(function () {
                    if (abuttonComponent_1.pressed) {
                        //Sphere_Right_AButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
                        //Sphere_Right_AButton.scaling=new BABYLON.Vector3(1,1,1);  
                    }
                });
                var bbuttonComponent_1 = motionController.getComponent(xr_ids[4]); //b-button
                bbuttonComponent_1.onButtonStateChangedObservable.add(function () {
                    if (bbuttonComponent_1.pressed) {
                        //Sphere_Right_BButton.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    }
                    else {
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
        });
    });
};
// Get the canvas element from the DOM.
var importResult = SceneLoader.ImportMesh(null, "../assets/models/trumpet.glb", "", scene, function (meshes, particleSystems, skeletons, animationGroups) {
    var trumpet = scene.getMeshByName("LEADPIPE");
    if (trumpet) {
        scene.registerBeforeRender(function () {
            if (trumpet) {
                trumpet.rotate(yaxis, Math.PI / (360.0 * 4));
                trumpet.rotate(zaxis, Math.PI / (360.0 * 3));
                if (trumpet) {
                    trumpet.position = new Vector3(1, 1, 1);
                }
            }
        });
    }
    var pressfingerbone1 = scene.getAnimationGroupByName("pressfingerbone1action");
    var pressfingerbone2 = scene.getAnimationGroupByName("pressfingerbone2action");
    var pressfingerbone3 = scene.getAnimationGroupByName("pressfingerbone3action");
    pressfingerbone1 === null || pressfingerbone1 === void 0 ? void 0 : pressfingerbone1.play(true);
    pressfingerbone1 === null || pressfingerbone1 === void 0 ? void 0 : pressfingerbone1.play(true);
    pressfingerbone1 === null || pressfingerbone1 === void 0 ? void 0 : pressfingerbone1.play(true);
    // for (var i = 0; i < animationGroups.length; i++) {
    //     console.log("animation " + animationGroups[i].name);
    //     if (scene.animationGroups[i].name.startsWith("pressfingerbone")) {
    //         //animationGroups[i].play(false);
    //         const animation = animationGroups[i];
    //         animation.start(false, 1.0, 1, 3, false);
    //         animation.onAnimationGroupEndObservable.add(function () {
    //             console.log("end animation" + animation.name);
    //             animation.stop();
    //         })
    //     }
    // }        
    //pressfingerbone1?.play(true);
    //pressfingerbone2?.play(false);
    //pressfingerbone3?.stop();
    // let trumpet = scene.getMeshByName("LEADPIPE") as AbstractMesh;
    // if (trumpet != null) {
    // }
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
scene.createDefaultXRExperienceAsync().then(function (xr) {
    // Render every frame
    var featuresManager = xr.baseExperience.featuresManager;
    var pointerSelection = featuresManager.enableFeature(WebXRFeatureName.POINTER_SELECTION, "stable", {
        xrInput: xr.input,
        enablePointerSelectionOnAllControllers: true
    });
    var ground = MeshBuilder.CreateGround("ground", { width: 400, height: 400 });
    var teleportation = featuresManager.enableFeature(WebXRFeatureName.TELEPORTATION, "stable", {
        xrInput: xr.input,
        floorMeshes: [ground],
        snapPositions: [new Vector3(2.4 * 3.5 * 1, 0, -10 * 1)],
    });
    setupcontrollers(xr);
    engine.runRenderLoop(function () {
        if (leftController) {
            //trumpet.setmatrix = pose.transform.matrix;
        }
        // Check for and respond to any gamepad state changes.
        for (var _i = 0, _a = xr.input.controllers; _i < _a.length; _i++) {
            var source = _a[_i];
            var inputsource = source.inputSource;
            if (inputsource.gamepad) {
                //let pose = getPose(inputsource.gripSpace, refSpace);
            }
        }
        scene.render();
    });
});
