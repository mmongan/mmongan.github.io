import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { canvas } from '../ui/dom';
import { engine, scene } from '../scene/engine';
import { FIELD_SURFACE_Y } from '../field/constants';

// FPS-style fly camera: mouse-drag looks around, WASD moves in the direction
// you're actually facing (including up/down when looking up or down) — the
// standard control scheme for a free-fly/spectator camera in most games.
// Video board screen center (see field/videoBoard.ts) — the landing shot
// starts close enough to it that the title fills the screen, then pulls
// straight back along the same line so it ends the reveal still facing it.
const INTRO_CAMERA_TARGET = new Vector3(0, 14, 67.55);
const INTRO_CAMERA_POSITION = new Vector3(0, 14, 52.5);
export const INTRO_DURATION_MS = 3200;

// Resting spot is the 50 yard line (z=0) at standing eye height, still facing the board.
const DEFAULT_CAMERA_POSITION = new Vector3(0, FIELD_SURFACE_Y + 1.8, 0);
const DEFAULT_CAMERA_TARGET = INTRO_CAMERA_TARGET;

export const camera = new UniversalCamera("camera", INTRO_CAMERA_POSITION.clone(), scene);
camera.setTarget(INTRO_CAMERA_TARGET);
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
camera.ellipsoid = new Vector3(0.4, 0.9, 0.4);
camera.ellipsoidOffset = new Vector3(0, 0, 0);

// Dolly back from the title to the normal spectator framing, then hand
// control to the player — mouse-look is withheld until the reveal finishes
// so it can't fight the scripted pull-back.
let introElapsedMs = 0;
const introObserver = scene.onBeforeRenderObservable.add(() => {
  introElapsedMs += engine.getDeltaTime();
  const t = Math.min(1, introElapsedMs / INTRO_DURATION_MS);
  const eased = 1 - Math.pow(1 - t, 3);
  Vector3.LerpToRef(INTRO_CAMERA_POSITION, DEFAULT_CAMERA_POSITION, eased, camera.position);
  camera.setTarget(Vector3.Lerp(INTRO_CAMERA_TARGET, DEFAULT_CAMERA_TARGET, eased));

  if (t >= 1) {
    scene.onBeforeRenderObservable.remove(introObserver);
    camera.attachControl(canvas, true);
  }
});

export function isCameraIntroComplete(): boolean {
  return introElapsedMs >= INTRO_DURATION_MS;
}

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
const FIELD_FLOOR_Y = DEFAULT_CAMERA_POSITION.y;

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

