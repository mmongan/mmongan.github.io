var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import * as BABYLON from '@babylonjs/core';
var canvas = document.getElementById('render-canvas');
var engine;
var createDefaultEngine = function () {
    return new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true
    });
};
// Create scene and create XR experience.
var createScene = function () {
    return __awaiter(this, void 0, void 0, function () {
        var scene, camera, light, sphere, box, xrHelper;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    scene = new BABYLON.Scene(engine);
                    camera = new BABYLON.FreeCamera('camera-1', new BABYLON.Vector3(0, 5, -10), scene);
                    // Point the camera at scene origin.
                    camera.setTarget(BABYLON.Vector3.Zero());
                    // Attach camera to canvas.
                    camera.attachControl(canvas, true);
                    light = new BABYLON.HemisphericLight('light-1', new BABYLON.Vector3(0, 1, 0), scene);
                    // Set light intensity to a lower value (default is 1).
                    light.intensity = 0.5;
                    sphere = BABYLON.MeshBuilder.CreateSphere('sphere-1', {
                        diameter: 2,
                        segments: 32
                    }, scene);
                    // Position the sphere up by half of its height.
                    sphere.position.y = 1;
                    box = BABYLON.MeshBuilder.CreateBox('box-1', {
                        width: 2,
                        height: 2,
                        depth: 2
                    }, scene);
                    // Position the sphere up by half of its height.
                    box.position.y = 2;
                    // Create a default environment for the scene.
                    scene.createDefaultEnvironment();
                    return [4 /*yield*/, scene.createDefaultXRExperienceAsync()];
                case 1:
                    xrHelper = _a.sent();
                    if (!xrHelper.baseExperience) {
                        // XR support is unavailable.
                        console.log('WebXR support is unavailable');
                    }
                    else {
                        // XR support is available.
                        console.log('XR support is available; proceed.');
                    }
                    return [2 /*return*/, scene];
            }
        });
    });
};
// Create engine.
engine = createDefaultEngine();
if (!engine) {
    throw 'Engine should not be null';
}
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var scene;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, createScene()];
            case 1:
                scene = _a.sent();
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
                return [2 /*return*/];
        }
    });
}); })().catch(function (e) {
    // Deal with the fact the chain failed
});
