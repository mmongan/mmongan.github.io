// TRUMPET-PUPPET
// Copyright (C) 2024  MARTY MONGAN
//
//This program is free software: you can redistribute it and/or modify
//it under the terms of the GNU General Public License as published by
//the Free Software Foundation, either version 3 of the License, or
//(at your option) any later version.
//
//This program is distributed in the hope that it will be useful,
//but WITHOUT ANY WARRANTY; without even the implied warranty of
//MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//GNU General Public License for more details.
//
//You should have received a copy of the GNU General Public License
//along with this program.  If not, see <http://www.gnu.org/licenses/>.
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { GrassProceduralTexture } from '@babylonjs/procedural-textures';
import { SceneLoader, MeshBuilder, WebXRFeatureName, StandardMaterial, Color3 } from "@babylonjs/core";
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import '@babylonjs/loaders';
var canvas = document.getElementById("render-canvas");
// Associate a Babylon Engine to it.
var engine = new Engine(canvas);
var scene = new Scene(engine);
var camera = new FreeCamera("camera1", new Vector3(0, 1, -.7), scene);
camera.setTarget(Vector3.Zero());
camera.attachControl(canvas, true);
var light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
light.intensity = 0.9;
var material = new GridMaterial("grid", scene);
var xaxis = new Vector3(1, 0, 0);
var yaxis = new Vector3(0, 1, 0);
var zaxis = new Vector3(0, 0, 1);
var leftController;
var rightController;
var trumpet;
var pressfingerbone1;
var pressfingerbone2;
var pressfingerbone3;
var importResult = SceneLoader.ImportMesh(null, "../assets/models/trumpet.glb", "", scene, function (meshes, particleSystems, skeletons, animationGroups) {
    trumpet = scene.getMeshByName("LEADPIPE");
    trumpet.position = new Vector3(0, 1, 0);
    trumpet.rotate(zaxis, Math.PI);
    trumpet.rotate(xaxis, -Math.PI / 2);
    pressfingerbone1 = scene.getAnimationGroupByName("pressfingerbone1action");
    pressfingerbone2 = scene.getAnimationGroupByName("pressfingerbone2action");
    pressfingerbone3 = scene.getAnimationGroupByName("pressfingerbone3action");
    var _loop_1 = function () {
        console.log("animation " + animationGroups[i].name);
        if (scene.animationGroups[i].name.startsWith("pressfingerbone")) {
            animationGroups[i].stop();
            var animation_1 = animationGroups[i];
            //animation.start(false, 1.0, 1, 3, false);
            animation_1.onAnimationGroupEndObservable.add(function () {
                console.log("end animation" + animation_1.name);
                animation_1.stop();
            });
        }
    };
    for (var i = 0; i < animationGroups.length; i++) {
        _loop_1();
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
                        trumpet.setParent(motionController.rootMesh);
                    }
                    else {
                        //Box_Left_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                        trumpet.setParent(null);
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
                        trumpet.setParent(motionController.rootMesh);
                    }
                    else {
                        //Box_Right_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
                        trumpet.setParent(null);
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
scene.createDefaultXRExperienceAsync().then(function (xr) {
    // Render every frame
    var featuresManager = xr.baseExperience.featuresManager;
    var pointerSelection = featuresManager.enableFeature(WebXRFeatureName.POINTER_SELECTION, "stable", {
        xrInput: xr.input,
        enablePointerSelectionOnAllControllers: true
    });
    // const skyMaterial = new StandardMaterial("skyMaterial", scene);        
    // skyMaterial.backFaceCulling = false;
    // const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, scene);
    // skybox.material = skyMaterial;        
    var environment = scene.createDefaultEnvironment({
        createGround: false,
        createSkybox: true,
        skyboxSize: 150,
        skyboxColor: Color3.Teal(),
        enableGroundShadow: true,
        groundYBias: 1
    });
    var ground = MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, scene);
    var grassMaterial = new StandardMaterial("grassMat", scene);
    var grassTexture = new GrassProceduralTexture("grassTex", 1024, scene);
    grassMaterial.ambientTexture = grassTexture;
    ground.material = grassMaterial;
    var teleportation = featuresManager.enableFeature(WebXRFeatureName.TELEPORTATION, "stable", {
        xrInput: xr.input,
        floorMeshes: [ground],
        snapPositions: [new Vector3(2.4 * 3.5 * 1, 0, -10 * 1)],
    });
    setupcontrollers(xr);
    engine.runRenderLoop(function () {
        if (trumpet) {
            scene.registerBeforeRender(function () {
                if (trumpet) {
                }
            });
        }
        scene.render();
    });
});
