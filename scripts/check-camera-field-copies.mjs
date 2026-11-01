import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const transform = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine();
const scene = new Scene(engine);
const field = new TransformNode('testFieldCoordinates', scene);
const state = { beat: 3.25, route: [1, 2, 3], guide: 'original' };
let current = structuredClone(state);
let allowed = true;
let snaps = 0;
let restoreFailure = false;
const notices = [];
const panels = [];
const actions = [];
const timeLabels = new Map();
class DynamicTexture extends BaseTexture {
  constructor() { super(scene); this.canvas = { pixels: 'blank' }; }
  update() {}
  clone() { return new DynamicTexture(); }
  getContext() { return {
    canvas: this.canvas, drawImage: canvas => { this.canvas.pixels = canvas.pixels; },
  }; }
}
class FloatingPanel {
  constructor(root, meshes, surface, halfSize, buttons, resize) {
    Object.assign(this, { root, meshes, surface, halfSize, buttons, resize });
    this.hands = new Map();
    panels.push(this);
  }
  grabbed(source) { return source === undefined ? this.hands.size > 0 : this.hands.has(source); }
  begin(source, world) { this.hands.set(source, world); }
  update(source, world) {
    if (this.grabbed(source)) world.decompose(this.root.scaling, this.root.rotationQuaternion, this.root.position);
  }
  end(source) { this.hands.delete(source); }
  release() { this.hands.clear(); }
}
const context = vm.createContext({
  Mesh, InstancedMesh, MeshBuilder, TransformNode, Matrix, Quaternion, Vector3, Vector4, Color3, Color4,
  StandardMaterial, Observable, scene, FloatingPanel, performance, MaterialPluginBase, RegisterClass,
  FIELD_SURFACE_Y: -.48, FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120,
  getARPosition: () => field.position.clone(), getARRotation: () => field.rotationQuaternion.toEulerAngles().y,
  getARScale: () => field.scaling.x,
  getFieldHeightMode: () => 'floor', setFieldHeightMode() {},
  getARSurfaceHeight: () => field.position.y - .48 * field.scaling.x,
  setARPosition: value => field.position.copyFrom(value),
  setARRotation: value => { field.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), value); },
  setARFieldCopyScale: value => field.scaling.setAll(value),
  preserveARSurfaceHeight: height => { field.position.y = height + .48 * field.scaling.x; },
  registerMenuButton: (mesh, action) => actions.push({ mesh, action }),
  drawPanelButton() {},
  document: { createElement: () => ({ getContext: () => new Proxy({
    fillText: text => { const [, id, time] = /^Field (\d+) · (.*)$/.exec(text) ?? []; if (id) timeLabels.set(Number(id), time); },
  }, { get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; } }) }) },
  DynamicTexture,
});
vm.runInContext(transform(read('../src/field/draftingFieldPreview.ts')), context);
vm.runInContext(transform(read('../src/interaction/editingMode.ts')), context);
vm.runInContext(transform(read('../src/robot/jacketLegOcclusion.ts')), context);
vm.runInContext(transform(read('../src/interaction/cameraFieldCopies.ts')), context);
field.scaling.setAll(.01);
field.position.set(2, 1.2, 3);
field.rotationQuaternion = Quaternion.FromEulerAngles(0, .7, 0);
const surface = MeshBuilder.CreateGround('field', { width: 53.333, height: 120 }, scene);
surface.position.y = -.48;
surface.parent = field;
surface.material = new StandardMaterial('liveTurf', scene);
const robot = new TransformNode('pathRobot', scene);
robot.parent = field;
robot.position.set(4, 0, 2);
const partSource = MeshBuilder.CreateBox('bodyInstances', {}, scene);
partSource.isVisible = false;
partSource.material = new StandardMaterial('liveUniform', scene);
vm.runInContext('globalThis.createLegMaterialPlugin = material => new JacketLegOcclusion(material);', context);
context.createLegMaterialPlugin(partSource.material);
partSource.registerInstancedBuffer('color', 4);
partSource.instancedBuffers.color = new Color4(1, 1, 1, 1);
partSource.registerInstancedBuffer('jacketPlane', 4);
partSource.instancedBuffers.jacketPlane = new Vector4(0, 0, 0, -1);
const body = partSource.createInstance('marcherJacket');
body.parent = robot;
body.instancedBuffers.color = new Color4(.2, .4, .8, 1);
body.instancedBuffers.jacketPlane = new Vector4(1, 2, 3, 4);
const markerSource = MeshBuilder.CreateDisc('robotTopDownMarkerInstances', {}, scene);
markerSource.isVisible = false;
markerSource.layerMask = 0x20000000;
const marker = markerSource.createInstance('robotTopDownMarker');
marker.parent = robot;
marker.layerMask = 0x20000000;
const guide = MeshBuilder.CreateTube('drawingGuide', {
  path: [new Vector3(0, -.45, 0), new Vector3(2, -.45, 1)], radius: .01,
}, scene);
guide.parent = field;
guide.material = new StandardMaterial('liveYarn', scene);
const label = MeshBuilder.CreatePlane('draftingGuideLabel', {}, scene);
label.parent = field;
label.material = new StandardMaterial('liveLabel', scene);
const labelTexture = new DynamicTexture();
labelTexture.canvas.pixels = '12 yards';
label.material.diffuseTexture = labelTexture;
const tool = MeshBuilder.CreateBox('draftingCameraBody', {}, scene);
const textureBaseline = scene.textures.length;
const copyManager = context.createCameraFieldCopies({
  field,
  allowed: () => allowed,
  capture: () => structuredClone(current),
  restore: snapshot => {
    if (restoreFailure && snapshot.guide === 'original') throw new Error('test restore failure');
    current = structuredClone(snapshot);
  },
  notify: message => notices.push(message),
  timeLabel: () => `Beat ${current.beat}`,
  beforeCapture: () => { snaps++; current.beat = Math.round(current.beat); },
});
const root = id => scene.getTransformNodeByName(`cameraFieldCopy-${id}`);
const visualFor = source => scene.meshes.find(mesh =>
  mesh.name === `cameraFieldCopy-mesh-${source.uniqueId}` || mesh.name === `cameraFieldCopy-marcher-${source.uniqueId}`);
try {
  const robotSource = read('../src/robot/robot.ts');
  const playbackSource = robotSource.slice(robotSource.indexOf('export function captureFieldPlayback()'),
    robotSource.indexOf('export function captureDrillMidiTiming('));
  const playbackContext = vm.createContext({ applications: 0,
    players: new Map([[robot, {}]]), invalidateLegBake() {},
  });
  vm.runInContext(`let globalPlayback = { countIndex: 3, stepAccumulatorSeconds: .125,
    speedMultiplier: 2, tempoMultiplier: .4, playing: true };
    let repeatElapsed = 14.25, repeatOptions = { drill: true, song: true, songLength: 20 };
    let playbackTempoMap = [{ beat: 0, bpm: 96 }, { beat: 8, bpm: 120 }];
    let playbackBeatUnits = [{ beat: 0, numerator: 6, denominator: 8 }];
    let playbackPpq = 960, playbackCountTicks = [0, 480, 1440], transportRevision = 0;
    function applyGlobalCountToAllRobots() { applications++; }
  `, playbackContext);
  vm.runInContext(transform(playbackSource), playbackContext);
  const capturedPlayback = playbackContext.captureFieldPlayback();
  assert.equal(capturedPlayback.playback.playing, false, 'Inactive copies never autoplay');
  vm.runInContext('globalPlayback.countIndex = 9; playbackCountTicks[1] = 900; playbackTempoMap[0].bpm = 60;', playbackContext);
  assert.equal(capturedPlayback.playback.countIndex, 3);
  assert.equal(capturedPlayback.countTicks[1], 480);
  assert.equal(capturedPlayback.tempoMap[0].bpm, 96, 'Snapshots retain independently copied MIDI timing');
  playbackContext.restoreFieldPlayback(capturedPlayback);
  assert.deepEqual(playbackContext.captureFieldPlayback(), capturedPlayback,
    'Restoring retains exact count fraction, speed, repeats, meter, tempo map, and PPQ');
  assert.equal(playbackContext.applications, 1, 'Restored transport reapplies the actual marcher pose');
  const scheduleContext = vm.createContext({
    allRobots: new Set([robot]), marcherParts: new Map([[robot, {
      gaitIndex: 2, instrument: 'snare', instrumentRestPose: false,
    }]]), players: new Map(), DEFAULT_STEP_SIZE_YARDS: .625,
    getRobotColor: () => new Color3(.2, .4, .8), ensureSharedObserver() {},
    setMarcherInstrument() {}, setMarcherInstrumentRestPose() {}, setRobotColor() {},
    invalidateLegBake() {}, applyGlobalCount() {},
  });
  vm.runInContext(transform(robotSource.slice(robotSource.indexOf('export function captureMarcherSchedules()'),
    robotSource.indexOf('export function captureBakedMarcherSchedules()'))), scheduleContext);
  vm.runInContext(transform(robotSource.slice(robotSource.indexOf('export function restoreMarcherSchedule('),
    robotSource.indexOf('// Reopens a saved blank page:'))), scheduleContext);
  const standingSnapshot = scheduleContext.captureMarcherSchedules()[0];
  assert.equal(standingSnapshot.scheduled, false, 'Capture distinguishes standing marchers from scheduled holds');
  scheduleContext.restoreMarcherSchedule(robot, standingSnapshot, scene);
  assert.equal(scheduleContext.players.has(robot), false, 'Standing formations remain editable after restore');
  scheduleContext.players.set(robot, { stepSizeYards: .625, counts: [{
    position: robot.position.clone(), rotationY: .5, bakedGait: { gaitIndex: 2, stepsPerCount: .5 },
  }] });
  const scheduledSnapshot = scheduleContext.captureMarcherSchedules()[0];
  assert.equal(scheduledSnapshot.scheduled, true);
  scheduleContext.players.get(robot).counts[0].bakedGait.stepsPerCount = 1;
  assert.equal(scheduledSnapshot.counts[0].bakedGait.stepsPerCount, .5, 'Baked timing is independently copied');
  scheduleContext.restoreMarcherSchedule(robot, scheduledSnapshot, scene);
  assert.equal(scheduleContext.players.get(robot).counts[0].bakedGait.stepsPerCount, .5);
  const editorSource = read('../src/interaction/pathInteraction.ts');
  const editorFunctions = editorSource.slice(editorSource.indexOf('function captureCameraFieldState()'),
    editorSource.indexOf('// Saves every marcher, the open chart page, and drafting'));
  const marcher = new TransformNode('editorSnapshotMarcher', scene);
  marcher.position.set(1.234567, 0, 2.345678);
  let records = [{ robot: marcher, gaitIndex: 2, instrument: 'snare', instrumentRestPose: false,
    color: new Color3(.3, .6, .9), stepSizeYards: .625, label: 'S1',
    counts: [{ position: marcher.position.clone(), rotationY: .7, facingY: .9,
      stepPhase: .25, bakedGait: { gaitIndex: 2, stepsPerCount: .5 } }] }];
  let page = { count: 8, previous: 0, next: 16, waiting: [marcher] };
  let restoredPage;
  let restoredWorkspace;
  const formation = { kind: 'formation', controlPoints: [new Vector3(0, 0, 0), new Vector3(2, 0, 0)],
    robots: [marcher], anchorRobot: marcher, fitClosedCircle: false, linear: true, spacing: 1.25,
    guideLayout: { spacing: 1.25, facing: 'along', facingAngle: 0 }, erasedFormationIndices: new Set([1]) };
  const editorContext = vm.createContext({
    marcherGrabs: new Map(), segments: [formation, { kind: 'path',
      controlPoints: [new Vector3(1, 0, 2), new Vector3(3, 0, 4)], robots: [marcher],
      fitClosedCircle: false, linear: false }],
    captureMarcherSchedules: () => records.map(record => ({ ...record,
      color: record.color.clone(), counts: record.counts.map(count => ({ ...count, position: count.position.clone() })),
    })),
    captureBlankChartPage: () => page, getDrillLabel: robot => records.find(record => record.robot === robot)?.label,
    captureFieldPlayback: () => capturedPlayback, restoreFieldPlayback() {},
    getChartTransition: () => ({ shape: 'straight', pace: 'normal', styleIndex: null }),
    exportDrawingWorkspace: () => 'validated drafting',
    captureChartPageGuides: () => ({ shown: 2, pages: [{ page: 1, drafting: 'other page' }] }),
    getChartPageTimeline: () => ({ beatsPerPage: 8, authoredCounts: [0, 8, 16] }),
    currentShowName: 'Original show', chartPageNames: new Map([[8, 'Arrival']]), chartPageNotes: new Map([[8, 'Hold']]),
    captureShowInfo: () => null, parseDraftingWorkspace() {}, pauseAll() {},
    clearAllRobots: () => { records = []; editorContext.segments.length = 0; },
    createLowPolyRobot: () => new TransformNode('restoredSnapshotMarcher', scene),
    pathRoot: field, scene,
    restoreMarcherSchedule: (robot, schedule) => records.push({ ...schedule, robot }),
    robotPaths: new Map(), updateRobotPathLine() {},
    createSegment: (kind, controlPoints, robots, anchorRobot, fitClosedCircle, linear, guideLayout, rebuild) => {
      assert.equal(rebuild, false, 'Restoring groups must not rebuild/reinfer captured schedules');
      const segment = { kind, controlPoints, robots, anchorRobot, fitClosedCircle, linear, guideLayout };
      editorContext.segments.push(segment); return segment;
    },
    acceptedFormationControls: new WeakMap(), rebuildFormationConnections() {},
    setChartTransition() {}, setChartPageTimeline() {}, setDrillLabels() {}, clearDrawingGuides() {},
    importDrawingWorkspace: workspace => { restoredWorkspace = workspace; return true; },
    restoreChartPageGuides: () => true,
    resumeBlankChartPage: snapshot => { restoredPage = snapshot; },
    restoreShowInfo() {}, refreshChartEditorPages() {}, refreshFormationEditor() {}, chartBeatsPerPage: null,
    refreshCollisionMarkers() {}, redrawDrillChartPad() {},
  });
  vm.runInContext(transform(editorFunctions), editorContext);
  const editorSnapshot = editorContext.captureCameraFieldState();
  records[0].counts[0].position.x = 99;
  editorContext.restoreCameraFieldState(editorSnapshot);
  assert.equal(records[0].counts[0].position.x, 1.234567, 'Field state preserves exact coordinates without draft rounding');
  assert.equal(records[0].counts[0].stepPhase, .25, 'Field state preserves authored off-beat phase');
  assert.equal(records[0].counts[0].bakedGait.stepsPerCount, .5, 'Field state preserves baked cadence');
  assert.equal(records[0].gaitIndex, 2);
  assert.equal(records[0].label, 'S1');
  assert.equal(restoredWorkspace, 'validated drafting');
  assert.equal(restoredPage.waiting[0], records[0].robot, 'Blank-page waiting marchers map to recreated roots');
  assert.equal(editorContext.segments[0].robots[0], records[0].robot, 'Formation membership survives field switching');
  assert.equal(editorContext.segments[0].erasedFormationIndices.has(1), true);
  assert.equal(editorContext.segments[1].kind, 'path', 'Authored paths retain their editable control geometry');
  assert.equal(editorContext.segments[1].robots[0], records[0].robot);
  records[0].robot.dispose(); marcher.dispose();
  const livePose = field.computeWorldMatrix(true).clone();
  copyManager.capture();
  assert.equal(snaps, 1, 'Capture snaps the transport to a whole beat first');
  assert.equal(timeLabels.get(1), 'Beat 3', 'Original field is labeled with its whole-beat timeline position');
  assert.equal(timeLabels.get(2), 'Beat 3', 'Snapshot is captured and labeled on a whole beat');
  assert.equal(scene.textures.length, textureBaseline + 11,
    'Capture owns eight control, two time-label, and one cloned guide-label texture, with no discarded material-clone textures');
  assert.ok(root(1) && root(2), 'First capture retains the original field and makes a separate copy');
  assert.ok(field.computeWorldMatrix(true).equals(livePose), 'Shutter never moves or resizes the active field');
  assert.ok(Vector3.Distance(root(2).position, field.position) > .5, 'New snapshot appears separately beside the field');
  const frozenBody = visualFor(body);
  const frozenGuide = visualFor(guide);
  const frozenLabel = visualFor(label);
  assert.equal(frozenLabel.material.diffuseTexture.canvas.pixels, '12 yards',
    'Dynamic guide labels copy their pixels instead of becoming blank');
  assert.notEqual(frozenLabel.material.diffuseTexture, labelTexture, 'Captured labels own their textures');
  assert.ok(frozenBody instanceof InstancedMesh && frozenGuide, 'Snapshot includes marcher poses and committed guides');
  assert.equal(visualFor(tool), undefined, 'Snapshot excludes tools');
  const frozenMarker = visualFor(marker);
  assert.ok(frozenMarker, 'Snapshot includes overhead markers for top-down views');
  assert.equal(frozenMarker.layerMask, 0x20000000, 'Overhead-only markers stay hidden from the normal view');
  assert.equal(frozenMarker.sourceMesh.layerMask, 0x20000000);
  assert.equal(frozenBody.isPickable, false, 'Inactive marchers cannot enter live editor selection');
  assert.equal(frozenBody.checkCollisions, false);
  assert.notEqual(frozenBody.sourceMesh, body.sourceMesh, 'Snapshot has its own instance source');
  assert.notEqual(frozenBody.sourceMesh.geometry, body.sourceMesh.geometry, 'Snapshot owns independent body geometry');
  assert.notEqual(frozenBody.material, body.material, 'Uniform materials survive live disposal/repainting independently');
  const clonedPlugin = frozenBody.material.pluginManager.getPlugin('JacketLegOcclusion');
  assert.equal(clonedPlugin.getClassName(), 'JacketLegOcclusion',
    'Cloned materials preserve the actual clipping plugin rather than a base-class placeholder');
  assert.equal(clonedPlugin.getUniforms().ubo[0].name, 'jacketLegUniform',
    'Cloned materials keep the clipping UBO layout compatible with the marcher shader');
  assert.notEqual(frozenBody.instancedBuffers.color, body.instancedBuffers.color);
  assert.ok(frozenBody.instancedBuffers.color.equals(body.instancedBuffers.color));
  assert.ok(frozenBody.instancedBuffers.jacketPlane.equals(body.instancedBuffers.jacketPlane),
    'Frozen marcher retains clipping/leg instance attributes');
  const frozenPose = frozenBody.computeWorldMatrix(true).clone();
  robot.position.x += 10;
  body.instancedBuffers.color.r = .9;
  guide.dispose(false, true);
  label.dispose(false, true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.ok(frozenBody.computeWorldMatrix(true).equals(frozenPose), 'Inactive snapshots do not follow live playback');
  assert.equal(frozenBody.instancedBuffers.color.r, .2, 'Repainting live uniforms does not recolor snapshots');
  assert.equal(frozenGuide.isDisposed(), false, 'Deleting live guides leaves captured geometry intact');
  assert.equal(frozenLabel.material.diffuseTexture.canvas.pixels, '12 yards',
    'Captured labels survive disposal of their live textures');
  const height = root(2).position.y - .48 * root(2).scaling.x;
  const panel = panels.find(panel => panel.root === root(2));
  panel.begin('left', Matrix.Identity());
  panel.begin('right', Matrix.Identity());
  panel.update('right', Matrix.Compose(new Vector3(.02, .02, .02), Quaternion.Identity(), new Vector3(3, 10, 4)));
  assert.ok(Math.abs(root(2).position.y - .48 * root(2).scaling.x - height) < 1e-6,
    'Two-hand/controller copy sizing also ignores vertical hand movement and preserves altitude');
  panel.end('right'); panel.end('left');
  copyManager.resize(2, .8);
  assert.ok(Math.abs(root(2).position.y - .48 * root(2).scaling.x - height) < 1e-6,
    'Copy resize preserves surface altitude');
  root(2).position.x += 2;
  root(2).rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -1);
  const selectedPose = root(2).computeWorldMatrix(true).clone();
  current = { beat: 8.5, route: [5, 6], guide: 'edited original' };
  restoreFailure = true;
  assert.throws(() => copyManager.edit(2), /test restore failure/);
  assert.equal(current.guide, 'edited original', 'Failed switching restores the outgoing editable field');
  assert.ok(field.computeWorldMatrix(true).equals(livePose), 'Failed switching preserves the active field placement');
  assert.equal(root(1).getChildMeshes().some(mesh => mesh.name.includes('marcher')), false,
    'Failed switching removes temporary frozen copies of the active field');
  restoreFailure = false;
  copyManager.edit(2);
  assert.equal(timeLabels.get(1), 'Beat 8.5', 'Switching labels the paused outgoing field with its own timeline position');
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(timeLabels.get(2), 'Beat 3', 'Active field label follows its live transport');
  assert.equal(context.isDrillEditingEnabled(), true, 'Selecting a copy enables its editor even on desktop');
  assert.deepEqual(current, { ...state, beat: 3 }, 'Activating a captured field restores its own route and whole-beat count');
  assert.ok(field.computeWorldMatrix(true).equals(selectedPose), 'Selected field retains independent size and position');
  assert.equal(frozenBody.isDisposed(), true, 'Active field removes frozen copies instead of rendering doubles');
  assert.ok(root(1).getChildMeshes().some(mesh => mesh.name.includes('marcher')),
    'Original is left visible at its last paused pose');
  current.route[0] = 99;
  current.beat = 7.75;
  copyManager.edit(1);
  assert.equal(timeLabels.get(2), 'Beat 7.75', 'Copy keeps its own paused time label after leaving it');
  assert.equal(context.isDrillEditingEnabled(), false, 'Returning to original preserves normal desktop playback-only behavior');
  assert.deepEqual(current, { beat: 8.5, route: [5, 6], guide: 'edited original' },
    'Switching back restores original edits without inheriting copy changes');
  copyManager.edit(2);
  assert.equal(current.route[0], 99, 'Copy edits are independently retained on subsequent selection');
  assert.equal(current.beat, 7.75, 'Each field retains its independent paused playback position');
  assert.throws(() => copyManager.delete(2), /active field/, 'Cannot accidentally delete the active field');
  allowed = false;
  assert.throws(() => copyManager.capture(), /Release tools/);
  assert.equal(current.beat, 7.75, 'Blocked captures do not move the transport');
  assert.throws(() => copyManager.edit(1), /Release field copies/);
  allowed = true;
  copyManager.delete(1);
  assert.equal(root(1), null, 'Deleting an inactive copy removes its controls and frozen geometry');
  assert.throws(() => copyManager.edit(1), /no longer exists/);
  copyManager.capture();
  assert.ok(root(3));
  assert.equal(actions.filter(entry => entry.action.tool === 'cameraFieldEdit:3').length, 1,
    'Copy controls expose shared desktop/controller/hand actions');
  copyManager.dispose();
  assert.equal(context.isDrillEditingEnabled(), false, 'Disposal clears copy-specific editing access');
  assert.equal(scene.transformNodes.some(node => node.name.startsWith('cameraFieldCopy')), false,
    'Disposal removes every copied field and control');
  assert.equal(surface.isDisposed(), false, 'Disposal leaves live field geometry intact');
  assert.equal(body.isDisposed(), false, 'Disposal leaves live marchers intact');
  assert.equal(scene.textures.length, 0, 'After removing the live label, disposal releases every remaining private texture');
  console.log('Camera field copies passed: field-local snapshots, instance poses/colors, independent geometry, edits/playback state, placement/size, input guards, deletion, and cleanup.');
} finally {
  scene.dispose(); engine.dispose();
}
