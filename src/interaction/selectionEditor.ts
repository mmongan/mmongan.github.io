import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { engine, scene } from '../scene/engine';
import {
  canvas, drillSelectionMode, drillSetEditMode, drillEditSet, drillSelectionStatus,
  selectionEditor, drillShapeInputs, drillShapeKind, formationMoveX, formationMoveZ,
  formationRotation, formationScale, gridSnapX, gridSnapZ, gridSnapInterval,
  floorCalibrationToggle,
} from '../ui/dom';
import {
  getRobotCounts, pauseAll, seekToCount, setRobotSetPoses, onDrillTransportChangedObservable,
  type MarcherSetPose,
} from '../robot/robot';
import { tryManualMarcherPoses } from '../robot/manualPlacement';
import { setMarcherPOVEnabled } from '../camera/marcherPOV';
import { FIELD_SURFACE_Y } from '../field/constants';
import {
  alignFormationPoints, snapDrillPoint, transformFormationPoint,
  type DrillPoint, type FormationTransform,
} from './drillEditing';
import {
  insideSelection, sampleDrillShape, selectionWasDragged, shapeStrokes,
  type DrillShape, type ShapeSegmentKind, type ScreenPoint,
} from './drillShapes';

interface EditSet { name: string; count: number }
interface ShapeGroup { robots: TransformNode[]; shape: DrillShape; count: number | null }
interface EditorDependencies {
  root: TransformNode;
  getMarchers: () => TransformNode[];
  getStandingForm: () => TransformNode[];
  detachStandingMembers: (robots: readonly TransformNode[]) => void;
  changed: (robots: readonly TransformNode[]) => void;
  prepare: () => void;
  notify: (message: string) => void;
  snap: (point: Vector3) => Vector3;
  snapAngle: (angle: number) => number;
  constrain: (delta: Vector3) => Vector3;
}
const vector = (point: DrillPoint) => new Vector3(point.x, point.y, point.z);
const point = (value: DrillPoint): DrillPoint => ({ x: value.x, y: value.y, z: value.z });
const cloneShape = (shape: DrillShape): DrillShape => ({
  start: point(shape.start),
  segments: shape.segments.map(segment => ({
    kind: segment.kind, end: point(segment.end), control: point(segment.control), control2: point(segment.control2),
  })),
});
function mapShape(shape: DrillShape, move: (point: DrillPoint) => DrillPoint): DrillShape {
  return { start: move(shape.start), segments: shape.segments.map(segment => ({
    kind: segment.kind, end: move(segment.end), control: move(segment.control), control2: move(segment.control2),
  })) };
}

export function createSelectionEditor(deps: EditorDependencies) {
  let sets: EditSet[] = [];
  let selected: TransformNode[] = [];
  let groups: ShapeGroup[] = [];
  let draft: DrillShape | null = null;
  let visuals: AbstractMesh[] = [];
  let visualKey = "";
  let syncingTransport = false;
  const handles = new Map<AbstractMesh, { kind: "rotate" | "scale" | "shape"; edit?: (point: DrillPoint) => void }>();
  let drag: {
    id: number; start: ScreenPoint; path: ScreenPoint[]; lasso: boolean; additive: boolean;
    kind: "select" | "move" | "rotate" | "scale" | "shape";
    positions: Vector3[]; yaws: number[]; center: Vector3; fieldStart: Vector3 | null;
    shape: DrillShape | null; edit?: (point: DrillPoint) => void;
    robot?: TransformNode;
    groupShapes: Map<ShapeGroup, DrillShape>;
  } | null = null;
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("drill-selection-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const outline = document.createElementNS(overlay.namespaceURI, "polygon");
  overlay.append(outline);
  document.body.append(overlay);

  const enabled = () => drillSelectionMode.checked;
  const setIndex = () => drillSetEditMode.checked ? Number(drillEditSet.value) : -1;
  const activeSet = () => sets[setIndex()];
  const contextCount = () => activeSet()?.count ?? null;
  const status = (message: string) => {
    drillSelectionStatus.textContent = message;
    deps.notify(message);
  };
  const eligible = () => deps.getMarchers().filter(robot =>
    !robot.isDisposed() && robot.isEnabled() && (drillSetEditMode.checked
      ? !!getRobotCounts(robot)?.[activeSet()?.count ?? -1] : getRobotCounts(robot) === null));
  function holdAtSet() {
    syncingTransport = true;
    try {
      pauseAll();
      if (activeSet()) seekToCount(activeSet()!.count);
    } finally {
      syncingTransport = false;
    }
  }
  const requireEnabled = () => {
    if (floorCalibrationToggle?.checked) {
      status("Finish floor calibration before editing.");
      return false;
    }
    if (!enabled()) {
      status("Enable multi-marcher editing first.");
      return false;
    }
    if (drillSetEditMode.checked && !activeSet()) {
      status("Choose a loaded destination set first.");
      return false;
    }
    holdAtSet();
    return true;
  };
  const selectionCenter = (positions = selected.map(robot => robot.position)) =>
    positions.reduce((sum, position) => sum.add(position), Vector3.Zero()).scale(1 / Math.max(1, positions.length));
  const matchingGroup = () => groups.find(group => group.count === contextCount() &&
    group.robots.length === selected.length && group.robots.every(robot => selected.includes(robot)));
  const invalidate = () => { visualKey = ""; };
  function setSelection(robots: readonly TransformNode[]) {
    const allowed = new Set(eligible());
    selected = [...new Set(robots)].filter(robot => allowed.has(robot));
    draft = matchingGroup() ? cloneShape(matchingGroup()!.shape) : null;
    invalidate();
    status(`Selected ${selected.length} ${drillSetEditMode.checked ? "set" : "standing"} marchers.`);
  }
  function commit(
    positions: readonly Vector3[], yaws = selected.map(robot => robot.rotation.y),
    destination = setIndex()
  ): boolean {
    if (!requireEnabled() || !selected.length) {
      if (!selected.length) status("Select marchers first.");
      return false;
    }
    if (positions.length !== selected.length || positions.some(position =>
      ![position.x, position.y, position.z].every(Number.isFinite))) {
      throw new RangeError("Every selected marcher needs a finite target.");
    }
    const allowed = new Set(eligible());
    if (selected.some(robot => !allowed.has(robot))) {
      status("Selection is no longer editable in this mode. Select marchers again.");
      return false;
    }
    let accepted: boolean;
    if (drillSetEditMode.checked) {
      const target = sets[destination];
      if (!target) { status("There is no adjacent set in that direction."); return false; }
      const poses: MarcherSetPose[] = selected.map((robot, index) => ({
        robot, position: positions[index], facingY: yaws[index],
      }));
      accepted = setRobotSetPoses(target.count, poses, sets[destination - 1]?.count ?? target.count,
        sets[destination + 1]?.count ?? target.count, scene);
    } else {
      accepted = tryManualMarcherPoses(selected.map((robot, index) => ({
        robot, position: positions[index], rotationY: yaws[index],
      })), false);
    }
    if (!accepted) {
      status("Selection edit blocked by body or instrument collisions. Nothing changed.");
      return false;
    }
    deps.changed(selected);
    invalidate();
    return true;
  }

  function transform(transform: FormationTransform, positions = selected.map(robot => robot.position.clone()),
    yaws = selected.map(robot => robot.rotation.y), shape = draft,
    groupShapes = new Map(groups.map(group => [group, cloneShape(group.shape)]))) {
    if (!positions.length) { status("Select marchers first."); return false; }
    const center = selectionCenter(positions);
    const target = deps.snap(center.add(deps.constrain(new Vector3(transform.x, 0, transform.z))));
    const delta = deps.constrain(target.subtract(center));
    transform = { ...transform, x: delta.x, z: delta.z, rotation: deps.snapAngle(transform.rotation) };
    const move = (p: DrillPoint) => transformFormationPoint(p, center, transform);
    if (!commit(positions.map(p => vector(move(p))), yaws.map(yaw => yaw + transform.rotation))) return false;
    draft = shape ? mapShape(shape, move) : null;
    for (const group of groups) {
      if (group.count !== contextCount() || !group.robots.some(robot => selected.includes(robot))) continue;
      if (group.robots.every(robot => selected.includes(robot))) {
        group.shape = mapShape(groupShapes.get(group)!, move);
      } else {
        groups = groups.filter(entry => entry !== group);
      }
    }
    return true;
  }
  function applyShape(group: boolean) {
    if (!draft) { status("Start a shape or create a line first."); return; }
    const targets = sampleDrillShape(draft, selected.length).map(vector);
    if (!commit(targets)) return;
    groups = groups.filter(entry => entry.count !== contextCount() ||
      !entry.robots.some(robot => selected.includes(robot)));
    if (group) {
      if (!drillSetEditMode.checked) deps.detachStandingMembers(selected);
      groups.push({ robots: [...selected], shape: cloneShape(draft), count: contextCount() });
    }
    status(`${group ? "Grouped" : "Applied shape to"} ${selected.length} marchers; no identities were replaced.`);
  }
  function currentLine(): DrillShape {
    if (selected.length < 2) throw new RangeError("Select at least two marchers to create a line.");
    const start = point(selected[0].position), end = point(selected[selected.length - 1].position);
    return { start, segments: [{ kind: "line", end, control: point(start), control2: point(end) }] };
  }
  function inputPoint(prefix: "start" | "end" | "control" | "control2") {
    const x = Number(drillShapeInputs[`${prefix}X`].value);
    const z = Number(drillShapeInputs[`${prefix}Z`].value);
    if (![x, z].every(Number.isFinite)) throw new RangeError("Shape coordinates must be finite.");
    return point(deps.snap(new Vector3(x, FIELD_SURFACE_Y, z)));
  }
  function cycleRounding(axis: "x" | "z", direction = 1) {
    const input = axis === "x" ? gridSnapX : gridSnapZ;
    if (!input) return;
    const presets = [0.3125, 0.625, 1.25, 2.5, 5];
    const index = presets.indexOf(Number(input.value));
    input.value = String(presets[(index + direction + presets.length) % presets.length]);
    if (gridSnapInterval) gridSnapInterval.value = "custom";
    status(`${axis.toUpperCase()} rounding: ${input.value} yards.`);
  }
  function execute(action: string) {
    if (!requireEnabled()) return;
    switch (action) {
      case "selectAll": setSelection(eligible()); return;
      case "selectForm": setSelection(deps.getStandingForm()); return;
      case "clearSelection": setSelection([]); return;
      case "roundX": cycleRounding("x"); return;
      case "roundZ": cycleRounding("z"); return;
      case "transform":
        if (transform({ x: Number(formationMoveX?.value), z: Number(formationMoveZ?.value),
          rotation: Number(formationRotation?.value) * Math.PI / 180, scale: Number(formationScale?.value) })) {
          status(`Transformed ${selected.length} marchers.`);
        }
        return;
      case "alignX": case "alignZ": case "distributeX": case "distributeZ": case "round": {
        const targets = action === "round" ? selected.map(robot => snapDrillPoint(robot.position, 1))
          : alignFormationPoints(selected.map(robot => robot.position), action);
        if (commit(targets.map(vector))) {
          groups = groups.filter(group => group.count !== contextCount() ||
            !group.robots.some(robot => selected.includes(robot)));
          draft = null;
          status(`Applied ${action} to ${selected.length} marchers.`);
        }
        return;
      }
      case "startShape":
        draft = { start: inputPoint("start"), segments: [] };
        invalidate(); status("Shape started. Append line, curve, move, or close segments."); return;
      case "appendShape": {
        if (!draft) { status("Start a shape first."); return; }
        const kind = drillShapeKind.value;
        const kinds: ShapeSegmentKind[] = ["line", "curve", "doubleCurve", "move", "close"];
        const validKind = kinds.find(value => value === kind);
        if (!validKind) throw new RangeError("Choose a supported shape segment.");
        draft.segments.push({ kind: validKind, end: inputPoint("end"), control: inputPoint("control"),
          control2: inputPoint("control2") });
        invalidate(); status(`Shape contains ${draft.segments.length} segments.`); return;
      }
      case "deleteSegment":
        if (!draft?.segments.length) { status("No shape segment to delete."); return; }
        draft.segments.pop(); invalidate(); status("Removed the last shape segment."); return;
      case "line": draft = currentLine(); invalidate(); status("Line created. Apply coordinates or group it."); return;
      case "applyShape": applyShape(false); return;
      case "group":
        draft ??= currentLine();
        applyShape(true); return;
      case "ungroup": {
        const before = groups.length;
        groups = groups.filter(group => group.count !== contextCount() ||
          !group.robots.some(robot => selected.includes(robot)));
        if (!drillSetEditMode.checked) deps.detachStandingMembers(selected);
        draft = null; invalidate();
        status(`Ungrouped selection without deleting marchers (${before - groups.length} selection shapes removed).`); return;
      }
      case "copyPrevious": case "copyNext": {
        if (!drillSetEditMode.checked) { status("Enable authored-set editing first."); return; }
        const source = sets[setIndex() + (action === "copyPrevious" ? -1 : 1)];
        if (!source) { status("There is no adjacent source set."); return; }
        const counts = selected.map(robot => getRobotCounts(robot)?.[source.count]);
        if (counts.some(count => !count)) { status("Some marchers have no position in the source set."); return; }
        if (commit(counts.map(count => count!.position.clone()), counts.map(count => count!.facingY ?? count!.rotationY))) {
          groups = groups.filter(group => group.count !== contextCount() ||
            !group.robots.some(robot => selected.includes(robot)));
          draft = null; status(`Copied ${selected.length} positions into the destination set.`);
        }
        return;
      }
      case "shapePrevious": case "shapeNext": {
        if (!drillSetEditMode.checked) { status("Enable authored-set editing first."); return; }
        const source = matchingGroup();
        if (!source) { status("Select every member of one grouped shape first."); return; }
        const destination = setIndex() + (action === "shapePrevious" ? -1 : 1);
        if (!sets[destination]) { status("There is no adjacent destination set."); return; }
        if (commit(sampleDrillShape(source.shape, selected.length).map(vector),
          selected.map(robot => robot.rotation.y), destination)) {
          groups = groups.filter(group => group.count !== sets[destination].count ||
            !group.robots.some(robot => selected.includes(robot)));
          groups.push({ robots: [...selected], shape: cloneShape(source.shape), count: sets[destination].count });
          status(`Copied grouped shape to ${sets[destination].name}.`);
        }
        return;
      }
      default: throw new RangeError(`Unsupported selection action: ${action}`);
    }
  }
  function safely(action: () => void) {
    try { action(); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      status(error.message);
    }
  }
  selectionEditor.addEventListener("submit", event => {
    event.preventDefault();
    if (!selectionEditor.reportValidity()) return;
    const action = event.submitter instanceof HTMLButtonElement ? event.submitter.value : "";
    safely(() => execute(action));
  });
  for (const axis of ["X", "Z"] as const) {
    const button = selectionEditor.querySelector<HTMLButtonElement>(`button[value="round${axis}"]`)!;
    button.addEventListener("contextmenu", event => {
      event.preventDefault();
      if (requireEnabled()) cycleRounding(axis === "X" ? "x" : "z", -1);
    });
  }
  function changeContext() {
    cancelDrag();
    if (enabled()) {
      deps.prepare();
      setMarcherPOVEnabled(false);
      holdAtSet();
    }
    setSelection([]);
    invalidate();
    if (!enabled()) status("Multi-marcher editing disabled. Camera dragging restored.");
  }
  drillSelectionMode.addEventListener("change", changeContext);
  drillSetEditMode.addEventListener("change", changeContext);
  drillEditSet.addEventListener("change", changeContext);
  onDrillTransportChangedObservable.add(state => {
    if (!enabled() || syncingTransport) return;
    if (state.playing) {
      drillSelectionMode.checked = false;
      cancelDrag(); invalidate();
      status("Playback resumed; multi-marcher editing disabled.");
    } else if (activeSet() && Math.abs(state.beat - activeSet()!.count) > 1e-6) {
      drillSelectionMode.checked = false;
      cancelDrag(); invalidate();
      status("Timeline moved away from the edit set; multi-marcher editing disabled.");
    }
  });
  window.addEventListener("keydown", event => {
    if (!enabled()) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea, select"))) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault(); safely(() => execute("selectAll"));
    } else if (event.key === "Escape") {
      cancelDrag(); setSelection([]);
    } else if (event.key === "1" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); safely(() => execute("round"));
    }
  });

  function screenPoint(event: PointerEvent): ScreenPoint { return { x: event.clientX, y: event.clientY }; }
  function fieldPoint(event: PointerEvent): Vector3 | null {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * engine.getRenderWidth() / rect.width;
    const y = (event.clientY - rect.top) * engine.getRenderHeight() / rect.height;
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), scene.activeCamera);
    const inverse = deps.root.computeWorldMatrix(true).clone().invert();
    const origin = Vector3.TransformCoordinates(ray.origin, inverse);
    const direction = Vector3.TransformNormal(ray.direction, inverse);
    if (Math.abs(direction.y) < 1e-8) return null;
    const distance = (FIELD_SURFACE_Y - origin.y) / direction.y;
    return distance > 0 ? origin.add(direction.scale(distance)) : null;
  }
  function pick(event: PointerEvent, predicate: (mesh: AbstractMesh) => boolean) {
    const rect = canvas.getBoundingClientRect();
    return scene.pick((event.clientX - rect.left) * engine.getRenderWidth() / rect.width,
      (event.clientY - rect.top) * engine.getRenderHeight() / rect.height, predicate);
  }
  function project(robot: TransformNode): ScreenPoint | null {
    const camera = scene.activeCamera;
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const p = Vector3.Project(robot.position, deps.root.getWorldMatrix(), scene.getTransformMatrix(), viewport);
    if (p.z < 0 || p.z > 1) return null;
    return { x: rect.left + p.x * rect.width / engine.getRenderWidth(),
      y: rect.top + p.y * rect.height / engine.getRenderHeight() };
  }
  function cancelDrag() {
    const id = drag?.id;
    drag = null;
    outline.setAttribute("points", "");
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  const stopEvent = (event: PointerEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
  canvas.addEventListener("pointerdown", event => {
    if (!enabled() || event.pointerType === "xr" || event.button !== 0) return;
    stopEvent(event);
    if (!requireEnabled()) return;
    const allowed = eligible();
    const handle = pick(event, mesh => handles.has(mesh));
    const owner = handle?.pickedMesh ? handles.get(handle.pickedMesh) : undefined;
    const robotPick = owner ? null : pick(event, mesh => allowed.some(robot =>
      mesh === robot || mesh.isDescendantOf(robot)));
    const robot = robotPick?.pickedMesh ? allowed.find(entry => robotPick.pickedMesh!.isDescendantOf(entry)) : undefined;
    if (robot && (event.ctrlKey || event.metaKey)) {
      setSelection(selected.includes(robot) ? selected.filter(entry => entry !== robot) : [...selected, robot]);
      return;
    }
    const kind = owner?.kind ?? (robot && selected.includes(robot) && !event.shiftKey ? "move" : "select");
    drag = { id: event.pointerId, start: screenPoint(event), path: [screenPoint(event)],
      lasso: event.shiftKey, additive: event.ctrlKey || event.metaKey, kind,
      positions: selected.map(entry => entry.position.clone()), yaws: selected.map(entry => entry.rotation.y),
      center: selectionCenter(), fieldStart: fieldPoint(event), shape: draft ? cloneShape(draft) : null,
      edit: owner?.edit, groupShapes: new Map(groups.map(group => [group, cloneShape(group.shape)])) };
    drag.robot = robot;
    canvas.setPointerCapture(event.pointerId);
  }, true);
  canvas.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    stopEvent(event);
    const state = drag;
    const current = screenPoint(event);
    if (state.kind === "select") {
      if (state.lasso) {
        const last = state.path[state.path.length - 1];
        if (Math.hypot(current.x - last.x, current.y - last.y) >= 3) state.path.push(current);
      } else state.path = [state.start, { x: current.x, y: state.start.y }, current, { x: state.start.x, y: current.y }];
      outline.setAttribute("points", state.path.map(p => `${p.x},${p.y}`).join(" "));
      return;
    }
    const currentField = fieldPoint(event);
    if (!currentField || !state.fieldStart) return;
    safely(() => {
      if (state.kind === "shape") {
        const original = state.fieldStart!;
        const delta = deps.constrain(currentField.subtract(original));
        state.edit?.(point(deps.snap(original.add(delta))));
        invalidate();
        return;
      }
      const from = state.fieldStart!.subtract(state.center);
      const to = currentField.subtract(state.center);
      let rotation = 0, scale = 1;
      if (state.kind === "rotate") rotation = Math.atan2(to.x, to.z) - Math.atan2(from.x, from.z);
      if (state.kind === "scale") scale = Math.max(0.05, Math.min(20, Math.hypot(to.x, to.z) / Math.max(.01, Math.hypot(from.x, from.z))));
      const delta = state.kind === "move" ? currentField.subtract(state.fieldStart!) : Vector3.Zero();
      transform({ x: delta.x, z: delta.z, rotation, scale }, state.positions, state.yaws, state.shape, state.groupShapes);
    });
  }, true);
  canvas.addEventListener("pointerup", event => {
    if (!drag || drag.id !== event.pointerId) return;
    stopEvent(event);
    const state = drag;
    if (state.kind === "select") {
      const end = screenPoint(event);
      if (!selectionWasDragged(state.start, end, state.path)) {
        const allowed = eligible();
        const hit = pick(event, mesh => allowed.some(robot => mesh.isDescendantOf(robot)));
        const robot = hit?.pickedMesh ? allowed.find(entry => hit.pickedMesh!.isDescendantOf(entry)) : undefined;
        const group = robot ? groups.find(entry => entry.count === contextCount() && entry.robots.includes(robot)) : undefined;
        setSelection(robot ? group?.robots ?? [robot] : []);
      } else {
        const found = eligible().filter(robot => {
          const p = project(robot);
          return p !== null && insideSelection(p, state.path);
        });
        setSelection(state.additive ? [...selected, ...found] : found);
      }
    } else if (state.kind === "move" && state.robot &&
      !selectionWasDragged(state.start, screenPoint(event), [])) {
      const group = groups.find(entry => entry.count === contextCount() && entry.robots.includes(state.robot!));
      setSelection(group?.robots ?? [state.robot]);
    } else if (state.kind === "shape" && matchingGroup()) {
      safely(() => applyShape(true));
    }
    cancelDrag();
  }, true);
  canvas.addEventListener("pointercancel", cancelDrag);
  canvas.addEventListener("lostpointercapture", () => { if (drag) cancelDrag(); });
  window.addEventListener("blur", cancelDrag);

  function drawVisuals() {
    if (!enabled()) {
      if (visuals.length) {
        visuals.forEach(mesh => mesh.dispose());
        visuals = []; handles.clear(); visualKey = "";
      }
      return;
    }
    const allowed = new Set(eligible());
    const previousLength = selected.length;
    selected = selected.filter(robot => allowed.has(robot));
    if (selected.length !== previousLength) {
      draft = null;
      if (enabled()) status(`Selection refreshed: ${selected.length} editable marchers remain.`);
    }
    groups = groups.filter(group => group.robots.every(robot => !robot.isDisposed() && robot.isEnabled()));
    const key = JSON.stringify([enabled(), contextCount(), selected.map(robot =>
      [robot.uniqueId, robot.position.x, robot.position.y, robot.position.z]), draft]);
    if (key === visualKey) return;
    visualKey = key;
    visuals.forEach(mesh => mesh.dispose());
    visuals = []; handles.clear();
    const line = (name: string, points: Vector3[], color: Color3) => {
      const mesh = MeshBuilder.CreateLines(name, { points }, scene);
      mesh.parent = deps.root; mesh.color = color; mesh.isPickable = false;
      visuals.push(mesh);
    };
    const handle = (position: Vector3, kind: "rotate" | "scale" | "shape", edit?: (point: DrillPoint) => void) => {
      const mesh = MeshBuilder.CreateSphere(`selection-${kind}`, { diameter: .55, segments: 8 }, scene);
      mesh.parent = deps.root; mesh.position.copyFrom(position); mesh.position.y += .12;
      mesh.isPickable = true; mesh.renderOutline = true;
      mesh.outlineColor = kind === "rotate" ? new Color3(1, .45, 0) :
        kind === "scale" ? new Color3(.1, 1, .3) : new Color3(.2, .5, 1);
      mesh.outlineWidth = .09; visuals.push(mesh); handles.set(mesh, { kind, edit });
    };
    for (const robot of selected) {
      line("selection-ring", Array.from({ length: 25 }, (_, index) => new Vector3(
        robot.position.x + .55 * Math.cos(index * Math.PI / 12),
        robot.position.y + .035, robot.position.z + .55 * Math.sin(index * Math.PI / 12))), new Color3(0, 1, 1));
    }
    if (selected.length > 1) {
      const center = selectionCenter();
      const minX = Math.min(...selected.map(robot => robot.position.x)) - 1;
      const maxX = Math.max(...selected.map(robot => robot.position.x)) + 1;
      const minZ = Math.min(...selected.map(robot => robot.position.z)) - 1;
      const maxZ = Math.max(...selected.map(robot => robot.position.z)) + 1;
      const corners = [[minX, minZ], [minX, maxZ], [maxX, maxZ], [maxX, minZ]].map(([x, z]) =>
        new Vector3(x, center.y + .04, z));
      line("selection-bounds", [...corners, corners[0]], new Color3(.1, .8, .6));
      corners.forEach(position => handle(position, "scale"));
      handle(new Vector3(center.x, center.y, maxZ + 1), "rotate");
    }
    if (draft) {
      const shape = draft;
      shapeStrokes(shape).forEach(stroke =>
        line("selection-shape", stroke.map(p => vector(p).add(new Vector3(0, .05, 0))), new Color3(.3, .65, 1)));
      handle(vector(shape.start), "shape", p => { shape.start = p; });
      for (const segment of shape.segments) {
        if (segment.kind !== "close") handle(vector(segment.end), "shape", p => { segment.end = p; });
        if (segment.kind === "curve" || segment.kind === "doubleCurve") {
          handle(vector(segment.control), "shape", p => { segment.control = p; });
        }
        if (segment.kind === "doubleCurve") handle(vector(segment.control2), "shape", p => { segment.control2 = p; });
      }
    }
  }
  scene.onBeforeRenderObservable.add(drawVisuals);
  return {
    enabled,
    disable() {
      drillSelectionMode.checked = false;
      cancelDrag(); invalidate();
      status("Multi-marcher editing disabled for another editing tool.");
    },
    setPages(pages: readonly EditSet[]) {
      cancelDrag();
      sets = pages.map(page => ({ ...page }));
      drillEditSet.replaceChildren(...sets.map((set, index) => {
        const option = document.createElement("option");
        option.value = String(index); option.textContent = `${set.name} (count ${set.count})`; return option;
      }));
      if (sets.length) drillEditSet.value = "0";
      selected = []; groups = []; draft = null;
      drillSelectionMode.checked = false; invalidate();
    },
    clear() {
      cancelDrag(); selected = []; groups = []; draft = null; invalidate();
      drillSelectionMode.checked = false;
      sets = []; drillEditSet.replaceChildren();
      status("Scene replaced; selection and shape groups cleared.");
    },
  };
}
