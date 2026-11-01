import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { getDrillTransportState, getRobotCounts, setRobotColor } from './robot';
import { floorCalibrationToggle, footballFormationSelect, footballPlaySelect, footballLoadButton,
  footballExitButton, footballStatus, scrimmageButton } from '../ui/dom';
import { FOOTBALL_FORMATIONS, FOOTBALL_PLAYS, FOOTBALL_FORMATION_OPTIONS, FOOTBALL_PLAY_OPTIONS,
  type FootballFormation, type FootballPlay, type FootballBallEvent, type FootballPlayer } from './footballPlayGeometry';

export type FootballCommand = 'load' | 'exit' | 'formation' | 'play' | 'scrimmage';
let notifyFootball = (message: string) => {
  if (footballStatus) footballStatus.value = message;
};

export function executeFootballCommand(command: FootballCommand) {
  if (command === 'load') footballLoadButton?.click();
  else if (command === 'scrimmage') scrimmageButton?.click();
  else if (command === 'exit') footballExitButton?.click();
  else {
    const select = command === 'formation' ? footballFormationSelect : footballPlaySelect;
    if (!select) throw new Error('Football play controls are unavailable.');
    select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
    select.dispatchEvent(new Event('change'));
    notifyFootball(`Selected ${select.selectedOptions[0].text}. Load play to apply.`);
  }
}

export function initFootballControls(load: (formation: FootballFormation, play: FootballPlay) => void,
  exit: () => void, notify: (message: string) => void,
  scrimmage: (formation: FootballFormation, play: FootballPlay) => void) {
  notifyFootball = message => {
    if (footballStatus) footballStatus.value = message;
    notify(message);
  };
  const formation = footballFormationSelect;
  const play = footballPlaySelect;
  if (!formation || !play || !footballLoadButton || !footballExitButton) return;
  formation.replaceChildren(...FOOTBALL_FORMATION_OPTIONS.map(option => new Option(option.label, option.value)));
  play.replaceChildren(...FOOTBALL_PLAY_OPTIONS.map(option => new Option(option.label, option.value)));
  const run = (scrimmageMode = false) => {
    try {
      const selectedFormation = FOOTBALL_FORMATIONS.find(value => value === formation.value);
      const selectedPlay = FOOTBALL_PLAYS.find(value => value === play.value);
      if (!selectedFormation || !selectedPlay) throw new Error('Select a valid football formation and play.');
      if (scrimmageMode) scrimmage(selectedFormation, selectedPlay);
      else load(selectedFormation, selectedPlay);
      notifyFootball(scrimmageMode ? 'Scrimmage: band walks off, players walk on, then the play runs.'
        : '22 players ready. Use the timeline to play/scrub; select players to edit routes and set endpoints.');
    } catch (error) {
      console.error('Football play setup failed:', error);
      notifyFootball(error instanceof Error ? error.message : String(error));
    }
  };
  const leave = () => {
    try { exit(); notifyFootball('Football mode exited; previous band and timeline restored.'); }
    catch (error) {
      console.error('Could not exit football mode:', error);
      notifyFootball(error instanceof Error ? error.message : String(error));
    }
  };
  const loadClick = () => run();
  const scrimmageClick = () => run(true);
  footballLoadButton.addEventListener('click', loadClick);
  scrimmageButton?.addEventListener('click', scrimmageClick);
  footballExitButton.addEventListener('click', leave);
  scene.onDisposeObservable.addOnce(() => {
    footballLoadButton?.removeEventListener('click', loadClick);
    scrimmageButton?.removeEventListener('click', scrimmageClick);
    footballExitButton?.removeEventListener('click', leave);
  });
}

export function createFootballVisuals(
  players: ReadonlyArray<{ robot: TransformNode; player: FootballPlayer }>,
  events: ReadonlyArray<FootballBallEvent>, parent: TransformNode, visibleFromCount = 0,
) {
  const materials: StandardMaterial[] = [];
  const roots: TransformNode[] = [];
  const hiddenNodes: { node: TransformNode; enabled: boolean }[] = [];
  const material = (name: string, color: Color3) => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = color;
    materials.push(result);
    return result;
  };
  const cleanup = () => {
    roots.forEach(root => root.dispose());
    materials.forEach(value => value.dispose(false, true));
    hiddenNodes.forEach(({ node, enabled }) => { if (!node.isDisposed()) node.setEnabled(enabled); });
  };
  try {
    const offense = material('football-offense', Color3.FromHexString('#1967d2'));
    const defense = material('football-defense', Color3.FromHexString('#c62828'));
    const white = material('football-facemask', Color3.White());
    for (const { robot, player } of players) {
      setRobotColor(robot, player.team === 'offense' ? offense.diffuseColor : defense.diffuseColor);
      // Keep the existing leg solver and selection root, replacing only the band's upper body.
      const body = robot.getChildren().find(node => node.name === 'marcherBody');
      const instrument = robot.getChildren().find(node => node.name === 'marcherInstrumentRoot');
      for (const node of [body, instrument]) {
        if (node instanceof TransformNode) {
          hiddenNodes.push({ node, enabled: node.isEnabled(false) });
          node.setEnabled(false);
        }
      }
      const root = new TransformNode(`football-player-${player.id}`, scene);
      root.parent = robot;
      roots.push(root);
      const jersey = MeshBuilder.CreateBox(`football-jersey-${player.id}`,
        { width: .64, height: .65, depth: .35 }, scene);
      jersey.parent = root; jersey.position.y = 1.04;
      jersey.material = player.team === 'offense' ? offense : defense;
      const helmet = MeshBuilder.CreateSphere(`football-helmet-${player.id}`, { diameter: .44, segments: 8 }, scene);
      helmet.parent = root; helmet.position.y = 1.62; helmet.material = jersey.material;
      const mask = MeshBuilder.CreateTorus(`football-mask-${player.id}`,
        { diameter: .3, thickness: .025, tessellation: 8 }, scene);
      mask.parent = root; mask.rotation.x = Math.PI / 2; mask.position.set(0, 1.56, .18); mask.material = white;
      for (const side of [-1, 1]) {
        const arm = MeshBuilder.CreateCapsule(`football-arm-${player.id}-${side}`,
          { height: .55, radius: .09, tessellation: 6, subdivisions: 1 }, scene);
        arm.parent = root; arm.position.set(side * .35, 1.02, .12); arm.rotation.x = -.4;
        arm.material = jersey.material;
      }
      const label = new DynamicTexture(`football-label-${player.id}`, { width: 256, height: 128 }, scene, false);
      label.drawText(player.label, null, 90, 'bold 60px Arial', 'white', '#18263b', true);
      const labelMaterial = material(`football-label-material-${player.id}`, Color3.White());
      labelMaterial.diffuseTexture = label; labelMaterial.emissiveColor = Color3.White();
      const plate = MeshBuilder.CreatePlane(`football-role-${player.id}`, { width: .6, height: .3 }, scene);
      plate.parent = root; plate.position.set(0, 1.03, .19); plate.rotation.y = Math.PI;
      plate.material = labelMaterial;
    }
    const ball = MeshBuilder.CreateSphere('football-ball', { diameter: .24, segments: 8 }, scene);
    roots.push(ball);
    ball.parent = parent; ball.scaling.set(1, 1, 1.65); ball.isPickable = false;
    ball.material = material('football-leather', Color3.FromHexString('#754024'));
    const byId = new Map(players.map(({ robot, player }) => [player.id, robot]));
    const anchor = (id: string, count: number) => {
      const robot = byId.get(id);
      if (!robot || robot.isDisposed() || !robot.isEnabled()) return null;
      const counts = getRobotCounts(robot);
      if (!counts?.length) return null;
      const beat = Math.max(0, Math.min(counts.length - 1, count));
      const index = Math.floor(beat);
      return Vector3.Lerp(counts[index].position, counts[Math.min(index + 1, counts.length - 1)].position,
        beat - index).add(new Vector3(0, 1.05, 0));
    };
    const update = () => {
      ball.setEnabled(!floorCalibrationToggle?.checked && getDrillTransportState().beat >= visibleFromCount);
      if (!ball.isEnabled()) return;
      const beat = getDrillTransportState().beat;
      let carrier = events[0]?.fromId;
      for (const event of events) {
        if (beat < event.startCount) break;
        if (beat >= event.endCount) { carrier = event.toId; continue; }
        const from = anchor(event.fromId, event.startCount);
        const to = anchor(event.toId, event.endCount);
        if (!from || !to) { ball.setEnabled(false); return; }
        const t = (beat - event.startCount) / (event.endCount - event.startCount);
        ball.position.copyFrom(Vector3.Lerp(from, to, t));
        if (event.kind === 'pass') ball.position.y += 4 * t * (1 - t) * 4;
        ball.rotation.z = beat * Math.PI * 2;
        return;
      }
      const position = carrier ? anchor(carrier, beat) : null;
      if (position) ball.position.copyFrom(position);
      else ball.setEnabled(false);
    };
    const observer = scene.onBeforeRenderObservable.add(update);
    update();
    return () => {
      scene.onBeforeRenderObservable.remove(observer);
      cleanup();
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
