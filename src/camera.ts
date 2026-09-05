import * as BABYLON from 'babylonjs';
import { canvas } from './dom';
import { engine, scene } from './engineScene';

// FPS-style fly camera: mouse-drag looks around, WASD moves in the direction
// you're actually facing (including up/down when looking up or down) — the
// standard control scheme for a free-fly/spectator camera in most games.
export const camera = new BABYLON.UniversalCamera(
  "camera",
  new BABYLON.Vector3(0, 5, -45),
  scene
);
camera.setTarget(new BABYLON.Vector3(0, 1.4, 0));
camera.attachControl(canvas, true);
camera.keysUp = [87]; // W
camera.keysDown = [83]; // S
camera.keysLeft = [65]; // A
camera.keysRight = [68]; // D
camera.speed = 0.6;
camera.angularSensibility = 4000;
camera.minZ = 0.1;
camera.maxZ = 2000;
camera.inertia = 0.7;
camera.checkCollisions = true;
camera.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);
camera.ellipsoidOffset = new BABYLON.Vector3(0, 0, 0);

// Arrow keys turn/look around (yaw with left/right, pitch with up/down),
// same idea as mouse-look but for keyboard-only navigation.
const turnKeysHeld: Record<string, boolean> = {};
window.addEventListener("keydown", (event) => {
  if (event.key.startsWith("Arrow")) {
    turnKeysHeld[event.key] = true;
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key.startsWith("Arrow")) {
    turnKeysHeld[event.key] = false;
  }
});

const TURN_SPEED = 1.6; // radians per second
const PITCH_LIMIT = 1.5;

// Keep the player off the field's outer apron/void, and stop them before the
// bleachers' near edge (fieldWidthYards/2 + 4 ≈ 30.67) entirely — cheaper and
// simpler than colliding with every individual riser/bench mesh.
const STADIUM_BOUNDARY_X = 29;
const STADIUM_BOUNDARY_Z = 65;
// Floor clamp instead of turf collision — the field mesh doesn't need
// checkCollisions just to keep the camera from dropping below it.
const FIELD_FLOOR_Y = -0.3;

scene.onBeforeRenderObservable.add(() => {
  const turnAmount = (TURN_SPEED * engine.getDeltaTime()) / 1000;
  if (turnKeysHeld["ArrowLeft"]) camera.rotation.y -= turnAmount;
  if (turnKeysHeld["ArrowRight"]) camera.rotation.y += turnAmount;
  if (turnKeysHeld["ArrowUp"]) camera.rotation.x -= turnAmount;
  if (turnKeysHeld["ArrowDown"]) camera.rotation.x += turnAmount;
  camera.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camera.rotation.x));

  camera.position.x = Math.max(-STADIUM_BOUNDARY_X, Math.min(STADIUM_BOUNDARY_X, camera.position.x));
  camera.position.z = Math.max(-STADIUM_BOUNDARY_Z, Math.min(STADIUM_BOUNDARY_Z, camera.position.z));
  camera.position.y = Math.max(FIELD_FLOOR_Y, camera.position.y);
});
