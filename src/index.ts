/////////////////////////////////////////////////////////////////////////////////
//
// src/index.ts
//
// MIT License
//
// Copyright (c) 2025 Marty Mongan
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
/////////////////////////////////////////////////////////////////////////////////

import '@babylonjs/loaders';
import { Engine, Scene, HemisphericLight, DirectionalLight, Vector3, MeshBuilder, StandardMaterial, Texture, Color4, BoxBlock, HeightToNormalBlock, AbstractMesh, WebXRDefaultExperience, WebXRFeatureName, Mesh, Nullable, Animation, Color3, PointerEventTypes, FreeCamera, ArcRotateCamera, CubeTexture } from '@babylonjs/core';
import { WebXRControllerPointerSelection } from '@babylonjs/core/XR/features/WebXRControllerPointerSelection';
import { WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
// WebXRControllerPointerSelection.PICK_RAY_MODE_PARABOLIC does not exist; use WebXRControllerPointerSelection.PickRayMode.PARABOLIC


const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

interface NodeInfo {

    name?: string;
    imageUrl: string;

    parent?: NodeInfo;
    children?: NodeInfo[];

    position?: Vector3;
    size?: number;
    radius?: number;
    height?: number;
    isVisible: boolean;
    isPickable: boolean;
    nodeMesh?: Mesh;
}

// Global map to store NodeInfo by name
const nodeInfoMap: Record<string, NodeInfo> = {};

interface NodeConnectionInfo {

    name: string;

    from: string;
    to: string;

    isVisible: boolean;
    isPickable: boolean;
    nodeMesh?: Mesh;

}

// Global map to store NodeInfo by name
const nodeConnectionInfoMap: Record<string, NodeConnectionInfo> = {};


function pointsOnCircle(cx: number, cy: number, radius: number, count: number, angleOffset: number = 0) {
    const points = [];
    for (let i = 0; i < count; i++) {
        const theta = angleOffset + (2 * Math.PI * i) / count; // angle for this point
        const x = cx + radius * Math.cos(theta);
        const y = cy + radius * Math.sin(theta);
        points.push({ x, y });
    }
    return points;
}


// Creates a tube mesh connecting two nodes by name
async function createNodeConnectionMesh(connectionInfo: NodeConnectionInfo, scene: Scene): Promise<NodeConnectionInfo> {
    const fromNode = nodeInfoMap[connectionInfo.from];
    const toNode = nodeInfoMap[connectionInfo.to];
    if (!fromNode || !toNode || !fromNode.position || !toNode.position) {
        throw new Error(`Invalid from/to nodes for connection: ${connectionInfo.name}`);
    }

    let tubesize = toNode.size! * 0.05
    if (tubesize < 0.005) {
        tubesize = 0.005;
    }
    if (tubesize > .05) {
        tubesize = 0.05;
    }   

    const startPos = fromNode.position.clone();
    const endPos = toNode.position.clone();

    startPos.y -= (fromNode.size || 0)*.4;
    endPos.y += (toNode.size || 0)*.4; 
    

    const mesh = MeshBuilder.CreateTube(connectionInfo.name, {
        path: [startPos, endPos],
        radius: tubesize,
        tessellation: 16,
        cap: Mesh.CAP_ALL
    }, scene);
    mesh.isPickable = connectionInfo.isPickable;
    mesh.isVisible = connectionInfo.isVisible;
    // Set tube material to solid grey
    const tubeMat = new StandardMaterial(connectionInfo.name + '_tubeMat', scene);
    tubeMat.diffuseColor = new Color3(0.5, 0.5, 0.5);
    tubeMat.emissiveColor = new Color3(0.5, 0.5, 0.5); // Remove shading, flat grey
    tubeMat.specularColor = new Color3(0, 0, 0); // No specular highlights
    //tubeMat.disableLighting = true;
    mesh.material = tubeMat;
    connectionInfo.nodeMesh = mesh;

    nodeConnectionInfoMap[connectionInfo.name] = connectionInfo;

    return connectionInfo;
}

async function createNodeMesh(nodeInfo: NodeInfo, depth: number, deep: boolean, scene: Scene): Promise<NodeInfo> {

    if (!nodeInfo.name) {
        nodeInfo.name = `node_depth${depth}_${Object.keys(nodeInfoMap).length}`;
    }

    nodeInfo.position = nodeInfo.position || new Vector3(0, 100, 0);
    nodeInfo.height = nodeInfo.height || 100;
    nodeInfo.radius = nodeInfo.radius || 200;
    nodeInfo.size = nodeInfo.size || 100;

    const nodeMat = new StandardMaterial(nodeInfo.name, scene);
    const nodeTex = new Texture(nodeInfo.imageUrl, scene);
    nodeTex.uScale = 1;
    nodeTex.vScale = 1;
    nodeTex.coordinatesMode = Texture.PLANAR_MODE; // Use planar mapping for less distortion
    nodeMat.diffuseTexture = nodeTex;
    nodeMat.backFaceCulling = true; // (undo) Only show image on outside faces
    nodeMat.roughness = 1.0; // Max roughness for matte look
    nodeMat.specularColor = new Color3(0, 0, 0); // Remove specular highlights (glare)

    // Restore original cube mesh
    const nodeMesh = MeshBuilder.CreateBox(nodeInfo.name, {
        size: nodeInfo.size
    }, scene);

    nodeMesh.position = nodeInfo.position.clone();

    nodeMesh.material = nodeMat;
    nodeMesh.isPickable = nodeInfo.isPickable;
    nodeMesh.isVisible = nodeInfo.isVisible;

    nodeInfo.nodeMesh = nodeMesh;

    nodeInfoMap[nodeInfo.name] = nodeInfo;

    if (deep && nodeInfo.children && nodeInfo.position) {

        const points = pointsOnCircle(nodeInfo.position.x, nodeInfo.position.z, nodeInfo.radius, nodeInfo.children.length, 0);

        let index = 0;

        for (const childInfo of nodeInfo.children) {
            childInfo.parent = nodeInfo;

            childInfo.position = new Vector3(points[index].x, nodeInfo.position.y - nodeInfo.height, points[index].y);

            childInfo.radius = nodeInfo.radius * Math.PI / (nodeInfo.children.length + 2) * 0.75;

            childInfo.size = nodeInfo.radius * Math.PI / (nodeInfo.children.length + 2) * 0.75;

            if (childInfo.size > nodeInfo.size) {
                childInfo.size = nodeInfo.size;
            }



            childInfo.height = childInfo.size * 2;

            await createNodeMesh(childInfo, depth + 1, deep, scene);


            const connectionInfo: NodeConnectionInfo = {
                name: `connection_${nodeInfo.name}_to_${childInfo.name!}`,
                from: nodeInfo.name!,
                to: childInfo.name!,
                isVisible: true,
                isPickable: false
            };

            // connect the nodes
            await createNodeConnectionMesh(connectionInfo, scene);

            index++;
        }
    }



    return nodeInfo;

}


function generateTestChildren(node: NodeInfo, depth: number, maxChildren: number, maxDepth: number): NodeInfo {
    
    if (depth < Math.floor(Math.random() * maxDepth) + 2) {
        const numChildren = Math.floor(Math.random() * maxChildren) + 2;
        for (let i = 0; i < numChildren; i++) {
            const newChild : NodeInfo = {
                imageUrl: `https://picsum.photos/640/640?random=${Math.floor(Math.random() * 10000)}`,
                isVisible: true,
                isPickable: true,
                children: []
            };

            generateTestChildren(newChild, depth + 1, maxChildren, maxDepth);
            node.children!.push(newChild);
        }

    }
    return node;
}


async function generateTestChart(position: Vector3, size: number, radius: number, height: number, maxchildren: number, maxdepth: number) : Promise<NodeInfo> {
    // Simulate async data fetching
    return new Promise((resolve) => {
        setTimeout(() => {            
            
            const data: NodeInfo = {
                name: 'node_rootNode',
                imageUrl: `https://picsum.photos/80?random=${Math.floor(Math.random() * 10000)}`,
                position: position,
                size:   size,
                radius: radius,
                height: height,
                isVisible: true,
                isPickable: true,
                children: [
                ]
            };

            generateTestChildren(data, 0, maxchildren, maxdepth);


            resolve(data);
        }, 1000);
    });
}


async function createARScene() {




    const rootSize = 20;
    const rootHeight = rootSize * 6;
    const rootRadius = rootHeight;
    const rootPosition = new Vector3(0, -10, 0);

    // ...existing code...
    const scene = new Scene(engine);
    const camera = new FreeCamera('camera', new Vector3(0, 0, 0), scene);

    // Add a proper Babylon.js cube skybox for outer space
    const skybox = MeshBuilder.CreateBox('skyBox', { size: 10000 }, scene);
    const skyboxMaterial = new StandardMaterial('skyBoxMaterial', scene);
    skyboxMaterial.backFaceCulling = false;
    // Use Babylon.js default skybox cube map for space
    skyboxMaterial.reflectionTexture = new CubeTexture('https://assets.babylonjs.com/textures/skybox', scene);
    skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
    skyboxMaterial.specularColor = new Color3(0, 0, 0);
    skybox.material = skyboxMaterial;

    camera.attachControl(canvas, true);

    camera.speed = 0.5;
    const light1 = new HemisphericLight('light1', new Vector3(1, 1, 1), scene);
    light1.intensity = 2.0;

    // Add a directional light for consistent lighting
    const directionalLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), scene);
    directionalLight.intensity = 2.0;


    // Selection state
    let selectedMesh: Nullable<Mesh> = null;

    // Pointer event for mesh selection


    scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === PointerEventTypes.POINTERPICK && pointerInfo.pickInfo && pointerInfo.pickInfo.hit && pointerInfo.pickInfo.pickedMesh) {

            const mesh = pointerInfo.pickInfo.pickedMesh;

            // the node for the selected mesh
            const nodeInfo = nodeInfoMap[mesh.name];


            if (mesh && nodeInfo && mesh instanceof Mesh && mesh.isPickable) {

                let activeCamera = camera;
                if (xrHelper && xrHelper.baseExperience && xrHelper.baseExperience.camera) {
                    activeCamera = xrHelper.baseExperience.camera;
                }






                // Remove outline from previous selection
                if (selectedMesh) {
                    //selectedMesh.renderOutline = false;
                    //selectedMesh.isPickable = true;

                }
                // Store and outline current selection
                selectedMesh = mesh;
                // selectedMesh.outlineColor = new Color3(0, 1, 0); // green
                // selectedMesh.outlineWidth = 0.02;
                // selectedMesh.renderOutline = true;
                //selectedMesh.isPickable = false;
                

                //console.log('Selected node:', nodeInfo);

                // Animate camera flying to the selected mesh position
                activeCamera = camera;
                if (xrHelper && xrHelper.baseExperience && xrHelper.baseExperience.camera) {
                    activeCamera = xrHelper.baseExperience.camera;
                }
                // Fly from current camera position to selected mesh
                const startPos = activeCamera.position.clone();
                // Move camera to the face of the mesh that was clicked
                let endPos: Vector3;
                if (pointerInfo.pickInfo && pointerInfo.pickInfo.pickedPoint) {
                    endPos = pointerInfo.pickInfo.pickedPoint.clone();
                    // Offset based on the face normal
                    if (pointerInfo.pickInfo.getNormal && pointerInfo.pickInfo.faceId !== undefined && pointerInfo.pickInfo.faceId >= 0) {
                        const normal = pointerInfo.pickInfo.getNormal(true, true);
                        if (normal && selectedMesh && selectedMesh instanceof Mesh) {
                            // Check if mesh is a box
                            const box = selectedMesh;
                            // Use bounding box for world min/max
                            const boundingBox = box.getBoundingInfo().boundingBox;
                            const min = boundingBox.minimumWorld;
                            const max = boundingBox.maximumWorld;
                            const size = max.subtract(min);
                            // Find local position of picked point
                            const invWorld = box.getWorldMatrix().clone().invert();
                            const localPoint = Vector3.TransformCoordinates(endPos, invWorld);
                            // Box faces: X=±, Y=±, Z=±
                            // Find which axis is most aligned with the normal
                            const n = normal.clone().normalize();
                            const absNormal = new Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
                            let axis: 'x'|'y'|'z' = 'x';
                            if (absNormal.y > absNormal.x && absNormal.y > absNormal.z) axis = 'y';
                            else if (absNormal.z > absNormal.x && absNormal.z > absNormal.y) axis = 'z';
                            // For the two axes perpendicular to the face, check if localPoint is near the edge
                            const axes: Array<'x'|'y'|'z'> = ['x','y','z'].filter(a => a !== axis) as Array<'x'|'y'|'z'>;
                            let nearEdge = false;
                            for (const a of axes) {
                                const coord = (localPoint as any)[a];
                                const half = ((size as any)[a]) / 2;
                                if (Math.abs(coord - half) < ((size as any)[a])*0.05 || Math.abs(coord + half) < ((size as any)[a])*0.05) {
                                    nearEdge = true;
                                    break;
                                }
                            }
                            if (nearEdge) {
                                // Move 5% past the closest edge (of the two perpendicular axes)
                                let minDist = Number.POSITIVE_INFINITY;
                                let closestAxis: 'x'|'y'|'z' = axes[0];
                                let closestEdge = 0;
                                for (const a of axes) {
                                    const coord = (localPoint as any)[a];
                                    const half = ((size as any)[a]) / 2;
                                    const distToPos = Math.abs(coord - half);
                                    const distToNeg = Math.abs(coord + half);
                                    if (distToPos < minDist) {
                                        minDist = distToPos;
                                        closestAxis = a;
                                        closestEdge = half;
                                    }
                                    if (distToNeg < minDist) {
                                        minDist = distToNeg;
                                        closestAxis = a;
                                        closestEdge = -half;
                                    }
                                }
                                // Move 2 meters past the closest edge
                                const newLocal = localPoint.clone();
                                const offset = 2;
                                (newLocal as any)[closestAxis] = closestEdge + (closestEdge > 0 ? offset : -offset);
                                endPos = Vector3.TransformCoordinates(newLocal, box.getWorldMatrix());
                            } else {
                                // If the normal is horizontal (Y near 0), offset by 1 meter, else by 2 meters
                                if (Math.abs(normal.y) < 0.2) {
                                    endPos = endPos.add(normal.normalize().scale(1));
                                } else {
                                    endPos = endPos.add(normal.normalize().scale(2));
                                }
                            }
                        }
                    }
                } else {
                    // Fallback: use mesh position
                    endPos = selectedMesh.getAbsolutePosition();
                }

                // endPos.y = meshPos.y;
                //const endPos = meshPos






                // Animate position
                const animation = new Animation(
                    'flyToSelected',
                    'position',
                    90,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CONSTANT
                );
                const keys = [
                    { frame: 0, value: startPos },
                    { frame: 90, value: endPos }
                ];
                animation.setKeys(keys);
                activeCamera.animations = [];
                activeCamera.animations.push(animation);
                scene.beginAnimation(activeCamera, 0, 90, false);

            }

        }

    }, PointerEventTypes.POINTERPICK);



    const nodeInfo = await generateTestChart(rootPosition, rootSize, rootRadius, rootHeight, 5, 5);


    const rootNode = await createNodeMesh(nodeInfo, 0, true, scene);

    // Make the camera look at the mesh named 'rootNode'
    const rootMesh = scene.getMeshByName('rootNode');
    if (rootMesh) {
        camera.setTarget(rootMesh.position);
    }

    
    let xrHelper: any;
    try {
        xrHelper = await (scene as any).createDefaultXRExperienceAsync({
            uiOptions: { sessionMode: 'immersive-vr' }, //uiOptions: { sessionMode: 'immersive-ar' },
            optionalFeatures: true,
            referenceSpaceType: 'local-floor'
        });
        console.log('WebXR VR (room scale) enabled');
    } catch (e) {
        console.warn('WebXR VR experience unavailable or failed to start:', e);
    }

    
    if (xrHelper && xrHelper.baseExperience) {
        const featuresManager = xrHelper.baseExperience.featuresManager;
        featuresManager.enableFeature(WebXRFeatureName.POINTER_SELECTION, 'latest', {
            xrInput: xrHelper.input,
            enablePointerSelectionOnAllControllers: true,
            forceGazeMode: false,
            disablePointerUpOnTouchOut: false,
        });
        // ...teleportation feature if needed...
    }
    
    return scene;
}

createARScene().then(scene => {
    if (scene) {
        engine.runRenderLoop(() => {
            scene.render();
        });
    }
});