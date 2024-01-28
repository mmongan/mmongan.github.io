
//controller input
   xr.input.onControllerAddedObservable.add((controller) => {
       controller.onMotionControllerInitObservable.add((motionController) => {
           if (motionController.handness === 'left') {
                const xr_ids = motionController.getComponentIds();
                let triggerComponent = motionController.getComponent(xr_ids[0]);//xr-standard-trigger
                triggerComponent.onButtonStateChangedObservable.add(() => {
                    if (triggerComponent.pressed) {
                        //Box_Left_Trigger.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                    
                    }else{
                        //Box_Left_Trigger.scaling= new BABYLON.Vector3(1,1,1);
                    
                    }
                });
                let squeezeComponent = motionController.getComponent(xr_ids[1]);//xr-standard-squeeze
                squeezeComponent.onButtonStateChangedObservable.add(() => {
                    if (squeezeComponent.pressed) {
                        //Box_Left_Squeeze.scaling= new BABYLON.Vector3(1.2,1.2,1.2);
                     
                    }else{
                        //Box_Left_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
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
                thumbstickComponent.onAxisValueChangedObservable.add((axes) => {
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
                     
                    }else{
                        //Box_Right_Squeeze.scaling=new BABYLON.Vector3(1,1,1);
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
                thumbstickComponent.onAxisValueChangedObservable.add((axes) => {
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