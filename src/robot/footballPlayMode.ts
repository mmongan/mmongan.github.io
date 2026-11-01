import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { scene } from '../scene/engine';
import { getDrillTransportState, getRobotCounts, setRobotColor, setRobotFootballMotion,
  TOP_DOWN_MARKER_LAYER_MASK } from './robot';
import { footballMovement } from './footballMovement';
import { setFootballTeam } from './footballPresentation';
import { getFootballSymbolTemplate } from './footballSymbolModel';
import { createFootballHumanModel } from './footballHumanModel';
import { scrimmageBenchSeat, scrimmageSeatedBlend } from './scrimmageGeometry';
import { floorCalibrationToggle, footballFormationSelect, footballPlaySelect, footballLoadButton,
  footballExitButton, footballStatus, scrimmageButton } from '../ui/dom';
import { FOOTBALL_FORMATIONS, FOOTBALL_PLAYS, FOOTBALL_FORMATION_OPTIONS, FOOTBALL_PLAY_OPTIONS,
  FOOTBALL_SCRIMMAGE_DEFAULT,
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
  formation.value = FOOTBALL_SCRIMMAGE_DEFAULT.formation;
  play.value = FOOTBALL_SCRIMMAGE_DEFAULT.play;
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
  const animations: { robot: TransformNode; player: FootballPlayer; root: TransformNode;
    human: ReturnType<typeof createFootballHumanModel> }[] = [];
  const material = (name: string, color: Color3) => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = color;
    result.specularColor = new Color3(.12, .12, .12);
    materials.push(result);
    return result;
  };
  const cleanup = () => {
    animations.forEach(({ human }) => human.dispose());
    players.forEach(({ robot }) => {
      setRobotFootballMotion(robot, null);
      setFootballTeam(robot, null);
    });
    roots.forEach(root => root.dispose());
    materials.forEach(value => value.dispose(false, true));
    hiddenNodes.forEach(({ node, enabled }) => { if (!node.isDisposed()) node.setEnabled(enabled); });
  };
  try {
    const offense = material('football-offense', Color3.FromHexString('#1967d2'));
    const defense = material('football-defense', Color3.FromHexString('#c62828'));
    const white = material('football-facemask', Color3.White());
    const dark = material('football-eyes', Color3.FromHexString('#18263b'));
    const skins = ['#f2c7a5', '#b77c50', '#67432f'].map((color, index) =>
      material(`football-skin-${index}`, Color3.FromHexString(color)));
    if (visibleFromCount > 0) {
      const benchMaterial = material('football-bench', Color3.FromHexString('#a7afb9'));
      for (const side of [-1, 1]) {
        const bench = new TransformNode(`football-bench-${side}`, scene);
        bench.parent = parent;
        bench.position.set(scrimmageBenchSeat(side < 0 ? 0 : 11).x, -.48, 0);
        roots.push(bench);
        const seat = MeshBuilder.CreateBox(`football-bench-seat-${side}`,
          { width: .55, height: .08, depth: 12.2 }, scene);
        const teamMaterial = side < 0 ? offense : defense;
        seat.parent = bench; seat.position.y = .43; seat.material = teamMaterial; seat.isPickable = false;
        const back = MeshBuilder.CreateBox(`football-bench-back-${side}`,
          { width: .08, height: .55, depth: 12.2 }, scene);
        back.parent = bench; back.position.set(side * .32, .75, 0);
        back.material = teamMaterial; back.isPickable = false;
        const text = new DynamicTexture(`football-bench-label-${side}`, { width: 1024, height: 128 }, scene, false);
        text.drawText(side < 0 ? 'OFFENSE TEAM BENCH' : 'DEFENSE TEAM BENCH',
          null, 85, 'bold 65px Arial', 'white', side < 0 ? '#1967d2' : '#c62828', true);
        const labelMaterial = material(`football-bench-label-material-${side}`, Color3.White());
        labelMaterial.diffuseTexture = text;
        const label = MeshBuilder.CreatePlane(`football-bench-label-${side}`, { width: 5, height: .4 }, scene);
        label.parent = bench;
        label.position.set(side * .367, .75, 0);
        label.rotation.y = -side * Math.PI / 2;
        label.material = labelMaterial; label.isPickable = false;
        for (const z of [-5, 0, 5]) {
          const support = MeshBuilder.CreateBox(`football-bench-support-${side}-${z}`,
            { width: .45, height: .39, depth: .16 }, scene);
          support.parent = bench; support.position.set(0, .195, z);
          support.material = benchMaterial; support.isPickable = false;
        }
      }
    }
    for (const { robot, player } of players) {
      setFootballTeam(robot, player.team);
      setRobotFootballMotion(robot, { team: player.team, role: player.label, playStart: visibleFromCount });
      setRobotColor(robot, player.team === 'offense' ? offense.diffuseColor : defense.diffuseColor);
      // Human football meshes follow the existing route, selection root and leg solver.
      const body = robot.getChildren().find(node => node.name === 'marcherBody');
      const instrument = robot.getChildren().find(node => node.name === 'marcherInstrumentRoot');
      const marker = robot.getChildren().find(node => node.name === 'robotTopDownMarker');
      for (const node of [body, instrument, marker]) {
        if (node instanceof TransformNode) {
          hiddenNodes.push({ node, enabled: node.isEnabled(false) });
          node.setEnabled(false);
        }
      }
      const root = new TransformNode(`football-player-${player.id}`, scene);
      root.parent = robot;
      roots.push(root);
      const symbol = getFootballSymbolTemplate(scene, player.team, TOP_DOWN_MARKER_LAYER_MASK)
        .createInstance('robotTopDownMarker');
      symbol.parent = robot;
      symbol.position.y = 2;
      symbol.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
      symbol.isPickable = false;
      symbol.setEnabled(Number.isFinite(visibleFromCount));
      roots.push(symbol);
      const human = createFootballHumanModel(robot, root, player.team === 'offense' ? offense : defense,
        skins[animations.length % skins.length], white, dark);
      animations.push({ robot, player, root, human });
      const label = new DynamicTexture(`football-label-${player.id}`, { width: 256, height: 128 }, scene, false);
      label.drawText(player.label, null, 90, 'bold 60px Arial', 'white', '#18263b', true);
      const labelMaterial = material(`football-label-material-${player.id}`, Color3.White());
      labelMaterial.diffuseTexture = label; labelMaterial.emissiveColor = Color3.White();
      const plate = MeshBuilder.CreatePlane(`football-role-${player.id}`, { width: .6, height: .3 }, scene);
      plate.parent = root; plate.position.set(0, .3, .19); plate.rotation.y = Math.PI;
      plate.scaling.set(.65, .65, .65);
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
      const currentBeat = getDrillTransportState().beat;
      for (const [playerIndex, { robot, player, root, human }] of animations.entries()) {
        const counts = getRobotCounts(robot);
        const index = Math.min(Math.floor(currentBeat), Math.max(0, (counts?.length ?? 1) - 1));
        const from = counts?.[index]?.position;
        const to = counts?.[index + 1]?.position ?? from;
        const movement = footballMovement({ team: player.team, role: player.label, playStart: visibleFromCount },
          currentBeat, from && to ? to.x - from.x : 0, from && to ? to.z - from.z : 0);
        let steps = (currentBeat - index) * movement.stepsPerCount;
        for (let count = 0; counts && count < index; count++) {
          const a = counts[count].position, b = counts[count + 1].position;
          steps += footballMovement({ team: player.team, role: player.label, playStart: visibleFromCount },
            count, b.x - a.x, b.z - a.z).stepsPerCount;
        }
        const phase = steps * Math.PI;
        const bob = movement.stepsPerCount ? Math.abs(Math.sin(phase)) * .04 : 0;
        const seated = scrimmageSeatedBlend(currentBeat, visibleFromCount);
        const benchSeat = scrimmageBenchSeat(playerIndex);
        const benchYaw = benchSeat.x < 0 ? Math.PI / 2 : -Math.PI / 2;
        root.position.y = .98 + (bob - movement.crouch) * (1 - seated) - .38 * seated;
        root.rotation.x = movement.lean * (1 - seated) + .03 * seated;
        root.rotation.y = (seated > 0 ? benchYaw : movement.bodyYaw) - robot.rotation.y;
        human.arms.forEach((arm, side) => {
          arm.rotation.x = seated > 0 ? -.4 : movement.gait === 'block' ? -1.15 :
            Math.sin(phase + side * Math.PI) * movement.armSwing;
        });
        human.updateLegs(seated, benchYaw - robot.rotation.y);
      }
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
