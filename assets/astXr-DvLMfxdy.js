import{W as Le,E as Ge,S as Je,C as me,A as je,V as l,H as en,T as Ae,a as q,Q as W,R as Fe,M as L,b as x,c as nn,d as _,D as Ne,p as Ce,e as tn}from"./package-Dk4PAcFy.js";const ye=`import "@babylonjs/loaders/glTF";
import "@babylonjs/core/XR/motionController/webXROculusTouchMotionController";
import currentProgramAst, { currentProgramSource } from "virtual:current-program-ast";

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Quaternion,
  Ray,
  Color3,
  Color4,
  DynamicTexture,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  StandardMaterial,
  TransformNode,
  WebXRDefaultExperience,
  WebXRState,
  WebXRInputSource,
  WebXRMotionControllerManager,
} from "@babylonjs/core";
import packageJson from "../package.json";

const isProductionBuild = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true;
const buildInfoEl = document.getElementById("build-info") as HTMLDivElement | null;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const enterArButton = document.getElementById("enter-ar-button") as HTMLButtonElement | null;
const enterVrButton = document.getElementById("enter-vr-button") as HTMLButtonElement | null;
const controllerPalette = document.getElementById("controller-palette") as HTMLDivElement | null;

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function updateXrButtons(): void {
  const inXR = xrExperience?.baseExperience.state === WebXRState.IN_XR;

  if (enterArButton) {
    enterArButton.textContent = inXR ? "Quest 3 AR Active" : "Enter Quest 3 AR";
    enterArButton.disabled = isRequestingXR || inXR || !supportsImmersiveAR;
  }

  if (enterVrButton) {
    enterVrButton.textContent = inXR ? "VR Active" : "Enter VR";
    enterVrButton.disabled = isRequestingXR || inXR || !supportsImmersiveVR;
  }
}

function updateBuildInfo(): void {
  if (!buildInfoEl) return;
  const buildNumber = Number((packageJson as { buildNumber?: number }).buildNumber ?? 0);
  const label = \`\${packageJson.name} v\${packageJson.version} · build \${buildNumber} · \${isProductionBuild ? "production" : "development"}\`;
  buildInfoEl.textContent = label;
}

WebXRMotionControllerManager.UseOnlineRepository = true;
WebXRMotionControllerManager.PrioritizeOnlineRepository = true;

const engine = new Engine(canvas, true, { adaptToDeviceRatio: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);

const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 3, Vector3.Zero(), scene);
camera.attachControl(canvas, false);
camera.inputs.clear();

const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
light.intensity = 0.9;

type ConnectionKind = "hierarchy" | "reference" | "user";

const sceneRoot = new TransformNode("sceneRoot", scene);
const placedBoxes: Mesh[] = [];
const astContainerByDescendant = new Map<Mesh, Mesh>();
const astContainerByLabel = new Map<Mesh, Mesh>();
const variableOctahedronInstances = new WeakSet<Mesh>();
const variableOctahedronBaseColors = new WeakMap<Mesh, Color3>();
let variableOctahedronSource: Mesh | null = null;
const nodeConnections: Array<{ shaft: Mesh; head: Mesh; startNode: Mesh; endNode: Mesh; weight: number; kind: ConnectionKind }> = [];
const controllerBeams = new Map<WebXRInputSource, Mesh>();
const controllerAimCache = new Map<WebXRInputSource, { mesh: Mesh | null; point: Vector3 | null }>();
const grabbedBoxes = new Map<WebXRInputSource, Mesh>();
const grabbedBeamDistances = new Map<WebXRInputSource, number>();
const gripPressedSources = new Set<WebXRInputSource>();
const connectionTriggerStates = new Map<WebXRInputSource, boolean>();
let connectionDraftStartNode: Mesh | null = null;
let activeConnectionController: WebXRInputSource | null = null;
let connectionDraftLine: Mesh | null = null;
let hoverConnectionPreview: Mesh | null = null;
const highlightedBoxes = new Map<WebXRInputSource, Mesh>();
const meshHighlightStates = new Map<Mesh, { diffuseColor: Color3; emissiveColor: Color3; owners: Set<WebXRInputSource> }>();
const xrInputSources: WebXRInputSource[] = [];
let tabletRoot: TransformNode | null = null;
let tabletBody: Mesh | null = null;
let tabletScreenTexture: DynamicTexture | null = null;
let tabletHeldBy: WebXRInputSource | null = null;
let tabletNeedsSummon = false;
let xrExperience: WebXRDefaultExperience | null = null;
let isRequestingXR = false;
let supportsImmersiveAR = false;
let supportsImmersiveVR = false;

function setPaletteVisible(visible: boolean): void {
  if (controllerPalette) {
    controllerPalette.classList.toggle("visible", visible);
  }
}

function clearPointerHighlight(source?: WebXRInputSource): void {
  if (!source) {
    for (const [highlightedBox, highlightState] of meshHighlightStates) {
      setMeshDisplayColors(highlightedBox, highlightState.diffuseColor, highlightState.emissiveColor);
    }
    highlightedBoxes.clear();
    meshHighlightStates.clear();
    return;
  }

  const highlightedBox = highlightedBoxes.get(source);
  if (!highlightedBox) return;
  highlightedBoxes.delete(source);

  const highlightState = meshHighlightStates.get(highlightedBox);
  if (!highlightState) return;
  highlightState.owners.delete(source);
  if (highlightState.owners.size > 0) return;

  setMeshDisplayColors(highlightedBox, highlightState.diffuseColor, highlightState.emissiveColor);
  meshHighlightStates.delete(highlightedBox);
}

function setMeshDisplayColors(mesh: Mesh, diffuseColor: Color3, emissiveColor: Color3): void {
  if (variableOctahedronInstances.has(mesh)) {
    mesh.instancedBuffers.color = new Color4(diffuseColor.r, diffuseColor.g, diffuseColor.b, 1);
    return;
  }

  const material = mesh.material as StandardMaterial | null;
  material?.diffuseColor.copyFrom(diffuseColor);
  material?.emissiveColor.copyFrom(emissiveColor);
}

function updateMeshHighlightLevel(mesh: Mesh): void {
  const highlightState = meshHighlightStates.get(mesh);
  if (!highlightState) return;

  const isPressed = Array.from(highlightState.owners).some(source =>
    (connectionTriggerStates.get(source) ?? false) || gripPressedSources.has(source)
  );
  setMeshDisplayColors(
    mesh,
    isPressed ? new Color3(0.25, 0.7, 0.7) : new Color3(0.18, 0.42, 0.42),
    isPressed ? new Color3(0.35, 1.0, 1.0) : new Color3(0.08, 0.35, 0.32),
  );
}

function highlightTargetBox(source: WebXRInputSource, target: Mesh | null): void {
  if (target) {
    const existing = highlightedBoxes.get(source);
    if (existing && existing !== target) {
      clearPointerHighlight(source);
    }
  } else {
    clearPointerHighlight(source);
    return;
  }

  const material = target.material as StandardMaterial | null;
  if (!material) return;

  let highlightState = meshHighlightStates.get(target);
  if (!highlightState) {
    const diffuseColor = variableOctahedronBaseColors.get(target) ?? material.diffuseColor;
    highlightState = {
      emissiveColor: material.emissiveColor.clone(),
      diffuseColor: diffuseColor.clone(),
      owners: new Set<WebXRInputSource>(),
    };
    meshHighlightStates.set(target, highlightState);
  }

  highlightState.owners.add(source);
  highlightedBoxes.set(source, target);
  updateMeshHighlightLevel(target);
}

function ensureStarterBox(): void {
  createTablet();
  if (placedBoxes.length > 0) return;
  const nodeCount = buildSceneFromAst(currentProgramAst);
  setStatus(\`🧠 AST scene built (\${nodeCount} nodes)\`);
}

type SourceTokenKind = "plain" | "keyword" | "type" | "string" | "number" | "comment" | "operator";

const typeScriptKeywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete",
  "do", "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null", "of", "private", "protected", "public",
  "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof",
  "undefined", "void", "while", "with", "yield",
]);

function tokenizeTypeScriptSource(lines: string[]): Array<Array<{ text: string; kind: SourceTokenKind }>> {
  let inBlockComment = false;
  return lines.map(line => {
    const tokens: Array<{ text: string; kind: SourceTokenKind }> = [];
    let index = 0;
    while (index < line.length) {
      if (inBlockComment) {
        const commentEnd = line.indexOf("*/", index);
        const end = commentEnd < 0 ? line.length : commentEnd + 2;
        tokens.push({ text: line.slice(index, end), kind: "comment" });
        index = end;
        inBlockComment = commentEnd < 0;
        continue;
      }

      if (line.startsWith("//", index)) {
        tokens.push({ text: line.slice(index), kind: "comment" });
        break;
      }
      if (line.startsWith("/*", index)) {
        const commentEnd = line.indexOf("*/", index + 2);
        const end = commentEnd < 0 ? line.length : commentEnd + 2;
        tokens.push({ text: line.slice(index, end), kind: "comment" });
        index = end;
        inBlockComment = commentEnd < 0;
        continue;
      }

      const remaining = line.slice(index);
      const stringMatch = remaining.match(/^(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)/);
      const numberMatch = remaining.match(/^(?:0[xob][\\da-f]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)/i);
      const identifierMatch = remaining.match(/^[A-Za-z_$][\\w$]*/);
      const whitespaceMatch = remaining.match(/^\\s+/);
      if (stringMatch) {
        tokens.push({ text: stringMatch[0], kind: "string" });
      } else if (numberMatch) {
        tokens.push({ text: numberMatch[0], kind: "number" });
      } else if (identifierMatch) {
        const text = identifierMatch[0];
        const kind = typeScriptKeywords.has(text) ? "keyword" : /^[A-Z]/.test(text) ? "type" : "plain";
        tokens.push({ text, kind });
      } else if (whitespaceMatch) {
        tokens.push({ text: whitespaceMatch[0], kind: "plain" });
      } else {
        tokens.push({ text: remaining[0], kind: /[=+\\-*/%!?<>|&:^~]/.test(remaining[0]) ? "operator" : "plain" });
      }
      index += tokens[tokens.length - 1].text.length;
    }
    return tokens;
  });
}

function renderTabletSource(mesh: Mesh | null): void {
  if (!tabletScreenTexture) return;

  const context = tabletScreenTexture.getContext();
  context.fillStyle = "#06151b";
  context.fillRect(0, 0, 1024, 576);

  const metadata = mesh?.metadata as { astKind?: string; astLabel?: string; sourceStart?: number; sourceEnd?: number } | null;
  const hasSource = metadata?.sourceStart !== undefined && metadata.sourceEnd !== undefined;
  const sourceLines = currentProgramSource.replace(/\\t/g, "  ").split(/\\r?\\n/);
  const tokenizedSource = tokenizeTypeScriptSource(sourceLines);
  const selectedStartLine = hasSource
    ? currentProgramSource.slice(0, metadata.sourceStart as number).split("\\n").length
    : 1;
  const selectedEndLine = hasSource
    ? currentProgramSource.slice(0, metadata.sourceEnd as number).split("\\n").length
    : 0;
  const visibleLineCount = 14;
  const firstVisibleLine = Math.max(1, Math.min(selectedStartLine - 4, sourceLines.length - visibleLineCount + 1));
  const visibleLines = sourceLines.slice(firstVisibleLine - 1, firstVisibleLine - 1 + visibleLineCount);
  const lastVisibleLine = firstVisibleLine + visibleLines.length - 1;
  const title = metadata?.astLabel ?? "main.ts";
  const kind = metadata?.astKind ?? (mesh ? "Manual node - showing complete source" : "Complete program source");

  context.fillStyle = "#72f0ff";
  context.font = "bold 30px monospace";
  context.fillText(title.slice(0, 52), 38, 48);
  context.fillStyle = "#6f91a0";
  context.font = "22px monospace";
  context.fillText(kind, 38, 80);
  const lineRangeLabel = \`\${firstVisibleLine}-\${lastVisibleLine} / \${sourceLines.length}\`;
  context.fillText(lineRangeLabel, 986 - context.measureText(lineRangeLabel).width, 80);
  context.fillStyle = "#17404a";
  context.fillRect(38, 96, 948, 2);

  context.font = "24px monospace";
  visibleLines.forEach((_line, index) => {
    const lineNumber = firstVisibleLine + index;
    const y = 130 + index * 30;
    const isSelectedLine = hasSource && lineNumber >= selectedStartLine && lineNumber <= selectedEndLine;
    if (isSelectedLine) {
      context.fillStyle = "#123b44";
      context.fillRect(30, y - 23, 956, 29);
    }
    context.fillStyle = isSelectedLine ? "#72f0ff" : "#4d7582";
    context.fillText(String(lineNumber).padStart(4, " "), 38, y);
    let x = 118;
    let remainingCharacters = 70;
    for (const token of tokenizedSource[lineNumber - 1]) {
      if (remainingCharacters <= 0) break;
      const text = token.text.slice(0, remainingCharacters);
      const tokenColors: Record<SourceTokenKind, string> = {
        plain: "#d8e7ec",
        keyword: "#ff78bd",
        type: "#72e6c1",
        string: "#ffd580",
        number: "#b8a0ff",
        comment: "#668995",
        operator: "#72d9ff",
      };
      context.fillStyle = tokenColors[token.kind];
      context.fillText(text, x, y);
      x += context.measureText(text).width;
      remainingCharacters -= text.length;
    }
  });

  tabletScreenTexture.update();
}

function createTablet(): void {
  if (tabletRoot) return;

  tabletRoot = new TransformNode("source-tablet", scene);
  tabletRoot.parent = sceneRoot;
  tabletRoot.position = new Vector3(0.42, 0.28, 0.38);
  tabletRoot.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.PI, 0, 0);

  const frameMaterial = new StandardMaterial("tablet-frame-material", scene);
  frameMaterial.diffuseColor = new Color3(0.035, 0.045, 0.06);
  frameMaterial.emissiveColor = new Color3(0.008, 0.012, 0.02);

  const screenMaterial = new StandardMaterial("tablet-screen-material", scene);
  screenMaterial.diffuseColor = new Color3(0.02, 0.08, 0.1);
  screenMaterial.emissiveColor = new Color3(0.02, 0.45, 0.55);
  screenMaterial.disableLighting = true;

  tabletBody = MeshBuilder.CreateBox("tablet-body", { width: 0.46, height: 0.29, depth: 0.022 }, scene);
  tabletBody.parent = tabletRoot;
  tabletBody.material = frameMaterial;
  tabletBody.isPickable = true;

  const screen = MeshBuilder.CreatePlane("tablet-screen", { width: 0.42, height: 0.245 }, scene);
  screen.parent = tabletRoot;
  screen.position.z = 0.012;
  screen.rotation.y = Math.PI;
  screen.material = screenMaterial;
  screen.isPickable = false;

  const handle = MeshBuilder.CreateBox("tablet-handle", { width: 0.16, height: 0.025, depth: 0.035 }, scene);
  handle.parent = tabletRoot;
  handle.position.y = -0.165;
  handle.material = frameMaterial;
  handle.isPickable = false;

  tabletScreenTexture = new DynamicTexture("tablet-screen-texture", { width: 1024, height: 576 }, scene, true);
  renderTabletSource(null);
  screenMaterial.diffuseTexture = tabletScreenTexture;
  screenMaterial.emissiveTexture = tabletScreenTexture;
}

function getEntityTypeColor(entityType: string): Color3 {
  if (entityType === "SourceFile") return new Color3(0.82, 0.88, 0.95);
  if (entityType === "FunctionDeclaration") return new Color3(0.1, 0.72, 0.9);
  if (entityType === "ClassDeclaration") return new Color3(0.95, 0.55, 0.15);
  if (entityType === "InterfaceDeclaration") return new Color3(0.2, 0.78, 0.42);
  if (entityType === "VariableStatement") return new Color3(0.35, 0.48, 0.95);
  if (entityType === "ReturnStatement") return new Color3(0.9, 0.3, 0.65);
  if (entityType.endsWith("Statement")) return new Color3(0.95, 0.3, 0.25);
  return new Color3(0.55, 0.62, 0.72);
}

function createMeshLabel(mesh: Mesh, label: string, offsetY = 0.075, targetsContainer = false): void {
  const measurementContext = document.createElement("canvas").getContext("2d");
  const baseFontSize = 48;
  if (measurementContext) measurementContext.font = \`bold \${baseFontSize}px sans-serif\`;
  const baseMeasuredWidth = measurementContext?.measureText(label).width ?? label.length * baseFontSize * 0.6;
  const fontSize = Math.max(12, Math.floor(baseFontSize * Math.min(1, 2000 / Math.max(baseMeasuredWidth, 1))));
  const font = \`bold \${fontSize}px sans-serif\`;
  if (measurementContext) measurementContext.font = font;
  const measuredWidth = measurementContext?.measureText(label).width ?? label.length * fontSize * 0.6;
  const requiredWidth = measuredWidth + 48;
  const textureWidth = Math.min(2048, Math.max(256, 2 ** Math.ceil(Math.log2(requiredWidth))));
  const textureHeight = 128;
  const labelHeight = 0.06;
  const labelWidth = labelHeight * textureWidth / textureHeight;
  const labelPlane = MeshBuilder.CreatePlane(\`\${mesh.name}_label\`, { width: labelWidth, height: 0.06 }, scene);
  labelPlane.parent = mesh;
  labelPlane.position.y = offsetY;
  labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  labelPlane.isPickable = targetsContainer;
  if (targetsContainer) astContainerByLabel.set(labelPlane, mesh);

  const texture = new DynamicTexture(\`\${mesh.name}_label_texture\`, { width: textureWidth, height: textureHeight }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(label, null, 84, font, "#ffffff", "rgba(7, 17, 31, 0.88)", true, true);

  const material = new StandardMaterial(\`\${mesh.name}_label_material\`, scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.opacityTexture = texture;
  material.disableLighting = true;
  material.backFaceCulling = false;
  labelPlane.material = material;
  labelPlane.onDisposeObservable.add(() => {
    astContainerByLabel.delete(labelPlane);
    material.dispose(false, true);
  });
}

function addBox(
  position: Vector3,
  entityName?: string,
  entityType = "ManualNode",
  dimensions = new Vector3(0.08, 0.08, 0.08),
  opacity = 1,
): Mesh {
  const meshName = \`box_\${placedBoxes.length}\`;
  const isVariable = entityType === "VariableStatement" && opacity === 1;
  let mesh: Mesh;
  if (isVariable) {
    if (!variableOctahedronSource) {
      variableOctahedronSource = MeshBuilder.CreatePolyhedron(
        "variable-octahedron-source",
        { type: 1, size: dimensions.x / (2 * Math.SQRT2), flat: true },
        scene,
      );
      variableOctahedronSource.position.y = -1000;
      variableOctahedronSource.isPickable = false;
      variableOctahedronSource.useVertexColors = true;
      variableOctahedronSource.registerInstancedBuffer("color", 4);
      variableOctahedronSource.instancedBuffers.color = new Color4(1, 1, 1, 1);

      const sourceMaterial = new StandardMaterial("variable-octahedron-material", scene);
      sourceMaterial.diffuseColor = Color3.White();
      sourceMaterial.emissiveColor = new Color3(0.094, 0.094, 0.094);
      variableOctahedronSource.material = sourceMaterial;
    }

    mesh = variableOctahedronSource.createInstance(meshName) as unknown as Mesh;
    const baseColor = getEntityTypeColor(entityType);
    variableOctahedronInstances.add(mesh);
    variableOctahedronBaseColors.set(mesh, baseColor);
    mesh.instancedBuffers.color = new Color4(baseColor.r, baseColor.g, baseColor.b, 1);
  } else {
    mesh = MeshBuilder.CreateBox(meshName, {
      width: dimensions.x,
      height: dimensions.y,
      depth: dimensions.z,
    }, scene);

    const material = new StandardMaterial(\`boxMat_\${placedBoxes.length}\`, scene);
    material.diffuseColor = getEntityTypeColor(entityType);
    material.emissiveColor = new Color3(0.094, 0.094, 0.094);
    material.alpha = opacity;
    material.backFaceCulling = opacity === 1;
    mesh.material = material;
  }
  mesh.position.copyFrom(position);
  mesh.rotationQuaternion = Quaternion.Identity();
  mesh.parent = sceneRoot;
  mesh.isPickable = opacity === 1;
  mesh.computeWorldMatrix(true);

  placedBoxes.push(mesh);
  createMeshLabel(mesh, entityName ?? \`Node \${placedBoxes.length}\`, dimensions.y / 2 + 0.035, opacity < 1);
  return mesh;
}

function getFaceCenterToward(node: Mesh, towardNode: Mesh): Vector3 {
  const direction = towardNode.position.subtract(node.position);
  const halfExtent = node.getBoundingInfo().boundingBox.extendSize;
  const faceCenter = node.position.clone();

  if (Math.abs(direction.x) >= Math.abs(direction.y) && Math.abs(direction.x) >= Math.abs(direction.z)) {
    faceCenter.x += Math.sign(direction.x) * halfExtent.x;
  } else if (Math.abs(direction.y) >= Math.abs(direction.z)) {
    faceCenter.y += Math.sign(direction.y) * halfExtent.y;
  } else {
    faceCenter.z += Math.sign(direction.z) * halfExtent.z;
  }

  return faceCenter;
}

function constrainToAstContainer(mesh: Mesh, position: Vector3): Vector3 {
  const container = astContainerByDescendant.get(mesh);
  if (!container) return position;

  const containerExtent = container.getBoundingInfo().boundingBox.extendSize;
  const meshExtent = mesh.getBoundingInfo().boundingBox.extendSize;
  const margin = 0.03;
  const availableExtent = new Vector3(
    Math.max(0, containerExtent.x - meshExtent.x - margin),
    Math.max(0, containerExtent.y - meshExtent.y - margin),
    Math.max(0, containerExtent.z - meshExtent.z - margin),
  );
  const minimum = container.position.subtract(availableExtent);
  const maximum = container.position.add(availableExtent);
  return new Vector3(
    Math.max(minimum.x, Math.min(position.x, maximum.x)),
    Math.max(minimum.y, Math.min(position.y, maximum.y)),
    Math.max(minimum.z, Math.min(position.z, maximum.z)),
  );
}

function moveAstMeshWithDescendants(mesh: Mesh, position: Vector3): void {
  const destination = constrainToAstContainer(mesh, position);
  const movement = destination.subtract(mesh.position);
  if (movement.lengthSquared() < 1e-12) return;

  mesh.position.copyFrom(destination);
  mesh.computeWorldMatrix(true);
  for (const descendant of placedBoxes) {
    let container = astContainerByDescendant.get(descendant);
    while (container) {
      if (container === mesh) {
        descendant.position.addInPlace(movement);
        descendant.computeWorldMatrix(true);
        break;
      }
      container = astContainerByDescendant.get(container);
    }
  }
}

function updateConnectionMeshes(): void {
  for (const connection of nodeConnections) {
    const startPoint = getFaceCenterToward(connection.startNode, connection.endNode);
    const endPoint = getFaceCenterToward(connection.endNode, connection.startNode);
    const direction = endPoint.subtract(startPoint);
    const length = Math.max(direction.length(), 0.0001);
    const unit = direction.scale(1 / length);

    const arrowheadMeshHeight = 0.12;
    const arrowheadLength = Math.min(0.08, length * 0.4);
    const shaftLength = Math.max(length - arrowheadLength, 0.001);
    const shaftRadius = Math.max(0.021, connection.weight * 0.03);
    const shaftMidpoint = startPoint.add(unit.scale(shaftLength / 2));
    connection.shaft.position.copyFrom(shaftMidpoint);
    connection.shaft.scaling = new Vector3(shaftRadius, shaftLength, shaftRadius);

    const up = Vector3.Up();
    const axis = Vector3.Cross(up, unit);
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, unit))));
    connection.shaft.rotationQuaternion = axis.lengthSquared() < 1e-6
      ? Quaternion.Identity()
      : Quaternion.RotationAxis(axis.normalize(), angle);

    const headPosition = endPoint.subtract(unit.scale(arrowheadLength / 2));
    const headRadius = Math.max(0.016, shaftRadius * 2.4);
    connection.head.position.copyFrom(headPosition);
    connection.head.scaling = new Vector3(headRadius, arrowheadLength / arrowheadMeshHeight, headRadius);
    connection.head.rotationQuaternion = connection.shaft.rotationQuaternion?.clone() ?? Quaternion.Identity();
  }
}

function removeBox(mesh: Mesh): void {
  for (const [source, highlightedBox] of Array.from(highlightedBoxes.entries())) {
    if (highlightedBox === mesh) clearPointerHighlight(source);
  }

  const index = placedBoxes.indexOf(mesh);
  if (index >= 0) {
    placedBoxes.splice(index, 1);
  }
  astContainerByDescendant.delete(mesh);

  const staleConnections = nodeConnections.filter(connection => connection.startNode === mesh || connection.endNode === mesh);
  for (const connection of staleConnections) {
    connection.shaft.dispose();
    connection.head.dispose();
  }

  for (const connection of staleConnections) {
    const connectionIndex = nodeConnections.indexOf(connection);
    if (connectionIndex >= 0) {
      nodeConnections.splice(connectionIndex, 1);
    }
  }

  mesh.dispose();
}

function getControllerHandedness(source: WebXRInputSource): "left" | "right" {
  return source.inputSource.handedness === "left" ? "left" : "right";
}

function getThumbstickAxes(source: WebXRInputSource): { x: number; y: number } {
  const mc = source.motionController;
  if (!mc) return { x: 0, y: 0 };

  const thumbstick = mc.getComponent("thumbstick") ?? mc.getComponent("xr-standard-thumbstick") ?? mc.getComponentOfType("thumbstick") ?? mc.getComponent("touchpad");
  if (!thumbstick) return { x: 0, y: 0 };

  const axes = thumbstick.axes as { x?: number; y?: number } | undefined;
  const rawX = axes?.x ?? 0;
  const rawY = axes?.y ?? 0;
  return {
    x: Math.abs(rawX) < 0.2 ? 0 : rawX,
    y: Math.abs(rawY) < 0.2 ? 0 : rawY,
  };
}

function getThumbstickForwardBackwardDelta(source: WebXRInputSource): number {
  return -getThumbstickAxes(source).y * 0.02;
}

function moveSceneWithThumbsticks(deltaSeconds: number): void {
  const activeCamera = scene.activeCamera;
  if (!activeCamera) return;

  const cameraForward = activeCamera.getDirection(Vector3.Forward());
  cameraForward.y = 0;
  if (cameraForward.lengthSquared() < 1e-6) return;
  cameraForward.normalize();

  const cameraRight = Vector3.Cross(cameraForward, Vector3.Up()).normalize();
  const movement = Vector3.Zero();
  const movementSpeed = 0.8;
  const yawSpeed = 1.2;
  let yawDelta = 0;

  for (const source of xrInputSources) {
    if (gripPressedSources.has(source) || grabbedBoxes.has(source)) continue;

    const axes = getThumbstickAxes(source);
    if (getControllerHandedness(source) === "left") {
      movement.addInPlace(cameraRight.scale(-axes.x));
      movement.addInPlace(cameraForward.scale(axes.y));
    } else {
      movement.addInPlace(Vector3.Up().scale(axes.y));
      yawDelta -= axes.x * yawSpeed * deltaSeconds;
    }
  }

  movement.scaleInPlace(movementSpeed * deltaSeconds);
  const pivot = activeCamera.globalPosition;
  const cosine = Math.cos(yawDelta);
  const sine = Math.sin(yawDelta);

  for (const box of placedBoxes) {
    box.position.addInPlace(movement);
    if (Math.abs(yawDelta) > 1e-6) {
      const relativeX = box.position.x - pivot.x;
      const relativeZ = box.position.z - pivot.z;
      box.position.x = pivot.x + relativeX * cosine + relativeZ * sine;
      box.position.z = pivot.z - relativeX * sine + relativeZ * cosine;
    }
    box.computeWorldMatrix(true);
  }

  if (tabletRoot && !tabletHeldBy) {
    tabletRoot.position.addInPlace(movement);
    if (Math.abs(yawDelta) > 1e-6) {
      const relativeX = tabletRoot.position.x - pivot.x;
      const relativeZ = tabletRoot.position.z - pivot.z;
      tabletRoot.position.x = pivot.x + relativeX * cosine + relativeZ * sine;
      tabletRoot.position.z = pivot.z - relativeX * sine + relativeZ * cosine;
      tabletRoot.rotate(Vector3.Up(), -yawDelta);
    }
    tabletRoot.computeWorldMatrix(true);
  }
}

function getBeamMovementBasis(source: WebXRInputSource): { depthAxis: Vector3; rightAxis: Vector3; upAxis: Vector3 } {
  const pointer = source.pointer ?? source.grip;
  const depthAxis = pointer?.getDirection?.(Vector3.Forward()) ?? Vector3.Forward();
  const depthNormalized = depthAxis.normalize();

  let rightAxis = Vector3.Cross(depthNormalized, Vector3.Up());
  if (rightAxis.lengthSquared() < 1e-6) {
    rightAxis = Vector3.Cross(depthNormalized, Vector3.Forward());
  }
  rightAxis.normalize();

  const upAxis = Vector3.Cross(rightAxis, depthNormalized);
  upAxis.normalize();

  return { depthAxis: depthNormalized, rightAxis, upAxis };
}

function getControllerAimHit(
  source: WebXRInputSource,
  useCache = true,
  includeContainerLabels = false,
): { mesh: Mesh | null; point: Vector3 | null } | null {
  if (useCache) {
    const cached = controllerAimCache.get(source);
    if (cached) {
      return cached;
    }
  }

  if (xrExperience?.baseExperience.state === WebXRState.IN_XR && !source._lastXRPose) {
    const unavailable = { mesh: null, point: null };
    if (useCache) controllerAimCache.set(source, unavailable);
    return unavailable;
  }

  const pointer = source.pointer ?? source.grip;
  if (!pointer) return null;

  const origin = pointer.absolutePosition?.clone() ?? Vector3.Zero();
  const baseDirection = pointer.getDirection?.(Vector3.Forward()) ?? Vector3.Forward();
  const directionNormalized = baseDirection.normalize();

  let rightAxis = Vector3.Cross(directionNormalized, Vector3.Up());
  if (rightAxis.lengthSquared() < 1e-6) {
    rightAxis = Vector3.Cross(directionNormalized, Vector3.Forward());
  }
  rightAxis.normalize();

  const directions = [
    directionNormalized,
    directionNormalized.add(rightAxis.scale(0.08)).normalize(),
    directionNormalized.add(rightAxis.scale(-0.08)).normalize(),
    directionNormalized.add(rightAxis.scale(0.16)).normalize(),
    directionNormalized.add(rightAxis.scale(-0.16)).normalize(),
  ];

  for (const direction of directions) {
    const ray = new Ray(origin, direction);
    ray.length = 8;
    const hit = scene.pickWithRay(ray, mesh =>
      placedBoxes.includes(mesh as Mesh) || includeContainerLabels && astContainerByLabel.has(mesh as Mesh)
    );
    if (hit?.pickedMesh) {
      const target = astContainerByLabel.get(hit.pickedMesh as Mesh) ?? hit.pickedMesh as Mesh;
      const result = {
        mesh: target,
        point: hit.pickedPoint?.clone() ?? origin.add(direction.scale(0.8)),
      };
      if (useCache) {
        controllerAimCache.set(source, result);
      }
      return result;
    }
  }

  const fallback = { mesh: null, point: null };
  if (useCache) {
    controllerAimCache.set(source, fallback);
  }
  return fallback;
}

function findBoxUnderController(source: WebXRInputSource, includeContainerLabels = false): Mesh | null {
  return getControllerAimHit(source, !includeContainerLabels, includeContainerLabels)?.mesh ?? null;
}

function findBoxTouchingController(source: WebXRInputSource): Mesh | null {
  const controllerPoints = [source.pointer?.absolutePosition, source.grip?.absolutePosition]
    .filter((position): position is Vector3 => Boolean(position));
  if (controllerPoints.length === 0) return null;

  const touchToleranceSquared = 0.025 ** 2;
  let closestMesh: Mesh | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const mesh of placedBoxes) {
    if (!mesh.isPickable) continue;
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    for (const point of controllerPoints) {
      const closestX = Math.max(bounds.minimumWorld.x, Math.min(point.x, bounds.maximumWorld.x));
      const closestY = Math.max(bounds.minimumWorld.y, Math.min(point.y, bounds.maximumWorld.y));
      const closestZ = Math.max(bounds.minimumWorld.z, Math.min(point.z, bounds.maximumWorld.z));
      const distanceSquared = Vector3.DistanceSquared(point, new Vector3(closestX, closestY, closestZ));
      if (distanceSquared <= touchToleranceSquared && distanceSquared < closestDistanceSquared) {
        closestMesh = mesh;
        closestDistanceSquared = distanceSquared;
      }
    }
  }
  return closestMesh;
}

function isTabletUnderController(source: WebXRInputSource): boolean {
  if (!tabletBody || (tabletHeldBy && tabletHeldBy !== source)) return false;
  const pointer = source.pointer ?? source.grip;
  if (!pointer) return false;

  const origin = pointer.absolutePosition?.clone() ?? Vector3.Zero();
  const direction = pointer.getDirection?.(Vector3.Forward()).normalize() ?? Vector3.Forward();
  const ray = new Ray(origin, direction, 8);
  return scene.pickWithRay(ray, mesh => mesh === tabletBody)?.pickedMesh === tabletBody;
}

function updateHeldTablet(): void {
  if (!tabletRoot || !tabletHeldBy) return;
  const grip = tabletHeldBy.grip ?? tabletHeldBy.pointer;
  const activeCamera = scene.activeCamera;
  if (!grip?.absolutePosition || !activeCamera) return;

  tabletRoot.position.copyFrom(grip.absolutePosition.add(Vector3.Up().scale(0.09)));
  tabletRoot.lookAt(activeCamera.globalPosition);
  tabletRoot.computeWorldMatrix(true);
}

function summonTabletInFrontOfViewer(): void {
  if (!tabletRoot) createTablet();
  const activeCamera = scene.activeCamera;
  if (!tabletRoot || !activeCamera) return;

  tabletHeldBy = null;
  const forward = activeCamera.getDirection(Vector3.Forward()).normalize();
  tabletRoot.position.copyFrom(activeCamera.globalPosition.add(forward.scale(0.65)).add(Vector3.Down().scale(0.12)));
  tabletRoot.lookAt(activeCamera.globalPosition);
  tabletRoot.computeWorldMatrix(true);
  setStatus("📟 Tablet summoned");
}

function createControllerBeam(source: WebXRInputSource): Mesh {
  const beam = MeshBuilder.CreateCylinder(\`beam_\${source.uniqueId ?? "controller"}\`, { height: 1, diameter: 0.008, tessellation: 6 }, scene);
  beam.parent = sceneRoot;
  beam.isPickable = false;
  const material = new StandardMaterial(\`beamMat_\${source.uniqueId ?? "controller"}\`, scene);
  material.diffuseColor = new Color3(0.2, 0.8, 1.0);
  material.emissiveColor = new Color3(0.1, 0.35, 0.7);
  material.alpha = 0.9;
  material.disableLighting = true;
  beam.material = material;
  return beam;
}

function updateControllerBeam(source: WebXRInputSource, aimHit?: { mesh: Mesh | null; point: Vector3 | null }): void {
  const pointer = source.pointer ?? source.grip;
  const beam = controllerBeams.get(source) ?? createControllerBeam(source);
  controllerBeams.set(source, beam);

  if (!pointer) {
    beam.setEnabled(false);
    return;
  }

  const origin = pointer.absolutePosition?.clone() ?? Vector3.Zero();
  const direction = pointer.getDirection?.(Vector3.Forward()) ?? Vector3.Forward();
  const directionNormalized = direction.normalize();
  const resolvedHit = aimHit ?? getControllerAimHit(source);
  const grabbedBox = grabbedBoxes.get(source) ?? null;
  const targetPoint = grabbedBox ? grabbedBox.position.clone() : resolvedHit?.point;
  const beamLength = targetPoint ? Vector3.Distance(origin, targetPoint) : 2.2;

  beam.setEnabled(true);
  beam.position.copyFrom(origin.add(directionNormalized.scale(beamLength / 2)));
  beam.scaling.y = beamLength;
  beam.scaling.x = 1;
  beam.scaling.z = 1;

  if (directionNormalized.lengthSquared() > 1e-6) {
    const up = Vector3.Up();
    const axis = Vector3.Cross(up, directionNormalized);
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, directionNormalized))));
    beam.rotationQuaternion = axis.lengthSquared() < 1e-6
      ? Quaternion.Identity()
      : Quaternion.RotationAxis(axis.normalize(), angle);
  } else {
    beam.rotationQuaternion = Quaternion.Identity();
  }
}

function updatePointerHighlight(source: WebXRInputSource, aimHit?: { mesh: Mesh | null; point: Vector3 | null }): void {
  const pointer = source.pointer ?? source.grip;
  const resolvedHit = aimHit ?? getControllerAimHit(source);
  const targetMesh = resolvedHit?.mesh ?? null;

  if (!pointer) {
    clearPointerHighlight(source);
    return;
  }

  if (targetMesh) {
    const currentHighlighted = highlightedBoxes.get(source);
    if (currentHighlighted !== targetMesh) {
      highlightTargetBox(source, targetMesh);
    }
  } else {
    clearPointerHighlight(source);
  }
}

function getOppositeController(source: WebXRInputSource): WebXRInputSource | null {
  const otherControllers = xrInputSources.filter(candidate => candidate !== source);
  return otherControllers[0] ?? null;
}

function getConnectionDraftEndTarget(source: WebXRInputSource): Mesh | null {
  const candidateControllers = [
    activeConnectionController === source ? getOppositeController(source) : source,
    source,
  ].filter((candidate): candidate is WebXRInputSource => Boolean(candidate));

  for (const candidate of candidateControllers) {
    const target = findBoxUnderController(candidate) ?? highlightedBoxes.get(candidate) ?? null;
    if (target && target !== connectionDraftStartNode) {
      return target;
    }
  }

  return null;
}

function getConnectionEndpoint(source: WebXRInputSource, aimHit?: { mesh: Mesh | null; point: Vector3 | null }): Vector3 {
  const pointer = source.pointer ?? source.grip;
  if (!pointer) return Vector3.Zero();

  const origin = pointer.absolutePosition?.clone() ?? Vector3.Zero();
  const direction = pointer.getDirection?.(Vector3.Forward()) ?? Vector3.Forward();
  const directionNormalized = direction.normalize();
  const targetController = activeConnectionController === source ? getOppositeController(source) : source;
  const resolvedHit = aimHit ?? (targetController ? getControllerAimHit(targetController) : getControllerAimHit(source));

  if (resolvedHit?.point) {
    return resolvedHit.point.clone();
  }

  return origin.add(directionNormalized.scale(0.8));
}

function disposeHoverConnectionPreview(): void {
  if (hoverConnectionPreview) {
    hoverConnectionPreview.dispose();
    hoverConnectionPreview = null;
  }
}

function updateConnectionPreview(source: WebXRInputSource, aimHit?: { mesh: Mesh | null; point: Vector3 | null }): void {
  if (!connectionDraftStartNode || activeConnectionController !== source) {
    if (connectionDraftLine) {
      connectionDraftLine.dispose();
      connectionDraftLine = null;
    }

    const hoverTarget = aimHit?.mesh ?? null;
    if (hoverTarget) {
      const startPoint = aimHit?.point?.clone() ?? (source.pointer?.absolutePosition?.clone() ?? source.grip?.absolutePosition?.clone() ?? Vector3.Zero());
      const endPoint = hoverTarget.position.clone();
      disposeHoverConnectionPreview();
      const hoverLine = MeshBuilder.CreateLines("hover-connection-preview", {
        points: [startPoint, endPoint],
      }, scene);
      hoverLine.color = new Color3(0.2, 0.85, 1.0);
      hoverLine.alpha = 0.35;
      hoverLine.parent = sceneRoot;
      hoverLine.isPickable = false;
      hoverConnectionPreview = hoverLine;
    } else {
      disposeHoverConnectionPreview();
    }
    return;
  }

  disposeHoverConnectionPreview();

  const targetController = getOppositeController(source);
  const targetHit = targetController ? getControllerAimHit(targetController) : null;
  const hoverTarget = targetHit?.mesh ?? null;
  const endPoint = hoverTarget?.position?.clone() ?? getConnectionEndpoint(targetController ?? source, targetHit ?? undefined);
  if (connectionDraftLine) {
    connectionDraftLine.dispose();
  }

  const previewLine = MeshBuilder.CreateLines("connection-preview", {
    points: [connectionDraftStartNode.position.clone(), endPoint],
  }, scene);
  previewLine.color = new Color3(0.35, 1.0, 1.0);
  previewLine.alpha = 1.0;
  previewLine.parent = sceneRoot;
  previewLine.isPickable = false;
  connectionDraftLine = previewLine;
}

function getConnectionColors(kind: ConnectionKind): { diffuse: Color3; emissive: Color3; head: Color3 } {
  if (kind === "reference") {
    return {
      diffuse: new Color3(1.0, 0.25, 0.82),
      emissive: new Color3(0.9, 0.12, 0.65),
      head: new Color3(1.0, 0.42, 0.9),
    };
  }
  if (kind === "user") {
    return {
      diffuse: new Color3(1.0, 0.72, 0.18),
      emissive: new Color3(0.95, 0.5, 0.08),
      head: new Color3(1.0, 0.84, 0.35),
    };
  }
  return {
    diffuse: new Color3(0.35, 1.0, 1.0),
    emissive: new Color3(0.25, 0.9, 1.0),
    head: new Color3(0.45, 1.0, 1.0),
  };
}

function createConnectionMesh(startNode: Mesh, endNode: Mesh, weight = 1, kind: ConnectionKind = "user"): Mesh {
  const colors = getConnectionColors(kind);
  const shaft = MeshBuilder.CreateCylinder("connection-shaft", { height: 1, diameter: 0.04, tessellation: 12 }, scene);
  shaft.parent = sceneRoot;
  shaft.isPickable = false;
  shaft.metadata = { connectionKind: kind };
  const shaftMaterial = new StandardMaterial("connection-shaft-mat", scene);
  shaftMaterial.diffuseColor = colors.diffuse;
  shaftMaterial.emissiveColor = colors.emissive;
  shaftMaterial.disableLighting = true;
  shaft.material = shaftMaterial;

  const head = MeshBuilder.CreateCylinder("connection-head", { height: 0.12, diameterTop: 0.001, diameterBottom: 0.08, tessellation: 12 }, scene);
  head.parent = sceneRoot;
  head.isPickable = false;
  head.metadata = { connectionKind: kind };
  const headMaterial = new StandardMaterial("connection-head-mat", scene);
  headMaterial.diffuseColor = colors.head;
  headMaterial.emissiveColor = colors.emissive;
  headMaterial.disableLighting = true;
  head.material = headMaterial;

  nodeConnections.push({ shaft, head, startNode, endNode, weight, kind });
  updateConnectionMeshes();
  return shaft;
}

interface AstSceneOptions {
  maxDepth?: number;
  maxNodes?: number;
  horizontalSpacing?: number;
  depthSpacing?: number;
  layoutIterations?: number;
  origin?: Vector3;
}

interface AstSceneEntry {
  node: ProgramAstNode;
  parentIndex: number | null;
  depth: number;
}

interface AstLayoutEdge {
  sourceIndex: number;
  targetIndex: number;
  strength: number;
}

class ForceDirectedAstLayoutManager {
  constructor(
    private readonly idealEdgeLength: number,
    private readonly depthSpacing: number,
    private readonly origin: Vector3,
    private readonly iterations: number,
  ) {}

  layout(entries: AstSceneEntry[], edges: AstLayoutEdge[]): Vector3[] {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const positions = entries.map((entry, index) => {
      const radius = this.idealEdgeLength * Math.sqrt(index + 1) * 0.45;
      const angle = index * goldenAngle;
      return new Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.25,
        -entry.depth * this.depthSpacing,
      );
    });

    const repulsion = this.idealEdgeLength * this.idealEdgeLength;
    for (let iteration = 0; iteration < this.iterations; iteration += 1) {
      const forces = entries.map(() => Vector3.Zero());

      for (let first = 0; first < positions.length; first += 1) {
        for (let second = first + 1; second < positions.length; second += 1) {
          const delta = positions[first].subtract(positions[second]);
          const distance = Math.max(delta.length(), 0.001);
          const force = delta.scale(repulsion / (distance * distance * distance));
          forces[first].addInPlace(force);
          forces[second].subtractInPlace(force);
        }
      }

      for (const edge of edges) {
        const delta = positions[edge.targetIndex].subtract(positions[edge.sourceIndex]);
        const distance = Math.max(delta.length(), 0.001);
        const stretch = distance - this.idealEdgeLength;
        const force = delta.scale((stretch * edge.strength) / distance);
        forces[edge.sourceIndex].addInPlace(force);
        forces[edge.targetIndex].subtractInPlace(force);
      }

      entries.forEach((entry, index) => {
        const targetDepth = -entry.depth * this.depthSpacing;
        forces[index].z += (targetDepth - positions[index].z) * 0.35;
        forces[index].y -= positions[index].y * 0.08;
      });

      const progress = iteration / Math.max(this.iterations - 1, 1);
      const temperature = this.idealEdgeLength * (0.22 * (1 - progress) + 0.01);
      positions.forEach((position, index) => {
        const forceLength = forces[index].length();
        if (forceLength > 1e-6) {
          position.addInPlace(forces[index].scale(Math.min(forceLength, temperature) / forceLength));
        }
      });
    }

    const center = positions.reduce((sum, position) => sum.addInPlace(position), Vector3.Zero()).scaleInPlace(1 / positions.length);
    return positions.map(position => this.origin.add(position.subtract(center)));
  }
}

interface ProgramAstNode {
  kind: string;
  label: string;
  start: number;
  end: number;
  uses: number[];
  usedBy: number[];
  children: ProgramAstNode[];
}

function buildSceneFromAst(rootNode: ProgramAstNode, options: AstSceneOptions = {}): number {
  const maxDepth = options.maxDepth ?? 3;
  const maxNodes = options.maxNodes ?? 72;
  const horizontalSpacing = options.horizontalSpacing ?? 0.14;
  const depthSpacing = options.depthSpacing ?? 0.2;
  const layoutIterations = options.layoutIterations ?? 120;
  const origin = options.origin?.clone() ?? new Vector3(0, 0.1, 0);
  const entries: AstSceneEntry[] = [{ node: rootNode, parentIndex: null, depth: 0 }];

  for (let index = 0; index < entries.length && entries.length < maxNodes; index += 1) {
    const entry = entries[index];
    if (entry.depth >= maxDepth) continue;

    for (const child of entry.node.children) {
      if (entries.length >= maxNodes) break;
      entries.push({ node: child, parentIndex: index, depth: entry.depth + 1 });
    }
  }

  const entryIndexBySourceStart = new Map<number, number>();
  entries.forEach((entry, index) => entryIndexBySourceStart.set(entry.node.start, index));
  const hierarchyEdges: AstLayoutEdge[] = entries.flatMap((entry, index) =>
    entry.parentIndex === null ? [] : [{ sourceIndex: entry.parentIndex, targetIndex: index, strength: 0.9 }]
  );
  const referenceEdges: AstLayoutEdge[] = [];
  const referenceConnections = new Set<string>();
  const addReferenceEdge = (fromId: number, toId: number): void => {
    const sourceIndex = entryIndexBySourceStart.get(fromId);
    const targetIndex = entryIndexBySourceStart.get(toId);
    const key = \`\${fromId}:\${toId}\`;
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex || referenceConnections.has(key)) return;
    referenceConnections.add(key);
    referenceEdges.push({ sourceIndex, targetIndex, strength: 0.4 });
  };
  entries.forEach(entry => {
    entry.node.uses.forEach(declarationId => {
      const declaration = entries[entryIndexBySourceStart.get(declarationId) ?? -1]?.node;
      const isFunctionReference = entry.node.kind === "FunctionDeclaration" && declaration?.kind === "FunctionDeclaration";
      addReferenceEdge(
        isFunctionReference ? entry.node.start : declarationId,
        isFunctionReference ? declarationId : entry.node.start,
      );
    });
    entry.node.usedBy.forEach(usageId => {
      const usage = entries[entryIndexBySourceStart.get(usageId) ?? -1]?.node;
      const isFunctionReference = entry.node.kind === "FunctionDeclaration" && usage?.kind === "FunctionDeclaration";
      addReferenceEdge(
        isFunctionReference ? usageId : entry.node.start,
        isFunctionReference ? entry.node.start : usageId,
      );
    });
  });

  const meshes: Mesh[] = new Array(entries.length);
  const layoutManager = new ForceDirectedAstLayoutManager(horizontalSpacing, depthSpacing, origin, layoutIterations);
  const positions = layoutManager.layout(entries, [...hierarchyEdges, ...referenceEdges]);
  const childIndexes = entries.map(() => [] as number[]);
  entries.forEach((entry, entryIndex) => {
    if (entry.parentIndex !== null) childIndexes[entry.parentIndex].push(entryIndex);
  });
  const representationCenters = positions.map(position => position.clone());
  const representationRadii = positions.map(() => 0.04);
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const children = childIndexes[entryIndex];
    if (children.length === 0) continue;

    const minimum = children.reduce((bounds, childIndex) => {
      const radius = representationRadii[childIndex];
      return Vector3.Minimize(bounds, representationCenters[childIndex].subtract(new Vector3(radius, radius, radius)));
    }, new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    const maximum = children.reduce((bounds, childIndex) => {
      const radius = representationRadii[childIndex];
      return Vector3.Maximize(bounds, representationCenters[childIndex].add(new Vector3(radius, radius, radius)));
    }, new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY));
    const center = minimum.add(maximum).scale(0.5);
    const radius = children.reduce(
      (containerRadius, childIndex) => Math.max(
        containerRadius,
        Vector3.Distance(center, representationCenters[childIndex]) + representationRadii[childIndex],
      ),
      0,
    ) + 0.08;
    representationCenters[entryIndex] = center;
    representationRadii[entryIndex] = radius;
  }
  entries.forEach((entry, entryIndex) => {
    const label = entry.node.label;
    const isContainer = childIndexes[entryIndex].length > 0;
    const sideLength = representationRadii[entryIndex] * 2;
    const mesh = addBox(
      representationCenters[entryIndex],
      label,
      entry.node.kind,
      isContainer ? new Vector3(sideLength, sideLength, sideLength) : undefined,
      isContainer ? 0.1 : 1,
    );
    mesh.name = \`ast_\${entryIndex}_\${label.replace(/[^a-z0-9]+/gi, "_")}\`;
    mesh.metadata = {
      astKind: entry.node.kind,
      astLabel: label,
      sourceStart: entry.node.start,
      sourceEnd: entry.node.end,
    };
    meshes[entryIndex] = mesh;
  });

  entries.forEach((entry, entryIndex) => {
    if (entry.parentIndex !== null && childIndexes[entry.parentIndex].length > 0) {
      astContainerByDescendant.set(meshes[entryIndex], meshes[entry.parentIndex]);
    }
  });

  referenceEdges.forEach(edge => {
    if (childIndexes[edge.sourceIndex].length > 0 && childIndexes[edge.targetIndex].length > 0) return;

    const fromId = entries[edge.sourceIndex].node.start;
    const toId = entries[edge.targetIndex].node.start;
    const connection = createConnectionMesh(meshes[edge.sourceIndex], meshes[edge.targetIndex], 0.3, "reference");
    connection.metadata = { ...connection.metadata, fromId, toId };
  });

  return meshes.length;
}

function deleteBoxAtController(source: WebXRInputSource): boolean {
  const target = findBoxTouchingController(source);
  if (!target) {
    return false;
  }

  removeBox(target);
  return true;
  for (const [controller, grabbedMesh] of Array.from(grabbedBoxes.entries())) {
    if (grabbedMesh === target) {
      grabbedBoxes.delete(controller);
      grabbedBeamDistances.delete(controller);
    }
  }
  setStatus("🗑 Deleted box");
}

function placeBoxAtController(source: WebXRInputSource): void {
  const posePos = source.grip?.absolutePosition?.clone() ?? source.pointer?.absolutePosition?.clone() ?? Vector3.Zero();
  const position = posePos.add(new Vector3(0, 0.02, 0));
  addBox(position);
  setStatus(\`📦 Placed box (\${placedBoxes.length})\`);
}

function startConnectionDraft(source: WebXRInputSource): void {
  const selectedTarget = findBoxUnderController(source) ?? highlightedBoxes.get(source) ?? null;
  renderTabletSource(selectedTarget);

  if (connectionDraftStartNode && activeConnectionController && activeConnectionController !== source) {
    const endTarget = getConnectionDraftEndTarget(source);
    if (endTarget) {
      finishConnectionDraft(source);
    } else {
      setStatus("🔗 Point the second controller at the destination node");
    }
    return;
  }

  if (activeConnectionController === source) return;

  const target = selectedTarget;
  if (target) {
    connectionDraftStartNode = target;
    activeConnectionController = source;
    setStatus("🔗 Select the destination with the other controller");
  } else {
    connectionDraftStartNode = null;
    activeConnectionController = null;
    connectionDraftLine?.dispose();
    connectionDraftLine = null;
    disposeHoverConnectionPreview();
    setStatus("🔗 Point at a node to start a connection");
  }
}

function finishConnectionDraft(source: WebXRInputSource): void {
  const sourceController = activeConnectionController;
  const endTarget = getConnectionDraftEndTarget(source);
  if (connectionDraftStartNode && endTarget && endTarget !== connectionDraftStartNode) {
    createConnectionMesh(connectionDraftStartNode, endTarget);
    if (sourceController && (connectionTriggerStates.get(sourceController) ?? false)) {
      connectionDraftLine?.dispose();
      connectionDraftLine = null;
      setStatus("🔗 Connection drawn — select another destination");
      return;
    }
    setStatus("🔗 Connection drawn");
  } else {
    setStatus("🔗 Connection cancelled");
  }
  connectionDraftStartNode = null;
  activeConnectionController = null;
  connectionDraftLine?.dispose();
  connectionDraftLine = null;
  disposeHoverConnectionPreview();
}

function cancelConnectionDraft(): void {
  connectionDraftStartNode = null;
  activeConnectionController = null;
  connectionDraftLine?.dispose();
  connectionDraftLine = null;
  disposeHoverConnectionPreview();
  setStatus("🔗 Connection cancelled");
}

function initController(source: WebXRInputSource): void {
  const mc = source.motionController;
  if (!mc) return;

  const handedness = getControllerHandedness(source);
  const isLeftController = handedness === "left";
  const isRightController = handedness === "right";
  const usesQuest3Layout = true;

  const triggerComp = mc.getComponent("trigger") ?? mc.getComponent("xr-standard-trigger") ?? mc.getComponent("squeeze") ?? mc.getComponentOfType("trigger") ?? mc.getComponentOfType("squeeze");
  if (triggerComp) {
    triggerComp.onButtonStateChangedObservable.add(comp => {
      const wasPressed = connectionTriggerStates.get(source) ?? false;
      if (comp.pressed && !wasPressed) {
        if (isTabletUnderController(source)) {
          setStatus("📟 Read-only source tablet");
          mc.pulse?.(0.15, 50);
          return;
        }
        connectionTriggerStates.set(source, true);
        startConnectionDraft(source);
        mc.pulse?.(0.15, 50);
      } else if (!comp.pressed && wasPressed) {
        connectionTriggerStates.set(source, false);
        if (activeConnectionController === source) {
          cancelConnectionDraft();
        }
      }
    });
  }

  const squeezeComp = mc.getComponent("squeeze") ?? mc.getComponentOfType("squeeze");
  if (squeezeComp) {
    squeezeComp.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed) {
        gripPressedSources.add(source);
      } else {
        gripPressedSources.delete(source);
      }

      if (comp.pressed) {
        if (isTabletUnderController(source)) {
          tabletHeldBy = source;
          setStatus("🤏 Tablet grabbed — release grip to place it");
        } else {
          const target = findBoxUnderController(source, true);
          if (!target) {
            setStatus("🎯 Hold grip on a box or tablet to move it");
            mc.pulse?.(0.3, 100);
            return;
          }
          grabbedBoxes.set(source, target);
          const controllerPos = source.grip?.absolutePosition?.clone() ?? source.pointer?.absolutePosition?.clone() ?? Vector3.Zero();
          const beamDirection = source.pointer?.getDirection?.(Vector3.Forward()) ?? Vector3.Forward();
          const beamDir = beamDirection.normalize();
          const relative = target.position.subtract(controllerPos);
          const beamDistance = Vector3.Dot(relative, beamDir);
          grabbedBeamDistances.set(source, beamDistance < 0.01 ? 0.15 : beamDistance);
          setStatus("🤏 Grip grabbed distant box");
        }
        mc.pulse?.(0.3, 100);
      } else if (tabletHeldBy === source) {
        tabletHeldBy = null;
        setStatus("✋ Tablet released");
      } else if (grabbedBoxes.has(source)) {
        grabbedBoxes.delete(source);
        grabbedBeamDistances.delete(source);
        setStatus("✋ Box released");
      }
    });
  }

  const aButton = mc.getComponent("a-button") ?? mc.getComponent("x-button");
  const xButton = mc.getComponent("x-button") ?? mc.getComponent("y-button") ?? mc.getComponent("a-button");

  if (aButton && (isRightController || !isLeftController && !isRightController)) {
    aButton.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed) {
        if (!deleteBoxAtController(source)) summonTabletInFrontOfViewer();
        mc.pulse?.(0.2, 70);
      }
    });
  }

  if (xButton && (isLeftController || !isLeftController && !isRightController)) {
    xButton.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed) {
        if (!deleteBoxAtController(source)) summonTabletInFrontOfViewer();
        mc.pulse?.(0.2, 70);
      }
    });
  }

  const bButton = mc.getComponent("b-button") ?? mc.getComponent("y-button") ?? mc.getComponent("a-button");
  if (bButton && (isRightController || !isLeftController && !isRightController)) {
    bButton.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed) {
        placeBoxAtController(source);
        mc.pulse?.(0.2, 70);
      }
    });
  }

  const yButton = mc.getComponent("y-button");
  if (yButton && isLeftController) {
    yButton.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed) {
        placeBoxAtController(source);
        mc.pulse?.(0.2, 70);
      }
    });
  }

  const menuButton = mc.getComponent("menu") ?? mc.getComponent("xr-standard-menu");
  if (menuButton && isLeftController) {
    let wasMenuPressed = false;
    menuButton.onButtonStateChangedObservable.add(comp => {
      if (comp.pressed && !wasMenuPressed) {
        summonTabletInFrontOfViewer();
        mc.pulse?.(0.2, 70);
      }
      wasMenuPressed = comp.pressed;
    });
  }

  if (usesQuest3Layout) {
    setStatus("🕶 Quest 3 controller layout ready");
  }
}

async function requestARSession(): Promise<void> {
  if (!xrExperience || isRequestingXR) return;
  if (xrExperience.baseExperience.state === WebXRState.IN_XR) return;

  isRequestingXR = true;
  setStatus("▶️ Requesting AR session…");

  try {
    await xrExperience.baseExperience.enterXRAsync("immersive-ar", "local-floor");
  } catch (err) {
    console.error(err);
    setStatus(\`❌ AR request failed — \${err instanceof Error ? err.message : "check Quest Browser permissions"}\`);
  } finally {
    isRequestingXR = false;
    updateXrButtons();
  }
}

async function requestVRSession(): Promise<void> {
  if (!xrExperience || isRequestingXR) return;
  if (xrExperience.baseExperience.state === WebXRState.IN_XR) return;

  isRequestingXR = true;
  setStatus("▶️ Requesting VR session…");

  try {
    await xrExperience.baseExperience.enterXRAsync("immersive-vr", "local-floor");
  } catch (err) {
    console.error(err);
    setStatus(\`❌ VR request failed — \${err instanceof Error ? err.message : "check Quest Browser permissions"}\`);
  } finally {
    isRequestingXR = false;
    updateXrButtons();
  }
}

async function initXR(): Promise<void> {
  setStatus("⏳ Initialising WebXR…");

  if (typeof navigator.xr === "undefined") {
    setStatus("❌ WebXR is not available in this browser");
    return;
  }

  supportsImmersiveAR = await navigator.xr.isSessionSupported("immersive-ar").catch(() => false);
  supportsImmersiveVR = await navigator.xr.isSessionSupported("immersive-vr").catch(() => false);

  if (!supportsImmersiveAR && !supportsImmersiveVR) {
    setStatus("❌ Immersive AR/VR is not supported on this device/browser");
    return;
  }

  const xr = await WebXRDefaultExperience.CreateAsync(scene, {
    disableDefaultUI: true,
    disablePointerSelection: true,
    disableTeleportation: true,
    disableNearInteraction: true,
    uiOptions: { sessionMode: supportsImmersiveAR ? "immersive-ar" : "immersive-vr" },
    optionalFeatures: true,
  });

  xrExperience = xr;

  xr.baseExperience.onStateChangedObservable.add(state => {
    if (state === WebXRState.IN_XR) {
      tabletNeedsSummon = true;
      setStatus("🟢 XR ready — Aim assist: optimized • Grip: grab/move • Trigger: draw connections • B/Y: place • X/A: delete");
    } else if (state === WebXRState.NOT_IN_XR) {
      tabletNeedsSummon = false;
      clearPointerHighlight();
      controllerAimCache.clear();
      setStatus("⬜ XR not active");
    }
    updateXrButtons();
  });

  xr.input.onControllerAddedObservable.add(source => {
    xrInputSources.push(source);
    source.onMotionControllerInitObservable.add(() => {
      initController(source);
    });
  });

  xr.input.onControllerRemovedObservable.add(source => {
    const index = xrInputSources.indexOf(source);
    if (index >= 0) xrInputSources.splice(index, 1);

    const beam = controllerBeams.get(source);
    if (beam) {
      beam.dispose();
      controllerBeams.delete(source);
    }

    connectionTriggerStates.delete(source);
    grabbedBoxes.delete(source);
    grabbedBeamDistances.delete(source);
    gripPressedSources.delete(source);
    if (tabletHeldBy === source) tabletHeldBy = null;
    clearPointerHighlight(source);
    controllerAimCache.delete(source);
  });

  updateBuildInfo();
  updateXrButtons();
}

if (enterArButton) {
  enterArButton.addEventListener("click", async () => {
    ensureStarterBox();
    await requestARSession();
  });
}

if (enterVrButton) {
  enterVrButton.addEventListener("click", async () => {
    ensureStarterBox();
    await requestVRSession();
  });
}

window.addEventListener("click", () => {
  if (xrExperience?.baseExperience.state === WebXRState.IN_XR) return;
  ensureStarterBox();
});

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
  button.addEventListener("click", () => {
    const action = button.getAttribute("data-action");
    if (!action) return;

    if (action.startsWith("node-")) {
      const typeLabel = action.replace("node-", "").replace(/^./, c => c.toUpperCase());
      setStatus(\`🧠 Selected \${typeLabel} node\`);
      button.classList.add("active");
      for (const otherButton of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
        if (otherButton !== button) otherButton.classList.remove("active");
      }
    }

    setPaletteVisible(false);
  });
}

scene.registerBeforeRender(() => {
  controllerAimCache.clear();
  if (tabletNeedsSummon && xrExperience?.baseExperience.state === WebXRState.IN_XR) {
    tabletNeedsSummon = false;
    summonTabletInFrontOfViewer();
  }
  moveSceneWithThumbsticks(scene.getEngine().getDeltaTime() / 1000);

  for (const [source, grabbedBox] of Array.from(grabbedBoxes.entries())) {
    const posePos = source.grip?.absolutePosition?.clone() ?? source.pointer?.absolutePosition?.clone() ?? Vector3.Zero();
    const beamBasis = getBeamMovementBasis(source);
    const thumbstickDelta = getThumbstickForwardBackwardDelta(source);
    const currentDistance = grabbedBeamDistances.get(source) ?? 0.15;
    const nextDistance = Math.abs(thumbstickDelta) > 1e-6 ? Math.max(0.05, currentDistance + thumbstickDelta) : currentDistance;
    grabbedBeamDistances.set(source, nextDistance);
    const beamPoint = posePos.add(beamBasis.depthAxis.scale(nextDistance));
    moveAstMeshWithDescendants(grabbedBox, beamPoint);
  }

  updateHeldTablet();

  updateConnectionMeshes();

  for (const source of xrInputSources) {
    const aimHit = getControllerAimHit(source);
    if (!aimHit?.mesh) {
      clearPointerHighlight(source);
    }

    updateControllerBeam(source, aimHit ?? undefined);
    updatePointerHighlight(source, aimHit ?? undefined);

    if (activeConnectionController === source) {
      updateConnectionPreview(source, aimHit ?? undefined);
    }
  }

  for (const mesh of meshHighlightStates.keys()) {
    updateMeshHighlightLevel(mesh);
  }

});

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => engine.resize());

void initXR().catch(err => {
  console.error(err);
  setStatus("❌ WebXR could not start");
});

ensureStarterBox();
`,on={kind:"SourceFile",label:"ast-xr.ts",start:0,end:63604,uses:[2287,2364,820,2521,7160,3240,25188,31965,21933,2199,58568,1185],usedBy:[1280,1746,2199,2287,2364,2521,2678,2735,2767,2823,2874,2931,2997,3047,3181,3240,3342,3398,3464,3520,3590,3640,3704,3749,3797,3857,3982,4029,4074,4110,4165,4246,4544,5344,5764,6257,7160,7978,10134,13141,14835,15475,17485,19747,20381,21268,21933,23511,24313,24465,25060,25188,27216,27868,29974,30183,31434,31965,32380,32894,33461,34926,35507,35717,36257,37194,38982,39590,40821,41193,41722,42025,43629,44010,49840,50280,50599,51643,52745,57456,58012,58568,61066,61905,62208],children:[{kind:"VariableStatement",label:"variable isProductionBuild",start:560,end:664,uses:[],usedBy:[1746],children:[]},{kind:"VariableStatement",label:"variable buildInfoEl",start:665,end:748,uses:[],usedBy:[1746],children:[]},{kind:"VariableStatement",label:"variable statusEl",start:749,end:819,uses:[],usedBy:[1185],children:[]},{kind:"VariableStatement",label:"variable canvas",start:820,end:897,uses:[],usedBy:[2199,0],children:[]},{kind:"VariableStatement",label:"variable enterArButton",start:898,end:991,uses:[],usedBy:[1280,60743],children:[]},{kind:"VariableStatement",label:"variable enterVrButton",start:992,end:1085,uses:[],usedBy:[1280,60883],children:[]},{kind:"VariableStatement",label:"variable controllerPalette",start:1086,end:1183,uses:[],usedBy:[4397],children:[]},{kind:"FunctionDeclaration",label:"function setStatus",start:1185,end:1278,uses:[749],usedBy:[7160,32380,49840,50280,50599,51643,52490,52745,57456,58012,58568,61388,0],children:[]},{kind:"FunctionDeclaration",label:"function updateXrButtons",start:1280,end:1744,uses:[4246,0,898,4302,4330,992,4363],usedBy:[57456,58012,58568],children:[]},{kind:"FunctionDeclaration",label:"function updateBuildInfo",start:1746,end:2075,uses:[665,0,560],usedBy:[58568],children:[]},{kind:"VariableStatement",label:"variable engine",start:2199,end:2286,uses:[0,820],usedBy:[2287,0],children:[]},{kind:"VariableStatement",label:"variable scene",start:2287,end:2319,uses:[0,2199],usedBy:[0,2364,2521,2678,13141,15475,17485,25188,27868,31434,31965,32380,32894,37194,39590,58568],children:[]},{kind:"VariableStatement",label:"variable camera",start:2364,end:2459,uses:[0,2287],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable light",start:2521,end:2594,uses:[0,2287],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable sceneRoot",start:2678,end:2734,uses:[0,2287],usedBy:[13141,17485,32894,37194,39590],children:[]},{kind:"VariableStatement",label:"variable placedBoxes",start:2735,end:2766,uses:[0],usedBy:[7160,17485,21268,23511,25188,27868,30183,50280],children:[]},{kind:"VariableStatement",label:"variable astContainerByDescendant",start:2767,end:2822,uses:[0],usedBy:[20381,21268,23511,44010],children:[]},{kind:"VariableStatement",label:"variable astContainerByLabel",start:2823,end:2873,uses:[0],usedBy:[15475,27868],children:[]},{kind:"VariableStatement",label:"variable variableOctahedronInstances",start:2874,end:2930,uses:[0],usedBy:[5344,17485],children:[]},{kind:"VariableStatement",label:"variable variableOctahedronBaseColors",start:2931,end:2996,uses:[0],usedBy:[6257,17485],children:[]},{kind:"VariableStatement",label:"variable variableOctahedronSource",start:2997,end:3046,uses:[0],usedBy:[17485],children:[]},{kind:"VariableStatement",label:"variable nodeConnections",start:3047,end:3180,uses:[0],usedBy:[21933,23511,39590],children:[]},{kind:"VariableStatement",label:"variable controllerBeams",start:3181,end:3239,uses:[0],usedBy:[33461,58568],children:[]},{kind:"VariableStatement",label:"variable controllerAimCache",start:3240,end:3341,uses:[0],usedBy:[27868,58568,0],children:[]},{kind:"VariableStatement",label:"variable grabbedBoxes",start:3342,end:3397,uses:[0],usedBy:[25188,33461,49840,52745,58568,62131],children:[]},{kind:"VariableStatement",label:"variable grabbedBeamDistances",start:3398,end:3463,uses:[0],usedBy:[49840,52745,58568,62454,62131],children:[]},{kind:"VariableStatement",label:"variable gripPressedSources",start:3464,end:3519,uses:[0],usedBy:[5764,25188,52745,58568],children:[]},{kind:"VariableStatement",label:"variable connectionTriggerStates",start:3520,end:3589,uses:[0],usedBy:[5764,51643,52745,58568],children:[]},{kind:"VariableStatement",label:"variable connectionDraftStartNode",start:3590,end:3639,uses:[0],usedBy:[35717,37194,50599,51643,52490],children:[]},{kind:"VariableStatement",label:"variable activeConnectionController",start:3640,end:3703,uses:[0],usedBy:[35717,36257,37194,50599,51643,52490,52745,63164],children:[]},{kind:"VariableStatement",label:"variable connectionDraftLine",start:3704,end:3748,uses:[0],usedBy:[37194,50599,51643,52490],children:[]},{kind:"VariableStatement",label:"variable hoverConnectionPreview",start:3749,end:3796,uses:[0],usedBy:[37033,37194],children:[]},{kind:"VariableStatement",label:"variable highlightedBoxes",start:3797,end:3856,uses:[0],usedBy:[4544,6257,23511,34926,35717,50599],children:[]},{kind:"VariableStatement",label:"variable meshHighlightStates",start:3857,end:3981,uses:[0],usedBy:[4544,5764,6257,63282],children:[]},{kind:"VariableStatement",label:"variable xrInputSources",start:3982,end:4028,uses:[0],usedBy:[25188,35507,58568,62891],children:[]},{kind:"VariableStatement",label:"variable tabletRoot",start:4029,end:4073,uses:[0],usedBy:[13141,25188,31965,32380],children:[]},{kind:"VariableStatement",label:"variable tabletBody",start:4074,end:4109,uses:[0],usedBy:[13141,31434],children:[]},{kind:"VariableStatement",label:"variable tabletScreenTexture",start:4110,end:4164,uses:[0],usedBy:[10134,13141],children:[]},{kind:"VariableStatement",label:"variable tabletHeldBy",start:4165,end:4214,uses:[0],usedBy:[25188,31434,31965,32380,52745,58568],children:[]},{kind:"VariableStatement",label:"variable tabletNeedsSummon",start:4215,end:4245,uses:[],usedBy:[58568,61905],children:[]},{kind:"VariableStatement",label:"variable xrExperience",start:4246,end:4301,uses:[0],usedBy:[1280,27868,57456,58012,58568,61066,61905],children:[]},{kind:"VariableStatement",label:"variable isRequestingXR",start:4302,end:4329,uses:[],usedBy:[1280,57456,58012],children:[]},{kind:"VariableStatement",label:"variable supportsImmersiveAR",start:4330,end:4362,uses:[],usedBy:[1280,58568],children:[]},{kind:"VariableStatement",label:"variable supportsImmersiveVR",start:4363,end:4395,uses:[],usedBy:[1280,58568],children:[]},{kind:"FunctionDeclaration",label:"function setPaletteVisible",start:4397,end:4542,uses:[1086],usedBy:[61162],children:[]},{kind:"FunctionDeclaration",label:"function clearPointerHighlight",start:4544,end:5342,uses:[0,3857,5344,3797],usedBy:[6257,23511,34926,58568,62982],children:[]},{kind:"FunctionDeclaration",label:"function setMeshDisplayColors",start:5344,end:5762,uses:[0,2874],usedBy:[4544,5764],children:[]},{kind:"FunctionDeclaration",label:"function updateMeshHighlightLevel",start:5764,end:6255,uses:[0,3857,3520,3464,5344],usedBy:[6257,63282],children:[]},{kind:"FunctionDeclaration",label:"function highlightTargetBox",start:6257,end:7158,uses:[0,3797,4544,3857,2931,5764],usedBy:[34926],children:[]},{kind:"FunctionDeclaration",label:"function ensureStarterBox",start:7160,end:7367,uses:[13141,2735,44010,0,1185],usedBy:[60743,60883,0],children:[]},{kind:"VariableStatement",label:"variable typeScriptKeywords",start:7470,end:7976,uses:[],usedBy:[7978],children:[]},{kind:"FunctionDeclaration",label:"function tokenizeTypeScriptSource",start:7978,end:10132,uses:[0,7470],usedBy:[10134],children:[]},{kind:"FunctionDeclaration",label:"function renderTabletSource",start:10134,end:13139,uses:[0,4110,7978],usedBy:[13141,50599],children:[]},{kind:"FunctionDeclaration",label:"function createTablet",start:13141,end:14833,uses:[4029,0,2287,2678,4074,4110,10134],usedBy:[7160,32380],children:[]},{kind:"FunctionDeclaration",label:"function getEntityTypeColor",start:14835,end:15473,uses:[0],usedBy:[17485],children:[]},{kind:"FunctionDeclaration",label:"function createMeshLabel",start:15475,end:17483,uses:[0,2287,2823],usedBy:[17485],children:[]},{kind:"FunctionDeclaration",label:"function addBox",start:17485,end:19745,uses:[0,2735,2997,2287,14835,2874,2931,2678,15475],usedBy:[44010,50280],children:[]},{kind:"FunctionDeclaration",label:"function getFaceCenterToward",start:19747,end:20379,uses:[0],usedBy:[21933],children:[]},{kind:"FunctionDeclaration",label:"function constrainToAstContainer",start:20381,end:21266,uses:[0,2767],usedBy:[21268],children:[]},{kind:"FunctionDeclaration",label:"function moveAstMeshWithDescendants",start:21268,end:21931,uses:[0,20381,2735,2767],usedBy:[62131],children:[]},{kind:"FunctionDeclaration",label:"function updateConnectionMeshes",start:21933,end:23509,uses:[3047,19747,0],usedBy:[39590,0],children:[]},{kind:"FunctionDeclaration",label:"function removeBox",start:23511,end:24311,uses:[0,3797,4544,2735,2767,3047],usedBy:[49840],children:[]},{kind:"FunctionDeclaration",label:"function getControllerHandedness",start:24313,end:24463,uses:[0],usedBy:[25188,52745],children:[]},{kind:"FunctionDeclaration",label:"function getThumbstickAxes",start:24465,end:25058,uses:[0],usedBy:[25060,25188],children:[]},{kind:"FunctionDeclaration",label:"function getThumbstickForwardBackwardDelta",start:25060,end:25186,uses:[0,24465],usedBy:[62383],children:[]},{kind:"FunctionDeclaration",label:"function moveSceneWithThumbsticks",start:25188,end:27214,uses:[2287,0,3982,3464,3342,24465,24313,2735,4029,4165],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function getBeamMovementBasis",start:27216,end:27866,uses:[0],usedBy:[62331,62705],children:[]},{kind:"FunctionDeclaration",label:"function getControllerAimHit",start:27868,end:29972,uses:[0,3240,4246,2287,2735,2823],usedBy:[29974,33461,34926,36257,37194,62934,62982],children:[]},{kind:"FunctionDeclaration",label:"function findBoxUnderController",start:29974,end:30181,uses:[0,27868],usedBy:[35717,50599,52745],children:[]},{kind:"FunctionDeclaration",label:"function findBoxTouchingController",start:30183,end:31432,uses:[0,2735],usedBy:[49840],children:[]},{kind:"FunctionDeclaration",label:"function isTabletUnderController",start:31434,end:31963,uses:[0,4074,4165,2287],usedBy:[52745],children:[]},{kind:"FunctionDeclaration",label:"function updateHeldTablet",start:31965,end:32378,uses:[4029,4165,2287,0],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function summonTabletInFrontOfViewer",start:32380,end:32892,uses:[4029,13141,2287,4165,0,1185],usedBy:[52745,61905],children:[]},{kind:"FunctionDeclaration",label:"function createControllerBeam",start:32894,end:33459,uses:[0,2287,2678],usedBy:[33461],children:[]},{kind:"FunctionDeclaration",label:"function updateControllerBeam",start:33461,end:34924,uses:[0,3181,32894,27868,3342],usedBy:[62891],children:[]},{kind:"FunctionDeclaration",label:"function updatePointerHighlight",start:34926,end:35505,uses:[0,27868,4544,3797,6257],usedBy:[62891],children:[]},{kind:"FunctionDeclaration",label:"function getOppositeController",start:35507,end:35715,uses:[0,3982],usedBy:[35717,36257,37194],children:[]},{kind:"FunctionDeclaration",label:"function getConnectionDraftEndTarget",start:35717,end:36255,uses:[0,3640,35507,29974,3797,3590],usedBy:[50599,51643],children:[]},{kind:"FunctionDeclaration",label:"function getConnectionEndpoint",start:36257,end:37031,uses:[0,3640,35507,27868],usedBy:[37194],children:[]},{kind:"FunctionDeclaration",label:"function disposeHoverConnectionPreview",start:37033,end:37192,uses:[3749],usedBy:[37194,50599,51643,52490],children:[]},{kind:"FunctionDeclaration",label:"function updateConnectionPreview",start:37194,end:38980,uses:[0,3590,3640,3704,37033,2287,2678,3749,35507,27868,36257],usedBy:[63164],children:[]},{kind:"FunctionDeclaration",label:"function getConnectionColors",start:38982,end:39588,uses:[0],usedBy:[39590],children:[]},{kind:"FunctionDeclaration",label:"function createConnectionMesh",start:39590,end:40819,uses:[0,38982,2287,2678,3047,21933],usedBy:[44010,51643],children:[]},{kind:"InterfaceDeclaration",label:"interface AstSceneOptions",start:40821,end:40996,uses:[0],usedBy:[44010],children:[]},{kind:"InterfaceDeclaration",label:"interface AstSceneEntry",start:40998,end:41096,uses:[43847],usedBy:[41193,41722,43024,44010],children:[]},{kind:"InterfaceDeclaration",label:"interface AstLayoutEdge",start:41098,end:41191,uses:[],usedBy:[41193,42587,42791,42551,44010],children:[]},{kind:"ClassDeclaration",label:"class ForceDirectedAstLayoutManager",start:41193,end:43845,uses:[0,40998,41098],usedBy:[41552,41608,41722,41881,41948,42025,42551,42734,43024,43219,43288,43762,44010],children:[{kind:"VariableStatement",label:"variable goldenAngle",start:41498,end:41547,uses:[],usedBy:[41681],children:[]},{kind:"VariableStatement",label:"variable positions",start:41552,end:41875,uses:[41193],usedBy:[41608,41681,41722,42082,42150,42231,42587,41948,43629,43762],children:[{kind:"VariableStatement",label:"variable radius",start:41608,end:41674,uses:[41193,41552],usedBy:[41722],children:[]},{kind:"VariableStatement",label:"variable angle",start:41681,end:41715,uses:[41552,41498],usedBy:[41722],children:[]},{kind:"ReturnStatement",label:"ReturnStatement",start:41722,end:41867,uses:[0,41681,41608,41552,40998,41193],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable repulsion",start:41881,end:41943,uses:[41193],usedBy:[42361],children:[]},{kind:"ForStatement",label:"ForStatement",start:41948,end:43623,uses:[41193,42025,43024,41552],usedBy:[43024,43219,43418,43470],children:[{kind:"VariableStatement",label:"variable forces",start:42025,end:42074,uses:[41193,0],usedBy:[42150,42551,41948,43418,43470],children:[]},{kind:"ForStatement",label:"ForStatement",start:42082,end:42543,uses:[41552],usedBy:[42150,42231],children:[{kind:"ForStatement",label:"ForStatement",start:42150,end:42535,uses:[42082,41552,42025,42361],usedBy:[42231],children:[{kind:"VariableStatement",label:"variable delta",start:42231,end:42290,uses:[41552,42082,42150],usedBy:[42301,42361],children:[]},{kind:"VariableStatement",label:"variable distance",start:42301,end:42350,uses:[42231],usedBy:[42361],children:[]},{kind:"VariableStatement",label:"variable force",start:42361,end:42433,uses:[42231,41881,42301],usedBy:[42150],children:[]}]}]},{kind:"ForOfStatement",label:"ForOfStatement",start:42551,end:42972,uses:[41193,42025,41098,42791],usedBy:[42587,42791],children:[{kind:"VariableStatement",label:"variable delta",start:42587,end:42667,uses:[41552,42551,41098],usedBy:[42676,42791],children:[]},{kind:"VariableStatement",label:"variable distance",start:42676,end:42725,uses:[42587],usedBy:[42734,42791],children:[]},{kind:"VariableStatement",label:"variable stretch",start:42734,end:42782,uses:[42676,41193],usedBy:[42791],children:[]},{kind:"VariableStatement",label:"variable force",start:42791,end:42855,uses:[42587,42734,42551,41098,42676],usedBy:[42551],children:[]}]},{kind:"VariableStatement",label:"variable targetDepth",start:43024,end:43077,uses:[41948,40998,41193],usedBy:[41948],children:[]},{kind:"VariableStatement",label:"variable progress",start:43219,end:43281,uses:[41948,41193],usedBy:[43288],children:[]},{kind:"VariableStatement",label:"variable temperature",start:43288,end:43362,uses:[41193,43219],usedBy:[43470],children:[]},{kind:"VariableStatement",label:"variable forceLength",start:43418,end:43461,uses:[42025,41948],usedBy:[43470],children:[]},{kind:"IfStatement",label:"IfStatement",start:43470,end:43607,uses:[43418,41948,42025,43288],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable center",start:43629,end:43757,uses:[41552,0],usedBy:[43762],children:[]},{kind:"ReturnStatement",label:"ReturnStatement",start:43762,end:43839,uses:[41552,41193,43629],usedBy:[],children:[]}]},{kind:"InterfaceDeclaration",label:"interface ProgramAstNode",start:43847,end:44008,uses:[],usedBy:[40998,44010],children:[]},{kind:"FunctionDeclaration",label:"function buildSceneFromAst",start:44010,end:49838,uses:[43847,40821,0,40998,41098,41193,17485,2767,39590],usedBy:[7160],children:[]},{kind:"FunctionDeclaration",label:"function deleteBoxAtController",start:49840,end:50278,uses:[0,30183,23511,3342,3398,1185],usedBy:[52745],children:[]},{kind:"FunctionDeclaration",label:"function placeBoxAtController",start:50280,end:50597,uses:[0,17485,1185,2735],usedBy:[52745],children:[]},{kind:"FunctionDeclaration",label:"function startConnectionDraft",start:50599,end:51641,uses:[0,29974,3797,10134,3590,3640,35717,51643,1185,3704,37033],usedBy:[52745],children:[]},{kind:"FunctionDeclaration",label:"function finishConnectionDraft",start:51643,end:52488,uses:[0,3640,35717,3590,39590,3520,3704,1185,37033],usedBy:[50599],children:[]},{kind:"FunctionDeclaration",label:"function cancelConnectionDraft",start:52490,end:52743,uses:[3590,3640,3704,37033,1185],usedBy:[52745],children:[]},{kind:"FunctionDeclaration",label:"function initController",start:52745,end:57454,uses:[0,24313,3520,31434,1185,50599,3640,52490,3464,4165,29974,3342,3398,49840,32380,50280],usedBy:[58568],children:[]},{kind:"FunctionDeclaration",label:"function requestARSession",start:57456,end:58010,uses:[4246,4302,0,1185,1280],usedBy:[60743],children:[]},{kind:"FunctionDeclaration",label:"function requestVRSession",start:58012,end:58566,uses:[4246,4302,0,1185,1280],usedBy:[60883],children:[]},{kind:"FunctionDeclaration",label:"function initXR",start:58568,end:60741,uses:[1185,4330,4363,0,2287,4246,4215,4544,3240,1280,3982,52745,3181,3520,3342,3398,3464,4165,1746],usedBy:[0],children:[]},{kind:"IfStatement",label:"IfStatement",start:60743,end:60881,uses:[898,7160,57456],usedBy:[],children:[]},{kind:"IfStatement",label:"IfStatement",start:60883,end:61021,uses:[992,7160,58012],usedBy:[],children:[]},{kind:"IfStatement",label:"IfStatement",start:61066,end:61134,uses:[4246,0],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:61127,end:61134,uses:[],usedBy:[],children:[]}]},{kind:"ForOfStatement",label:"ForOfStatement",start:61162,end:61836,uses:[4397],usedBy:[61307,61388,61716],children:[{kind:"VariableStatement",label:"variable action",start:61307,end:61357,uses:[61162],usedBy:[61362,61388,61428],children:[]},{kind:"IfStatement",label:"IfStatement",start:61362,end:61382,uses:[61307],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:61375,end:61382,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:61388,end:61797,uses:[61307,1185,61428,61162],usedBy:[],children:[{kind:"VariableStatement",label:"variable typeLabel",start:61428,end:61510,uses:[61307],usedBy:[61388],children:[]},{kind:"ForOfStatement",label:"ForOfStatement",start:61605,end:61791,uses:[],usedBy:[61716],children:[{kind:"IfStatement",label:"IfStatement",start:61716,end:61783,uses:[61605,61162],usedBy:[],children:[]}]}]}]},{kind:"IfStatement",label:"IfStatement",start:61905,end:62058,uses:[4215,4246,0,32380],usedBy:[],children:[]},{kind:"ForOfStatement",label:"ForOfStatement",start:62131,end:62835,uses:[3342,3398,62524,21268,62705],usedBy:[62208,62331,62383,62454],children:[{kind:"VariableStatement",label:"variable posePos",start:62208,end:62326,uses:[62131,0],usedBy:[62705],children:[]},{kind:"VariableStatement",label:"variable beamBasis",start:62331,end:62378,uses:[27216,62131],usedBy:[62705],children:[]},{kind:"VariableStatement",label:"variable thumbstickDelta",start:62383,end:62449,uses:[25060,62131],usedBy:[62524],children:[]},{kind:"VariableStatement",label:"variable currentDistance",start:62454,end:62519,uses:[3398,62131],usedBy:[62524],children:[]},{kind:"VariableStatement",label:"variable nextDistance",start:62524,end:62648,uses:[62383,62454],usedBy:[62131,62705],children:[]},{kind:"VariableStatement",label:"variable beamPoint",start:62705,end:62776,uses:[62208,62331,27216,62524],usedBy:[62131],children:[]}]},{kind:"ForOfStatement",label:"ForOfStatement",start:62891,end:63278,uses:[3982,33461,62934,34926],usedBy:[62934,62982,63164],children:[{kind:"VariableStatement",label:"variable aimHit",start:62934,end:62977,uses:[27868,62891],usedBy:[62982,62891,63164],children:[]},{kind:"IfStatement",label:"IfStatement",start:62982,end:63045,uses:[62934,27868,4544,62891],usedBy:[],children:[]},{kind:"IfStatement",label:"IfStatement",start:63164,end:63274,uses:[3640,62891,37194,62934],usedBy:[],children:[]}]},{kind:"ForOfStatement",label:"ForOfStatement",start:63282,end:63370,uses:[3857,5764],usedBy:[],children:[]}]},Ie=document.getElementById("build-info"),ke=document.getElementById("status"),ze=document.getElementById("render-canvas"),ie=document.getElementById("enter-ar-button"),re=document.getElementById("enter-vr-button"),Re=document.getElementById("controller-palette");function C(e){ke&&(ke.textContent=e)}function fe(){const e=A?.baseExperience.state===q.IN_XR;ie&&(ie.textContent=e?"Quest 3 AR Active":"Enter Quest 3 AR",ie.disabled=O||e||!ue),re&&(re.textContent=e?"VR Active":"Enter VR",re.disabled=O||e||!Se)}function rn(){if(!Ie)return;const e=Number(Ce.buildNumber),n=`${Ce.name} v${Ce.version} · build ${e} · production`;Ie.textContent=n}Le.UseOnlineRepository=!0;Le.PrioritizeOnlineRepository=!0;const Be=new Ge(ze,!0,{adaptToDeviceRatio:!0,antialias:!0}),p=new Je(Be);p.clearColor=new me(0,0,0,0);const Xe=new je("cam",-Math.PI/2,Math.PI/3,3,l.Zero(),p);Xe.attachControl(ze,!1);Xe.inputs.clear();const an=new en("light",new l(0,1,0),p);an.intensity=.9;const K=new Ae("sceneRoot",p),D=[],se=new Map,be=new Map,He=new WeakSet,We=new WeakMap;let F=null;const ae=[],ge=new Map,Q=new Map,Y=new Map,le=new Map,ce=new Set,J=new Map;let E=null,R=null,I=null,de=null;const N=new Map,H=new Map,j=[];let y=null,U=null,ee=null,V=null,pe=!1,A=null,O=!1,ue=!1,Se=!1;function sn(e){Re&&Re.classList.toggle("visible",e)}function $(e){if(!e){for(const[o,i]of H)ve(o,i.diffuseColor,i.emissiveColor);N.clear(),H.clear();return}const n=N.get(e);if(!n)return;N.delete(e);const t=H.get(n);t&&(t.owners.delete(e),!(t.owners.size>0)&&(ve(n,t.diffuseColor,t.emissiveColor),H.delete(n)))}function ve(e,n,t){if(He.has(e)){e.instancedBuffers.color=new me(n.r,n.g,n.b,1);return}const o=e.material;o?.diffuseColor.copyFrom(n),o?.emissiveColor.copyFrom(t)}function Oe(e){const n=H.get(e);if(!n)return;const t=Array.from(n.owners).some(o=>(J.get(o)??!1)||ce.has(o));ve(e,t?new x(.25,.7,.7):new x(.18,.42,.42),t?new x(.35,1,1):new x(.08,.35,.32))}function ln(e,n){if(n){const i=N.get(e);i&&i!==n&&$(e)}else{$(e);return}const t=n.material;if(!t)return;let o=H.get(n);if(!o){const i=We.get(n)??t.diffuseColor;o={emissiveColor:t.emissiveColor.clone(),diffuseColor:i.clone(),owners:new Set},H.set(n,o)}o.owners.add(e),N.set(e,n),Oe(n)}function xe(){if(_e(),D.length>0)return;const e=kn(on);C(`🧠 AST scene built (${e} nodes)`)}const cn=new Set(["as","async","await","break","case","catch","class","const","continue","default","delete","do","else","export","extends","false","finally","for","from","function","if","implements","import","in","instanceof","interface","let","new","null","of","private","protected","public","readonly","return","static","super","switch","this","throw","true","try","type","typeof","undefined","void","while","with","yield"]);function dn(e){let n=!1;return e.map(t=>{const o=[];let i=0;for(;i<t.length;){if(n){const h=t.indexOf("*/",i),c=h<0?t.length:h+2;o.push({text:t.slice(i,c),kind:"comment"}),i=c,n=h<0;continue}if(t.startsWith("//",i)){o.push({text:t.slice(i),kind:"comment"});break}if(t.startsWith("/*",i)){const h=t.indexOf("*/",i+2),c=h<0?t.length:h+2;o.push({text:t.slice(i,c),kind:"comment"}),i=c,n=h<0;continue}const s=t.slice(i),u=s.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/),a=s.match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i),r=s.match(/^[A-Za-z_$][\w$]*/),f=s.match(/^\s+/);if(u)o.push({text:u[0],kind:"string"});else if(a)o.push({text:a[0],kind:"number"});else if(r){const h=r[0],c=cn.has(h)?"keyword":/^[A-Z]/.test(h)?"type":"plain";o.push({text:h,kind:c})}else f?o.push({text:f[0],kind:"plain"}):o.push({text:s[0],kind:/[=+\-*/%!?<>|&:^~]/.test(s[0])?"operator":"plain"});i+=o[o.length-1].text.length}return o})}function qe(e){if(!ee)return;const n=ee.getContext();n.fillStyle="#06151b",n.fillRect(0,0,1024,576);const t=e?.metadata,o=t?.sourceStart!==void 0&&t.sourceEnd!==void 0,i=ye.replace(/\t/g,"  ").split(/\r?\n/),s=dn(i),u=o?ye.slice(0,t.sourceStart).split(`
`).length:1,a=o?ye.slice(0,t.sourceEnd).split(`
`).length:0,r=14,f=Math.max(1,Math.min(u-4,i.length-r+1)),h=i.slice(f-1,f-1+r),c=f+h.length-1,d=t?.astLabel??"main.ts",g=t?.astKind??(e?"Manual node - showing complete source":"Complete program source");n.fillStyle="#72f0ff",n.font="bold 30px monospace",n.fillText(d.slice(0,52),38,48),n.fillStyle="#6f91a0",n.font="22px monospace",n.fillText(g,38,80);const S=`${f}-${c} / ${i.length}`;n.fillText(S,986-n.measureText(S).width,80),n.fillStyle="#17404a",n.fillRect(38,96,948,2),n.font="24px monospace",h.forEach((w,k)=>{const v=f+k,P=130+k*30,z=o&&v>=u&&v<=a;z&&(n.fillStyle="#123b44",n.fillRect(30,P-23,956,29)),n.fillStyle=z?"#72f0ff":"#4d7582",n.fillText(String(v).padStart(4," "),38,P);let m=118,b=70;for(const M of s[v-1]){if(b<=0)break;const B=M.text.slice(0,b),T={plain:"#d8e7ec",keyword:"#ff78bd",type:"#72e6c1",string:"#ffd580",number:"#b8a0ff",comment:"#668995",operator:"#72d9ff"};n.fillStyle=T[M.kind],n.fillText(B,m,P),m+=n.measureText(B).width,b-=B.length}}),ee.update()}function _e(){if(y)return;y=new Ae("source-tablet",p),y.parent=K,y.position=new l(.42,.28,.38),y.rotationQuaternion=W.RotationYawPitchRoll(Math.PI,0,0);const e=new _("tablet-frame-material",p);e.diffuseColor=new x(.035,.045,.06),e.emissiveColor=new x(.008,.012,.02);const n=new _("tablet-screen-material",p);n.diffuseColor=new x(.02,.08,.1),n.emissiveColor=new x(.02,.45,.55),n.disableLighting=!0,U=L.CreateBox("tablet-body",{width:.46,height:.29,depth:.022},p),U.parent=y,U.material=e,U.isPickable=!0;const t=L.CreatePlane("tablet-screen",{width:.42,height:.245},p);t.parent=y,t.position.z=.012,t.rotation.y=Math.PI,t.material=n,t.isPickable=!1;const o=L.CreateBox("tablet-handle",{width:.16,height:.025,depth:.035},p);o.parent=y,o.position.y=-.165,o.material=e,o.isPickable=!1,ee=new Ne("tablet-screen-texture",{width:1024,height:576},p,!0),qe(null),n.diffuseTexture=ee,n.emissiveTexture=ee}function Pe(e){return e==="SourceFile"?new x(.82,.88,.95):e==="FunctionDeclaration"?new x(.1,.72,.9):e==="ClassDeclaration"?new x(.95,.55,.15):e==="InterfaceDeclaration"?new x(.2,.78,.42):e==="VariableStatement"?new x(.35,.48,.95):e==="ReturnStatement"?new x(.9,.3,.65):e.endsWith("Statement")?new x(.95,.3,.25):new x(.55,.62,.72)}function un(e,n,t=.075,o=!1){const i=document.createElement("canvas").getContext("2d"),s=48;i&&(i.font=`bold ${s}px sans-serif`);const u=i?.measureText(n).width??n.length*s*.6,a=Math.max(12,Math.floor(s*Math.min(1,2e3/Math.max(u,1)))),r=`bold ${a}px sans-serif`;i&&(i.font=r);const h=(i?.measureText(n).width??n.length*a*.6)+48,c=Math.min(2048,Math.max(256,2**Math.ceil(Math.log2(h)))),d=128,S=.06*c/d,w=L.CreatePlane(`${e.name}_label`,{width:S,height:.06},p);w.parent=e,w.position.y=t,w.billboardMode=tn.BILLBOARDMODE_ALL,w.isPickable=o,o&&be.set(w,e);const k=new Ne(`${e.name}_label_texture`,{width:c,height:d},p,!0);k.hasAlpha=!0,k.drawText(n,null,84,r,"#ffffff","rgba(7, 17, 31, 0.88)",!0,!0);const v=new _(`${e.name}_label_material`,p);v.diffuseTexture=k,v.emissiveTexture=k,v.opacityTexture=k,v.disableLighting=!0,v.backFaceCulling=!1,w.material=v,w.onDisposeObservable.add(()=>{be.delete(w),v.dispose(!1,!0)})}function $e(e,n,t="ManualNode",o=new l(.08,.08,.08),i=1){const s=`box_${D.length}`,u=t==="VariableStatement"&&i===1;let a;if(u){if(!F){F=L.CreatePolyhedron("variable-octahedron-source",{type:1,size:o.x/(2*Math.SQRT2),flat:!0},p),F.position.y=-1e3,F.isPickable=!1,F.useVertexColors=!0,F.registerInstancedBuffer("color",4),F.instancedBuffers.color=new me(1,1,1,1);const f=new _("variable-octahedron-material",p);f.diffuseColor=x.White(),f.emissiveColor=new x(.094,.094,.094),F.material=f}a=F.createInstance(s);const r=Pe(t);He.add(a),We.set(a,r),a.instancedBuffers.color=new me(r.r,r.g,r.b,1)}else{a=L.CreateBox(s,{width:o.x,height:o.y,depth:o.z},p);const r=new _(`boxMat_${D.length}`,p);r.diffuseColor=Pe(t),r.emissiveColor=new x(.094,.094,.094),r.alpha=i,r.backFaceCulling=i===1,a.material=r}return a.position.copyFrom(e),a.rotationQuaternion=W.Identity(),a.parent=K,a.isPickable=i===1,a.computeWorldMatrix(!0),D.push(a),un(a,n??`Node ${D.length}`,o.y/2+.035,i<1),a}function De(e,n){const t=n.position.subtract(e.position),o=e.getBoundingInfo().boundingBox.extendSize,i=e.position.clone();return Math.abs(t.x)>=Math.abs(t.y)&&Math.abs(t.x)>=Math.abs(t.z)?i.x+=Math.sign(t.x)*o.x:Math.abs(t.y)>=Math.abs(t.z)?i.y+=Math.sign(t.y)*o.y:i.z+=Math.sign(t.z)*o.z,i}function hn(e,n){const t=se.get(e);if(!t)return n;const o=t.getBoundingInfo().boundingBox.extendSize,i=e.getBoundingInfo().boundingBox.extendSize,s=.03,u=new l(Math.max(0,o.x-i.x-s),Math.max(0,o.y-i.y-s),Math.max(0,o.z-i.z-s)),a=t.position.subtract(u),r=t.position.add(u);return new l(Math.max(a.x,Math.min(n.x,r.x)),Math.max(a.y,Math.min(n.y,r.y)),Math.max(a.z,Math.min(n.z,r.z)))}function mn(e,n){const t=hn(e,n),o=t.subtract(e.position);if(!(o.lengthSquared()<1e-12)){e.position.copyFrom(t),e.computeWorldMatrix(!0);for(const i of D){let s=se.get(i);for(;s;){if(s===e){i.position.addInPlace(o),i.computeWorldMatrix(!0);break}s=se.get(s)}}}}function Ze(){for(const e of ae){const n=De(e.startNode,e.endNode),t=De(e.endNode,e.startNode),o=t.subtract(n),i=Math.max(o.length(),1e-4),s=o.scale(1/i),u=.12,a=Math.min(.08,i*.4),r=Math.max(i-a,.001),f=Math.max(.021,e.weight*.03),h=n.add(s.scale(r/2));e.shaft.position.copyFrom(h),e.shaft.scaling=new l(f,r,f);const c=l.Up(),d=l.Cross(c,s),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(c,s))));e.shaft.rotationQuaternion=d.lengthSquared()<1e-6?W.Identity():W.RotationAxis(d.normalize(),g);const S=t.subtract(s.scale(a/2)),w=Math.max(.016,f*2.4);e.head.position.copyFrom(S),e.head.scaling=new l(w,a/u,w),e.head.rotationQuaternion=e.shaft.rotationQuaternion?.clone()??W.Identity()}}function fn(e){for(const[o,i]of Array.from(N.entries()))i===e&&$(o);const n=D.indexOf(e);n>=0&&D.splice(n,1),se.delete(e);const t=ae.filter(o=>o.startNode===e||o.endNode===e);for(const o of t)o.shaft.dispose(),o.head.dispose();for(const o of t){const i=ae.indexOf(o);i>=0&&ae.splice(i,1)}e.dispose()}function Qe(e){return e.inputSource.handedness==="left"?"left":"right"}function Ue(e){const n=e.motionController;if(!n)return{x:0,y:0};const t=n.getComponent("thumbstick")??n.getComponent("xr-standard-thumbstick")??n.getComponentOfType("thumbstick")??n.getComponent("touchpad");if(!t)return{x:0,y:0};const o=t.axes,i=o?.x??0,s=o?.y??0;return{x:Math.abs(i)<.2?0:i,y:Math.abs(s)<.2?0:s}}function bn(e){return-Ue(e).y*.02}function gn(e){const n=p.activeCamera;if(!n)return;const t=n.getDirection(l.Forward());if(t.y=0,t.lengthSquared()<1e-6)return;t.normalize();const o=l.Cross(t,l.Up()).normalize(),i=l.Zero(),s=.8,u=1.2;let a=0;for(const c of j){if(ce.has(c)||Y.has(c))continue;const d=Ue(c);Qe(c)==="left"?(i.addInPlace(o.scale(-d.x)),i.addInPlace(t.scale(d.y))):(i.addInPlace(l.Up().scale(d.y)),a-=d.x*u*e)}i.scaleInPlace(s*e);const r=n.globalPosition,f=Math.cos(a),h=Math.sin(a);for(const c of D){if(c.position.addInPlace(i),Math.abs(a)>1e-6){const d=c.position.x-r.x,g=c.position.z-r.z;c.position.x=r.x+d*f+g*h,c.position.z=r.z-d*h+g*f}c.computeWorldMatrix(!0)}if(y&&!V){if(y.position.addInPlace(i),Math.abs(a)>1e-6){const c=y.position.x-r.x,d=y.position.z-r.z;y.position.x=r.x+c*f+d*h,y.position.z=r.z-c*h+d*f,y.rotate(l.Up(),-a)}y.computeWorldMatrix(!0)}}function pn(e){const o=((e.pointer??e.grip)?.getDirection?.(l.Forward())??l.Forward()).normalize();let i=l.Cross(o,l.Up());i.lengthSquared()<1e-6&&(i=l.Cross(o,l.Forward())),i.normalize();const s=l.Cross(i,o);return s.normalize(),{depthAxis:o,rightAxis:i,upAxis:s}}function G(e,n=!0,t=!1){if(n){const h=Q.get(e);if(h)return h}if(A?.baseExperience.state===q.IN_XR&&!e._lastXRPose){const h={mesh:null,point:null};return n&&Q.set(e,h),h}const o=e.pointer??e.grip;if(!o)return null;const i=o.absolutePosition?.clone()??l.Zero(),u=(o.getDirection?.(l.Forward())??l.Forward()).normalize();let a=l.Cross(u,l.Up());a.lengthSquared()<1e-6&&(a=l.Cross(u,l.Forward())),a.normalize();const r=[u,u.add(a.scale(.08)).normalize(),u.add(a.scale(-.08)).normalize(),u.add(a.scale(.16)).normalize(),u.add(a.scale(-.16)).normalize()];for(const h of r){const c=new Fe(i,h);c.length=8;const d=p.pickWithRay(c,g=>D.includes(g)||t&&be.has(g));if(d?.pickedMesh){const S={mesh:be.get(d.pickedMesh)??d.pickedMesh,point:d.pickedPoint?.clone()??i.add(h.scale(.8))};return n&&Q.set(e,S),S}}const f={mesh:null,point:null};return n&&Q.set(e,f),f}function we(e,n=!1){return G(e,!n,n)?.mesh??null}function xn(e){const n=[e.pointer?.absolutePosition,e.grip?.absolutePosition].filter(s=>!!s);if(n.length===0)return null;const t=.025**2;let o=null,i=Number.POSITIVE_INFINITY;for(const s of D){if(!s.isPickable)continue;s.computeWorldMatrix(!0);const u=s.getBoundingInfo().boundingBox;for(const a of n){const r=Math.max(u.minimumWorld.x,Math.min(a.x,u.maximumWorld.x)),f=Math.max(u.minimumWorld.y,Math.min(a.y,u.maximumWorld.y)),h=Math.max(u.minimumWorld.z,Math.min(a.z,u.maximumWorld.z)),c=l.DistanceSquared(a,new l(r,f,h));c<=t&&c<i&&(o=s,i=c)}}return o}function Ve(e){if(!U||V&&V!==e)return!1;const n=e.pointer??e.grip;if(!n)return!1;const t=n.absolutePosition?.clone()??l.Zero(),o=n.getDirection?.(l.Forward()).normalize()??l.Forward(),i=new Fe(t,o,8);return p.pickWithRay(i,s=>s===U)?.pickedMesh===U}function Cn(){if(!y||!V)return;const e=V.grip??V.pointer,n=p.activeCamera;!e?.absolutePosition||!n||(y.position.copyFrom(e.absolutePosition.add(l.Up().scale(.09))),y.lookAt(n.globalPosition),y.computeWorldMatrix(!0))}function he(){y||_e();const e=p.activeCamera;if(!y||!e)return;V=null;const n=e.getDirection(l.Forward()).normalize();y.position.copyFrom(e.globalPosition.add(n.scale(.65)).add(l.Down().scale(.12))),y.lookAt(e.globalPosition),y.computeWorldMatrix(!0),C("📟 Tablet summoned")}function yn(e){const n=L.CreateCylinder(`beam_${e.uniqueId??"controller"}`,{height:1,diameter:.008,tessellation:6},p);n.parent=K,n.isPickable=!1;const t=new _(`beamMat_${e.uniqueId??"controller"}`,p);return t.diffuseColor=new x(.2,.8,1),t.emissiveColor=new x(.1,.35,.7),t.alpha=.9,t.disableLighting=!0,n.material=t,n}function Sn(e,n){const t=e.pointer??e.grip,o=ge.get(e)??yn(e);if(ge.set(e,o),!t){o.setEnabled(!1);return}const i=t.absolutePosition?.clone()??l.Zero(),u=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),a=n??G(e),r=Y.get(e)??null,f=r?r.position.clone():a?.point,h=f?l.Distance(i,f):2.2;if(o.setEnabled(!0),o.position.copyFrom(i.add(u.scale(h/2))),o.scaling.y=h,o.scaling.x=1,o.scaling.z=1,u.lengthSquared()>1e-6){const c=l.Up(),d=l.Cross(c,u),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(c,u))));o.rotationQuaternion=d.lengthSquared()<1e-6?W.Identity():W.RotationAxis(d.normalize(),g)}else o.rotationQuaternion=W.Identity()}function vn(e,n){const t=e.pointer??e.grip,i=(n??G(e))?.mesh??null;if(!t){$(e);return}i?N.get(e)!==i&&ln(e,i):$(e)}function Me(e){return j.filter(t=>t!==e)[0]??null}function Ye(e){const n=[R===e?Me(e):e,e].filter(t=>!!t);for(const t of n){const o=we(t)??N.get(t)??null;if(o&&o!==E)return o}return null}function Bn(e,n){const t=e.pointer??e.grip;if(!t)return l.Zero();const o=t.absolutePosition?.clone()??l.Zero(),s=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),u=R===e?Me(e):e,a=n??G(u||e);return a?.point?a.point.clone():o.add(s.scale(.8))}function ne(){de&&(de.dispose(),de=null)}function wn(e,n){if(!E||R!==e){I&&(I.dispose(),I=null);const a=n?.mesh??null;if(a){const r=n?.point?.clone()??e.pointer?.absolutePosition?.clone()??e.grip?.absolutePosition?.clone()??l.Zero(),f=a.position.clone();ne();const h=L.CreateLines("hover-connection-preview",{points:[r,f]},p);h.color=new x(.2,.85,1),h.alpha=.35,h.parent=K,h.isPickable=!1,de=h}else ne();return}ne();const t=Me(e),o=t?G(t):null,s=(o?.mesh??null)?.position?.clone()??Bn(t??e,o??void 0);I&&I.dispose();const u=L.CreateLines("connection-preview",{points:[E.position.clone(),s]},p);u.color=new x(.35,1,1),u.alpha=1,u.parent=K,u.isPickable=!1,I=u}function Mn(e){return e==="reference"?{diffuse:new x(1,.25,.82),emissive:new x(.9,.12,.65),head:new x(1,.42,.9)}:e==="user"?{diffuse:new x(1,.72,.18),emissive:new x(.95,.5,.08),head:new x(1,.84,.35)}:{diffuse:new x(.35,1,1),emissive:new x(.25,.9,1),head:new x(.45,1,1)}}function Ke(e,n,t=1,o="user"){const i=Mn(o),s=L.CreateCylinder("connection-shaft",{height:1,diameter:.04,tessellation:12},p);s.parent=K,s.isPickable=!1,s.metadata={connectionKind:o};const u=new _("connection-shaft-mat",p);u.diffuseColor=i.diffuse,u.emissiveColor=i.emissive,u.disableLighting=!0,s.material=u;const a=L.CreateCylinder("connection-head",{height:.12,diameterTop:.001,diameterBottom:.08,tessellation:12},p);a.parent=K,a.isPickable=!1,a.metadata={connectionKind:o};const r=new _("connection-head-mat",p);return r.diffuseColor=i.head,r.emissiveColor=i.emissive,r.disableLighting=!0,a.material=r,ae.push({shaft:s,head:a,startNode:e,endNode:n,weight:t,kind:o}),Ze(),s}class In{constructor(n,t,o,i){this.idealEdgeLength=n,this.depthSpacing=t,this.origin=o,this.iterations=i}layout(n,t){const o=Math.PI*(3-Math.sqrt(5)),i=n.map((a,r)=>{const f=this.idealEdgeLength*Math.sqrt(r+1)*.45,h=r*o;return new l(Math.cos(h)*f,Math.sin(h)*f*.25,-a.depth*this.depthSpacing)}),s=this.idealEdgeLength*this.idealEdgeLength;for(let a=0;a<this.iterations;a+=1){const r=n.map(()=>l.Zero());for(let c=0;c<i.length;c+=1)for(let d=c+1;d<i.length;d+=1){const g=i[c].subtract(i[d]),S=Math.max(g.length(),.001),w=g.scale(s/(S*S*S));r[c].addInPlace(w),r[d].subtractInPlace(w)}for(const c of t){const d=i[c.targetIndex].subtract(i[c.sourceIndex]),g=Math.max(d.length(),.001),S=g-this.idealEdgeLength,w=d.scale(S*c.strength/g);r[c.sourceIndex].addInPlace(w),r[c.targetIndex].subtractInPlace(w)}n.forEach((c,d)=>{const g=-c.depth*this.depthSpacing;r[d].z+=(g-i[d].z)*.35,r[d].y-=i[d].y*.08});const f=a/Math.max(this.iterations-1,1),h=this.idealEdgeLength*(.22*(1-f)+.01);i.forEach((c,d)=>{const g=r[d].length();g>1e-6&&c.addInPlace(r[d].scale(Math.min(g,h)/g))})}const u=i.reduce((a,r)=>a.addInPlace(r),l.Zero()).scaleInPlace(1/i.length);return i.map(a=>this.origin.add(a.subtract(u)))}}function kn(e,n={}){const t=n.maxDepth??3,o=n.maxNodes??72,i=n.horizontalSpacing??.14,s=n.depthSpacing??.2,u=n.layoutIterations??120,a=n.origin?.clone()??new l(0,.1,0),r=[{node:e,parentIndex:null,depth:0}];for(let m=0;m<r.length&&r.length<o;m+=1){const b=r[m];if(!(b.depth>=t))for(const M of b.node.children){if(r.length>=o)break;r.push({node:M,parentIndex:m,depth:b.depth+1})}}const f=new Map;r.forEach((m,b)=>f.set(m.node.start,b));const h=r.flatMap((m,b)=>m.parentIndex===null?[]:[{sourceIndex:m.parentIndex,targetIndex:b,strength:.9}]),c=[],d=new Set,g=(m,b)=>{const M=f.get(m),B=f.get(b),T=`${m}:${b}`;M===void 0||B===void 0||M===B||d.has(T)||(d.add(T),c.push({sourceIndex:M,targetIndex:B,strength:.4}))};r.forEach(m=>{m.node.uses.forEach(b=>{const M=r[f.get(b)??-1]?.node,B=m.node.kind==="FunctionDeclaration"&&M?.kind==="FunctionDeclaration";g(B?m.node.start:b,B?b:m.node.start)}),m.node.usedBy.forEach(b=>{const M=r[f.get(b)??-1]?.node,B=m.node.kind==="FunctionDeclaration"&&M?.kind==="FunctionDeclaration";g(B?b:m.node.start,B?m.node.start:b)})});const S=new Array(r.length),k=new In(i,s,a,u).layout(r,[...h,...c]),v=r.map(()=>[]);r.forEach((m,b)=>{m.parentIndex!==null&&v[m.parentIndex].push(b)});const P=k.map(m=>m.clone()),z=k.map(()=>.04);for(let m=r.length-1;m>=0;m-=1){const b=v[m];if(b.length===0)continue;const M=b.reduce((oe,X)=>{const Z=z[X];return l.Minimize(oe,P[X].subtract(new l(Z,Z,Z)))},new l(Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY)),B=b.reduce((oe,X)=>{const Z=z[X];return l.Maximize(oe,P[X].add(new l(Z,Z,Z)))},new l(Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY)),T=M.add(B).scale(.5),te=b.reduce((oe,X)=>Math.max(oe,l.Distance(T,P[X])+z[X]),0)+.08;P[m]=T,z[m]=te}return r.forEach((m,b)=>{const M=m.node.label,B=v[b].length>0,T=z[b]*2,te=$e(P[b],M,m.node.kind,B?new l(T,T,T):void 0,B?.1:1);te.name=`ast_${b}_${M.replace(/[^a-z0-9]+/gi,"_")}`,te.metadata={astKind:m.node.kind,astLabel:M,sourceStart:m.node.start,sourceEnd:m.node.end},S[b]=te}),r.forEach((m,b)=>{m.parentIndex!==null&&v[m.parentIndex].length>0&&se.set(S[b],S[m.parentIndex])}),c.forEach(m=>{if(v[m.sourceIndex].length>0&&v[m.targetIndex].length>0)return;const b=r[m.sourceIndex].node.start,M=r[m.targetIndex].node.start,B=Ke(S[m.sourceIndex],S[m.targetIndex],.3,"reference");B.metadata={...B.metadata,fromId:b,toId:M}}),S.length}function Te(e){const n=xn(e);return n?(fn(n),!0):!1}function Ee(e){const t=(e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero()).add(new l(0,.02,0));$e(t),C(`📦 Placed box (${D.length})`)}function Rn(e){const n=we(e)??N.get(e)??null;if(qe(n),E&&R&&R!==e){Ye(e)?Pn(e):C("🔗 Point the second controller at the destination node");return}if(R===e)return;const t=n;t?(E=t,R=e,C("🔗 Select the destination with the other controller")):(E=null,R=null,I?.dispose(),I=null,ne(),C("🔗 Point at a node to start a connection"))}function Pn(e){const n=R,t=Ye(e);if(E&&t&&t!==E){if(Ke(E,t),n&&(J.get(n)??!1)){I?.dispose(),I=null,C("🔗 Connection drawn — select another destination");return}C("🔗 Connection drawn")}else C("🔗 Connection cancelled");E=null,R=null,I?.dispose(),I=null,ne()}function Dn(){E=null,R=null,I?.dispose(),I=null,ne(),C("🔗 Connection cancelled")}function Vn(e){const n=e.motionController;if(!n)return;const t=Qe(e),o=t==="left",i=t==="right",s=n.getComponent("trigger")??n.getComponent("xr-standard-trigger")??n.getComponent("squeeze")??n.getComponentOfType("trigger")??n.getComponentOfType("squeeze");s&&s.onButtonStateChangedObservable.add(d=>{const g=J.get(e)??!1;if(d.pressed&&!g){if(Ve(e)){C("📟 Read-only source tablet"),n.pulse?.(.15,50);return}J.set(e,!0),Rn(e),n.pulse?.(.15,50)}else!d.pressed&&g&&(J.set(e,!1),R===e&&Dn())});const u=n.getComponent("squeeze")??n.getComponentOfType("squeeze");u&&u.onButtonStateChangedObservable.add(d=>{if(d.pressed?ce.add(e):ce.delete(e),d.pressed){if(Ve(e))V=e,C("🤏 Tablet grabbed — release grip to place it");else{const g=we(e,!0);if(!g){C("🎯 Hold grip on a box or tablet to move it"),n.pulse?.(.3,100);return}Y.set(e,g);const S=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),k=(e.pointer?.getDirection?.(l.Forward())??l.Forward()).normalize(),v=g.position.subtract(S),P=l.Dot(v,k);le.set(e,P<.01?.15:P),C("🤏 Grip grabbed distant box")}n.pulse?.(.3,100)}else V===e?(V=null,C("✋ Tablet released")):Y.has(e)&&(Y.delete(e),le.delete(e),C("✋ Box released"))});const a=n.getComponent("a-button")??n.getComponent("x-button"),r=n.getComponent("x-button")??n.getComponent("y-button")??n.getComponent("a-button");a&&(i||!o&&!i)&&a.onButtonStateChangedObservable.add(d=>{d.pressed&&(Te(e)||he(),n.pulse?.(.2,70))}),r&&(o||!o&&!i)&&r.onButtonStateChangedObservable.add(d=>{d.pressed&&(Te(e)||he(),n.pulse?.(.2,70))});const f=n.getComponent("b-button")??n.getComponent("y-button")??n.getComponent("a-button");f&&(i||!o&&!i)&&f.onButtonStateChangedObservable.add(d=>{d.pressed&&(Ee(e),n.pulse?.(.2,70))});const h=n.getComponent("y-button");h&&o&&h.onButtonStateChangedObservable.add(d=>{d.pressed&&(Ee(e),n.pulse?.(.2,70))});const c=n.getComponent("menu")??n.getComponent("xr-standard-menu");if(c&&o){let d=!1;c.onButtonStateChangedObservable.add(g=>{g.pressed&&!d&&(he(),n.pulse?.(.2,70)),d=g.pressed})}C("🕶 Quest 3 controller layout ready")}async function Tn(){if(!(!A||O)&&A.baseExperience.state!==q.IN_XR){O=!0,C("▶️ Requesting AR session…");try{await A.baseExperience.enterXRAsync("immersive-ar","local-floor")}catch(e){console.error(e),C(`❌ AR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{O=!1,fe()}}}async function En(){if(!(!A||O)&&A.baseExperience.state!==q.IN_XR){O=!0,C("▶️ Requesting VR session…");try{await A.baseExperience.enterXRAsync("immersive-vr","local-floor")}catch(e){console.error(e),C(`❌ VR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{O=!1,fe()}}}async function Ln(){if(C("⏳ Initialising WebXR…"),typeof navigator.xr>"u"){C("❌ WebXR is not available in this browser");return}if(ue=await navigator.xr.isSessionSupported("immersive-ar").catch(()=>!1),Se=await navigator.xr.isSessionSupported("immersive-vr").catch(()=>!1),!ue&&!Se){C("❌ Immersive AR/VR is not supported on this device/browser");return}const e=await nn.CreateAsync(p,{disableDefaultUI:!0,disablePointerSelection:!0,disableTeleportation:!0,disableNearInteraction:!0,uiOptions:{sessionMode:ue?"immersive-ar":"immersive-vr"},optionalFeatures:!0});A=e,e.baseExperience.onStateChangedObservable.add(n=>{n===q.IN_XR?(pe=!0,C("🟢 XR ready — Aim assist: optimized • Grip: grab/move • Trigger: draw connections • B/Y: place • X/A: delete")):n===q.NOT_IN_XR&&(pe=!1,$(),Q.clear(),C("⬜ XR not active")),fe()}),e.input.onControllerAddedObservable.add(n=>{j.push(n),n.onMotionControllerInitObservable.add(()=>{Vn(n)})}),e.input.onControllerRemovedObservable.add(n=>{const t=j.indexOf(n);t>=0&&j.splice(t,1);const o=ge.get(n);o&&(o.dispose(),ge.delete(n)),J.delete(n),Y.delete(n),le.delete(n),ce.delete(n),V===n&&(V=null),$(n),Q.delete(n)}),rn(),fe()}ie&&ie.addEventListener("click",async()=>{xe(),await Tn()});re&&re.addEventListener("click",async()=>{xe(),await En()});window.addEventListener("click",()=>{A?.baseExperience.state!==q.IN_XR&&xe()});for(const e of Array.from(document.querySelectorAll("[data-action]")))e.addEventListener("click",()=>{const n=e.getAttribute("data-action");if(n){if(n.startsWith("node-")){const t=n.replace("node-","").replace(/^./,o=>o.toUpperCase());C(`🧠 Selected ${t} node`),e.classList.add("active");for(const o of Array.from(document.querySelectorAll("[data-action]")))o!==e&&o.classList.remove("active")}sn(!1)}});p.registerBeforeRender(()=>{Q.clear(),pe&&A?.baseExperience.state===q.IN_XR&&(pe=!1,he()),gn(p.getEngine().getDeltaTime()/1e3);for(const[e,n]of Array.from(Y.entries())){const t=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),o=pn(e),i=bn(e),s=le.get(e)??.15,u=Math.abs(i)>1e-6?Math.max(.05,s+i):s;le.set(e,u);const a=t.add(o.depthAxis.scale(u));mn(n,a)}Cn(),Ze();for(const e of j){const n=G(e);n?.mesh||$(e),Sn(e,n??void 0),vn(e,n??void 0),R===e&&wn(e,n??void 0)}for(const e of H.keys())Oe(e)});Be.runRenderLoop(()=>{p.render()});window.addEventListener("resize",()=>Be.resize());Ln().catch(e=>{console.error(e),C("❌ WebXR could not start")});xe();
//# sourceMappingURL=astXr-DvLMfxdy.js.map
