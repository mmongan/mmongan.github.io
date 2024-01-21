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
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from "@babylonjs/core";
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import '@babylonjs/loaders';
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var canvas, engine, scene, camera, light, material, yaxis, trumpetmesh, importResult, xr, r;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                canvas = document.getElementById("render-canvas");
                engine = new Engine(canvas);
                scene = new Scene(engine);
                camera = new FreeCamera("camera1", new Vector3(1, 1, -1), scene);
                // This targets the camera to scene origin
                camera.setTarget(Vector3.Zero());
                // This attaches the camera to the canvas
                camera.attachControl(canvas, true);
                light = new HemisphericLight("light1", new Vector3(0, 1, 0), scene);
                // Default intensity is 1. Let's dim the light a small amount
                light.intensity = 0.9;
                material = new GridMaterial("grid", scene);
                yaxis = new Vector3(0, 1, 0);
                return [4 /*yield*/, SceneLoader.ImportMeshAsync("", "", "../assets/models/trumpet.glb", scene, undefined, ".glb").then(function (value) {
                        for (var _i = 0, _a = value.meshes; _i < _a.length; _i++) {
                            var v = _a[_i];
                            if (v.name == "VALVE2") {
                                v.scaling = v.scaling.scale(2);
                                v.movePOV(0, 1, 0);
                                trumpetmesh = v;
                            }
                            if (v.name == "MOUTHPIECE") {
                            }
                        }
                    })];
            case 1:
                importResult = _a.sent();
                return [4 /*yield*/, scene.createDefaultXRExperienceAsync()];
            case 2:
                xr = _a.sent();
                r = 3.1415926 / 180.0;
                // Render every frame
                engine.runRenderLoop(function () {
                    trumpetmesh.rotate(yaxis, r);
                    scene.render();
                });
                return [2 /*return*/];
        }
    });
}); })().catch(function (e) {
    // Deal with the fact the chain failed
});
