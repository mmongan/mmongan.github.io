import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import '@babylonjs/core/Culling/ray.js';

const chartSource = readFileSync(new URL('../src/menu/drillChartPad.ts', import.meta.url), 'utf8');
const scoreSource = readFileSync(new URL('../src/menu/musicStand.ts', import.meta.url), 'utf8');
const chartPlace = chartSource.match(/function placeInFrontOfViewer\(\) \{[\s\S]*?\n\}/)[0];
const scorePlace = scoreSource.match(/  function place\(\) \{[\s\S]*?\n  \}/)[0];
const chartConstants = chartSource.match(/^const (?:DESKTOP_)?SPAWN_(?:DISTANCE|DROP) = .*;$/gm).join('\n');
const panelSource = readFileSync(new URL('../src/menu/floatingPanel.ts', import.meta.url), 'utf8');
const engine = new NullEngine();
const scene = new Scene(engine);
const panelContext = vm.createContext({ Matrix, Quaternion, Vector3, Plane, scene,
  isARTabletopModeActive: () => false });
vm.runInContext(`${stripTypeScriptTypes(panelSource, { mode: 'transform' })
  .replace(/^import .*?;\r?$/gm, '').replace(/export /g, '')}
globalThis.FloatingPanel = FloatingPanel;`, panelContext);

try {
for (const inXR of [false, true]) {
  for (const pitch of [0, 0.65, -0.5, Math.PI / 2]) {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const eye = new Vector3(7, 1.7, -3);
    const camera = new FreeCamera('placementCamera', eye.clone(), scene);
    camera.rotation.set(pitch, yaw, 0);
    camera.getClassName = () => inXR ? 'WebXRCamera' : 'UniversalCamera';
    scene.activeCamera = camera;
    camera.getViewMatrix(true);
    const chart = new TransformNode('chart', scene);
    const score = new TransformNode('score', scene);
    const chartInteraction = new panelContext.FloatingPanel(chart, new Set(), chart, Vector3.One());
    const interaction = new panelContext.FloatingPanel(score, new Set(), score, Vector3.One());
    interaction.userPlaced = true;
    const context = vm.createContext({
      Vector3, Quaternion, scene,
      pad: { root: chart, interaction: chartInteraction }, root: score, interaction,
      placedCamera: null, placed: false, enabled: true,
      isDraftingToolsEnabled: () => false,
    });
    vm.runInContext(`${chartConstants}\n${chartPlace}\n${scorePlace}\nplaceInFrontOfViewer(); place();`, context);
    const chartOffset = chart.position.subtract(eye);
    const scoreOffset = score.position.subtract(eye);
    const forward = camera.getForwardRay().direction.clone();
    if (inXR) forward.y = 0;
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    if (right.lengthSquared() < 1e-6) right.copyFrom(camera.getDirection(Vector3.Right()));
    right.normalize();
    assert.ok(Math.abs(Vector3.Dot(chartOffset, right) + (inXR ? 0.3 : 0.45)) < 1e-6, 'Chart opens on viewer left');
    assert.ok(Math.abs(Vector3.Dot(scoreOffset, right) - (inXR ? 0.3 : 0.7)) < 1e-6, 'Score opens on viewer right');
    const expectedChart = forward.scale(inXR ? 0.42 : 1).add(right.scale(inXR ? -0.3 : -0.45));
    expectedChart.y -= inXR ? 0.22 : 0.08;
    const expectedScore = forward.scale(inXR ? 0.42 : 1.6).add(right.scale(inXR ? 0.3 : 0.7));
    expectedScore.y += inXR ? -0.22 : 0.12;
    assert.ok(Vector3.Distance(chartOffset, expectedChart) < 1e-6);
    assert.ok(Vector3.Distance(scoreOffset, expectedScore) < 1e-6);
    if (inXR) {
      assert.ok(chartOffset.length() < 0.6 && scoreOffset.length() < 0.6,
        'Both XR panel centers remain within 60 cm of the eyes');
      const chartHandle = Vector3.TransformCoordinates(new Vector3(0.125, 0.1675, -0.01), chart.computeWorldMatrix(true));
      const scoreDesk = new TransformNode('scoreDesk', scene);
      scoreDesk.parent = score;
      scoreDesk.rotation.x = Math.PI / 10;
      const scoreHandle = Vector3.TransformCoordinates(new Vector3(0.21, 0.31, -0.01), scoreDesk.computeWorldMatrix(true));
      assert.ok(Vector3.Distance(chartHandle, eye) < 0.75 && Vector3.Distance(scoreHandle, eye) < 0.75,
        'Header transparency handles remain within 75 cm at default size');
      scoreDesk.dispose();
    }
    assert.equal(interaction.userPlaced, false, 'Explicit score placement resets user-positioned state');
    assert.ok([chart.rotationQuaternion, score.rotationQuaternion].every(q =>
      [q.x, q.y, q.z, q.w].every(Number.isFinite)), 'Vertical views must have valid panel rotations');
    chart.dispose();
    score.dispose();
    camera.dispose();
  }
  }
}
for (const scale of [.002, 1 / 120, .05]) {
  for (const fieldYaw of [0, .6, Math.PI / 2]) {
    for (const cameraYaw of [0, .9, Math.PI]) {
      const desktop = new FreeCamera('desktopBeforeAR', new Vector3(2, 1.7, -3), scene);
      scene.activeCamera = desktop;
      let inAR = false;
      const pivot = new Vector3(2.3, 1, -2.4);
      Object.assign(panelContext, {
        isARTabletopModeActive: () => inAR,
        getARScale: () => scale, getARRotation: () => fieldYaw, getARPosition: () => pivot.clone(),
        FIELD_LENGTH_YARDS: 120, FIELD_WIDTH_YARDS: 53.333,
      });
      const definitions = [
        { name: 'chartAR', half: new Vector3(.23, .2, .02), side: -.3 },
        { name: 'scoreAR', half: new Vector3(.35, .35, .04), side: .3 },
        { name: 'settingsAR', half: new Vector3(.45, .65, .03), side: 0 },
      ];
      const entries = definitions.map(({ name, half, side }) => {
        const root = new TransformNode(name, scene);
        const panel = new panelContext.FloatingPanel(root, new Set(), root, half);
        const placement = { desktop: { distance: 1.6, height: 0 }, xr: { distance: .42, height: -.22 }, side };
        panel.placeForViewer(placement);
        return { root, panel, placement, half, side };
      });
      const camera = new FreeCamera('ARCamera', desktop.position.clone(), scene);
      camera.rotation.set(.6, cameraYaw, 0);
      camera.getClassName = () => 'WebXRCamera';
      scene.activeCamera = camera;
      inAR = true;
      // XR entry summons settings before the next render; earlier panels must also migrate.
      entries[2].panel.placeForViewer(entries[2].placement);
      scene.onBeforeRenderObservable.notifyObservers(scene);
      pivot.addInPlace(new Vector3(.2, 0, .1));
      panelContext.placeAutomaticFloatingPanels();
      const right = new Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const fieldExtent = scale * .5 * (
        120 * Math.abs(Math.cos(cameraYaw - fieldYaw)) +
        53.333 * Math.abs(Math.sin(cameraYaw - fieldYaw)));
      const fieldCenter = Vector3.Dot(pivot, right);
      const bounds = entries.map(({ root, half, side }) => {
        const projections = [];
        for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
          projections.push(Vector3.Dot(Vector3.TransformCoordinates(new Vector3(x, y, z),
            root.computeWorldMatrix(true)), right));
        }
        const min = Math.min(...projections), max = Math.max(...projections);
        assert.ok(side < 0 ? max <= fieldCenter - fieldExtent - .08 + 1e-5
          : min >= fieldCenter + fieldExtent + .08 - 1e-5,
        'The entire panel, not just its center, clears the rotated/scaled field by 8 cm');
        return { min, max };
      });
      assert.ok(bounds[2].min >= bounds[1].max + .08 - 1e-5,
        'Settings does not overlap the score panel on the same side');
      const poses = entries.map(({ root }) => root.computeWorldMatrix(true).clone());
      for (let repeat = 0; repeat < 3; repeat++) {
        entries.forEach(({ panel, placement }) => panel.placeForViewer(placement));
        entries.forEach(({ root }, index) => assert.ok(root.computeWorldMatrix(true).equalsWithEpsilon(poses[index], 1e-5),
          'Repeated recall does not drift panels progressively farther away'));
      }
      entries[0].panel.begin('left', Matrix.Identity());
      entries[0].panel.update('left', Matrix.Translation(.1, .2, .3));
      entries[0].panel.end('left');
      const manual = entries[0].root.computeWorldMatrix(true).clone();
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(entries[0].root.computeWorldMatrix(true).equalsWithEpsilon(manual, 1e-5),
        'Automatic AR layout does not fight manual grip positioning');
      entries.forEach(({ root }) => root.dispose());
      camera.dispose();
      desktop.dispose();
    }
  }
}
console.log('Panel placement checks passed: desktop/VR layouts, headings/pitches, AR camera migration, full-bound field clearance at three scales/rotations, panel spacing, stable recall, and manual placement.');
} finally {
  scene.dispose();
  engine.dispose();
}
