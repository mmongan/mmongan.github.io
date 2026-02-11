import { MeshBuilder, Scene, TransformNode, AbstractMesh, StandardMaterial, Color3, DynamicTexture, ActionManager, ExecuteCodeAction } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Build marker to help identify built bundles
const MENU_BUILD_MARKER = "MENU_BUILD_MARKER_v2026_02_09_2";

export type ShapeType = "tetrahedron" | "cube" | "octahedron" | "dodecahedron" |
 "icosahedron" | "sphere" | "poly0" | "poly1" | "poly2" | "poly3" | "poly4" | "poly5" | "poly6" | "poly7" | "poly8" | "poly9" | "poly10" | "poly11" | "poly12" | "poly13" | "poly14";
export interface MenuShapeModel {
  mesh: AbstractMesh;
  shapeType: ShapeType;
}

export default async function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (s: ShapeType, spawnPos?: Vector3, spawnSize?: number) => void): Promise<{ menu: AbstractMesh; shapeModels: MenuShapeModel[] }> {
  // menu visual - cube volume (evenly spaced items inside)
  const menuSize = 0.5; // cube side length (meters) - shrunk per user request
  const menuPadding = 0.03; // padding (slightly reduced for tighter layout)
  const menuBox = MeshBuilder.CreateBox("menuBox", { width: menuSize, height: menuSize, depth: menuSize }, scene);
  // move closer so the cube is easy to see in typical camera view
  menuBox.position = new Vector3(0, 1.0, -0.6);
  menuBox.rotation.x = 0;
  menuBox.rotation.y = 0;
  // attempt to orient the menu to face the parent camera so it's more likely to be visible
  try {
    if (parentCamera && (parentCamera as any).getAbsolutePosition) {
      const camPos = (parentCamera as any).getAbsolutePosition();
      menuBox.lookAt(camPos);
    }
  } catch (e) {}

  const menuMaterial = new StandardMaterial("menuBoxMat", scene);
  // transparent menu box per request
  menuMaterial.diffuseColor = Color3.FromHexString("#E8E8E8");
  menuMaterial.emissiveColor = Color3.Black();
  menuMaterial.alpha = 0.2; // transparent
  menuMaterial.backFaceCulling = false;
  menuBox.material = menuMaterial;

  const shapeModels: MenuShapeModel[] = [];

  try {
    (window as any).__MENU_DEBUG = (window as any).__MENU_DEBUG || {};
    (window as any).__MENU_DEBUG.cornerSpheres = [];
    try {
      const dbg = document.getElementById('menu-debug');
      if (dbg) {
        dbg.textContent = dbg.textContent + ' • no handles';
      } else {
        const el = document.createElement('div');
        el.id = 'menu-debug-corners';
        el.style = 'position:fixed;right:8px;bottom:36px;background:#220;color:white;padding:4px 6px;border-radius:4px;font-family:monospace;font-size:11px;z-index:9999';
        el.textContent = 'menu corners: removed';
        document.body.appendChild(el);
      }
    } catch (e) {}
  } catch (e) {}

  // quick build landmark for verifying this source is included in builds
  try { console.log('MENU_3x3x3_LANDMARK_v2'); } catch (e) {}

  // Create shape models positioned around the menu in a 3x3x3 stacked grid (columns x rows x layers)
  const cols = 3;
  const rows = 3;
  const layers = 3;

  const paletteColors = ['#98D8C8','#FF6B6B','#45B7D1','#FFA07A','#F6C9E2','#D4A5FF','#FFB86B','#B0E57C','#9AD0FF','#E3E66D','#C0C0C0','#FF9FB4','#8FD3C7','#D9B8FF','#FFD7A6'];
  const shapesList: Array<{label:string, shape:ShapeType, color:string}> = [];
  for (let i = 0; i < 15; i++) {
    shapesList.push({ label: `Poly${i}`, shape: (`poly${i}` as ShapeType), color: paletteColors[i % paletteColors.length] });
  }
  shapesList.push({ label: 'Sphere', shape: 'sphere', color: '#FFD166' });
  shapesList.push({ label: 'Cube', shape: 'cube', color: '#4ECDC4' });

  const innerSide = menuSize - menuPadding * 2;
  const xSpacing = cols > 1 ? innerSide / (cols - 1) : 0;
  const ySpacing = rows > 1 ? innerSide / (rows - 1) : 0;
  const zSpacing = layers > 1 ? innerSide / (layers - 1) : 0;

  const minSpacing = Math.min(xSpacing || 0.08, ySpacing || 0.08, zSpacing || 0.08);
  // compute slot marker size directly from spacing so reference spheres are consistent
  // and cap it for visibility. We'll make palette model shapes match this marker size.
  // reduce marker and model sizes slightly so palette items do not touch each other
  const slotMarkerSize = Math.max(0.018, Math.min(0.05, minSpacing * 0.4));
  // set model size to a smaller fraction of the slot marker so models reliably fit inside
  // make shapes noticeably smaller to reliably fit inside each slot
  // use a smaller fraction of the slot marker and a conservative minimum
  const shapeSize = Math.max(0.01, slotMarkerSize * 0.25);
  // expose recommended spawn size for runtime spawns and debugging
  try { (window as any).__MENU_DEBUG = (window as any).__MENU_DEBUG || {}; (window as any).__MENU_DEBUG.spawnSize = shapeSize; } catch (e) {}

  // add a visible debug label on the menu showing the computed sizes (helps prove runtime values)
  try {
    try { console.log('MENU_DEBUG: slotMarkerSize=', slotMarkerSize, 'shapeSize=', shapeSize); } catch (e) {}
    const sizeTex = new DynamicTexture("menuSizeTex", { width: 256, height: 48 }, scene, false);
    sizeTex.hasAlpha = true;
    sizeTex.drawText(`slot:${slotMarkerSize.toFixed(4)} shape:${shapeSize.toFixed(4)}`, null, 30, "bold 16px Arial", "#FFFFFF", "transparent", true);
    const sizeMat = new StandardMaterial("menuSizeMat", scene);
    sizeMat.diffuseTexture = sizeTex;
    sizeMat.specularColor = Color3.Black();
    sizeMat.emissiveColor = Color3.FromHexString("#FFFFFF");
    sizeMat.backFaceCulling = false;
    const sizePlane = MeshBuilder.CreatePlane("menuSizePlane", { width: Math.min(innerSide * 0.6, 0.32), height: 0.06 }, scene);
    sizePlane.parent = menuBox;
    // place near the bottom front so it's visible
    sizePlane.position = new Vector3(0, -menuSize / 2 + 0.04, menuSize / 2 + 0.005);
    sizePlane.material = sizeMat;
    sizePlane.isPickable = false;
  } catch (e) {}

  // spacing between layers (depth)
  const layerSpacing = zSpacing;

  try {
    const MENU_DEBUG_MARKER = "MENU_DEBUG_TOKEN_v1";
    // include the build marker so the debug plane shows a clear, unique build/version string
    const VERSION_LABEL = MENU_BUILD_MARKER || "MENU_BUILD_MARKER_unknown";
    const debugText = `${MENU_DEBUG_MARKER} • ${VERSION_LABEL} • ${new Date().toISOString()}`;
    const tex = new DynamicTexture("menuDebugTex", { width: 512, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.getContext().font = "bold 28px Arial";
    tex.drawText(debugText, null, 36, "bold 20px Arial", "#FFFFFF", "transparent", true);

    const labelMat = new StandardMaterial("menuDebugMat", scene);
    labelMat.diffuseTexture = tex;
    labelMat.specularColor = Color3.Black();
    labelMat.emissiveColor = Color3.FromHexString("#FFFFFF");

    const labelWidth = Math.min(innerSide * 0.9, 0.4);
    const labelHeight = 0.08;
    const labelPlane = MeshBuilder.CreatePlane("menuDebugPlane", { width: labelWidth, height: labelHeight }, scene);
    labelPlane.parent = menuBox;
    // place centered above the cube (slightly closer for the smaller cube)
    labelPlane.position = new Vector3(0, menuSize / 2 + labelHeight / 2 + 0.005, 0);
    labelPlane.material = labelMat;
    labelPlane.isPickable = false;

    // Add a small version-only plane on the front face for quick visual verification
    try {
      const versionTex = new DynamicTexture("menuVersionTex", { width: 256, height: 48 }, scene, false);
      versionTex.hasAlpha = true;
      versionTex.drawText(VERSION_LABEL, null, 30, "bold 16px Arial", "#FFFFFF", "transparent", true);
      const versionMat = new StandardMaterial("menuVersionMat", scene);
      versionMat.diffuseTexture = versionTex;
      versionMat.specularColor = Color3.Black();
      versionMat.emissiveColor = Color3.FromHexString("#FFD166");
      versionMat.alpha = 1.0;
      versionMat.backFaceCulling = false;
      const vPlane = MeshBuilder.CreatePlane("menuVersionPlane", { width: Math.min(innerSide * 0.7, 0.35), height: 0.08 }, scene);
      vPlane.parent = menuBox;
      // place on the front face, centered and slightly in front
      vPlane.position = new Vector3(0, menuSize / 4, menuSize / 2 + 0.005);
      vPlane.material = versionMat;
      vPlane.isPickable = false;
    } catch (e) {}
  } catch (e) {}

  // Debug visuals (temporary) — wireframe cube + emissive slot markers
  const DEBUG_VISUALS = true;
  if (DEBUG_VISUALS) {
    try {
      const h = menuSize / 2;
      const p1 = new Vector3(-h, -h, -h);
      const p2 = new Vector3(h, -h, -h);
      const p3 = new Vector3(h, h, -h);
      const p4 = new Vector3(-h, h, -h);
      const p5 = new Vector3(-h, -h, h);
      const p6 = new Vector3(h, -h, h);
      const p7 = new Vector3(h, h, h);
      const p8 = new Vector3(-h, h, h);
      const lines = [
        [p1, p2, p3, p4, p1],
        [p5, p6, p7, p8, p5],
        [p1, p5],
        [p2, p6],
        [p3, p7],
        [p4, p8]
      ];
      const wire = MeshBuilder.CreateLineSystem('menuWireframe', { lines }, scene);
      wire.parent = menuBox;
      // bright cyan wireframe for visibility
      try { (wire as any).color = Color3.FromHexString('#00FFEA'); } catch (er) {}
    } catch (er) {}

      try {
        // Light crosshair markers at each grid slot position
        const markerLen = slotMarkerSize * 0.5; // half-length of each axis line
        const slotLines: Vector3[][] = [];
        for (let li = 0; li < layers; li++) {
          for (let ri = 0; ri < rows; ri++) {
            for (let ci = 0; ci < cols; ci++) {
              const cx = -innerSide / 2 + ci * xSpacing;
              const cy =  innerSide / 2 - ri * ySpacing;
              const cz = -innerSide / 2 + li * zSpacing;
              // three short axis lines per slot
              slotLines.push([new Vector3(cx - markerLen, cy, cz), new Vector3(cx + markerLen, cy, cz)]);
              slotLines.push([new Vector3(cx, cy - markerLen, cz), new Vector3(cx, cy + markerLen, cz)]);
              slotLines.push([new Vector3(cx, cy, cz - markerLen), new Vector3(cx, cy, cz + markerLen)]);
            }
          }
        }
        const slotWire = MeshBuilder.CreateLineSystem('menuSlotMarkers', { lines: slotLines }, scene);
        slotWire.parent = menuBox;
        try { (slotWire as any).color = Color3.FromHexString('#FFFFFF'); } catch (er) {}
        try { (slotWire as any).alpha = 0.6; } catch (er) {}
      } catch (er) {}
  }

  const createPaletteShape = (label: string, shape: ShapeType, color: string, gridRow: number, gridCol: number, layerIdx: number) => {
    const xOffset = -innerSide / 2 + gridCol * xSpacing;
    const yOffset = innerSide / 2 - gridRow * ySpacing;
    const zOffset = -innerSide / 2 + layerIdx * zSpacing;

    let shapeModel: AbstractMesh | null = null;

      try {
        // create primitives sized directly to `shapeSize` so they occupy the intended
        // real-world scale without needing post-creation scaling/baking
        if (shape === 'sphere') {
          shapeModel = MeshBuilder.CreateSphere(label + "-shape", { diameter: shapeSize }, scene);
        } else if (shape === 'cube') {
          shapeModel = MeshBuilder.CreateBox(label + "-shape", { size: shapeSize }, scene);
        } else if ((shape as string).startsWith('poly')) {
          const idx = parseInt((shape as string).replace('poly', ''), 10);
          try {
            shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: idx, size: shapeSize }, scene);
          } catch (e) {
            console.warn('poly creation failed for', label, 'index', idx, e);
            shapeModel = MeshBuilder.CreateBox(label + "-shape", { size: shapeSize }, scene);
          }
        } else {
        switch (shape) {
          case "tetrahedron":
            shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: 0, size: shapeSize }, scene);
            break;
          case "octahedron":
            shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: 1, size: shapeSize }, scene);
            break;
          case "dodecahedron":
            shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: 2, size: shapeSize }, scene);
            break;
          case "icosahedron":
            shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: 3, size: shapeSize }, scene);
            break;
        }
      }
    } catch (e) {
      console.warn('failed to create shapeModel for', label, e);
    }

    if (shapeModel) {
      shapeModel.name = label + "-shape";
      const mat = new StandardMaterial(label + "-mat", scene);
      mat.diffuseColor = Color3.FromHexString(color);
      // make the material emissive so shapes are clearly visible
      mat.emissiveColor = Color3.FromHexString(color);
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      shapeModel.material = mat;
      shapeModel.isVisible = false;  // shapes hidden per user request
      shapeModel.isPickable = false;

      // Scale the unit primitive so its world size matches `shapeSize` reliably.
      try {
        // compute the mesh's unscaled bounding box size
        try { shapeModel.computeWorldMatrix(true); } catch (e) {}
        let bb = null;
        try { bb = (shapeModel.getBoundingInfo && shapeModel.getBoundingInfo().boundingBox) || null; } catch (e) { bb = null; }
        if (bb) {
          const currentSizeX = bb.maximum.x - bb.minimum.x;
          const currentSizeY = bb.maximum.y - bb.minimum.y;
          const currentSizeZ = bb.maximum.z - bb.minimum.z;
          const currentMax = Math.max(currentSizeX, currentSizeY, currentSizeZ, 1e-6);
          const scaleFactor = shapeSize / currentMax;
          shapeModel.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor);
          try { console.log('SHAPE_SCALE_DEBUG', label, 'currentMax=', currentMax, 'scaleFactor=', scaleFactor); } catch (e) {}
        } else {
          // fallback to absolute scaling if bounding info unavailable
          shapeModel.scaling = new Vector3(shapeSize, shapeSize, shapeSize);
          try { console.log('SHAPE_SCALE_DEBUG', label, 'fallback scale to', shapeSize); } catch (e) {}
        }
        try { if ((shapeModel as any).bakeCurrentTransformIntoVertices) { (shapeModel as any).bakeCurrentTransformIntoVertices(); shapeModel.scaling = new Vector3(1,1,1); } } catch (e) {}
        try { shapeModel.refreshBoundingInfo(true); const bb2 = shapeModel.getBoundingInfo().boundingBox; const sizeX2 = bb2.maximum.x - bb2.minimum.x; const sizeY2 = bb2.maximum.y - bb2.minimum.y; const sizeZ2 = bb2.maximum.z - bb2.minimum.z; try { console.log('SHAPE_SCALE_DEBUG_POST', label, 'postSize=', { x: sizeX2, y: sizeY2, z: sizeZ2 }); } catch (e) {} } catch (e) {}
      } catch (e) {}

      shapeModel.parent = menuBox;
      shapeModel.position = new Vector3(xOffset, yOffset, zOffset);
      try {
        const labelTex = new DynamicTexture(label + "-label-tex", { width: 256, height: 64 }, scene, false);
        labelTex.hasAlpha = true;
        labelTex.drawText(label, null, 40, "bold 20px Arial", "#FFFFFF", "transparent", true);
        const labelMat = new StandardMaterial(label + "-label-mat", scene);
        labelMat.diffuseTexture = labelTex;
        labelMat.specularColor = Color3.Black();
        labelMat.emissiveColor = Color3.White();
        const labelPlane = MeshBuilder.CreatePlane(label + "-label", { width: shapeSize * 1.6, height: shapeSize * 0.6 }, scene);
        labelPlane.parent = menuBox;
        labelPlane.position = new Vector3(xOffset, yOffset - shapeSize * 0.9, zOffset + 0.002);
        labelPlane.material = labelMat;
        labelPlane.isPickable = false;
        labelPlane.isVisible = false;  // hidden along with shapes
      } catch (e) {}

      // pointer pick -> call onPick with spawn position computed near parent camera
      try {
        shapeModel.actionManager = new ActionManager(scene);
        shapeModel.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
          try { console.log('menu pick (pointer):', shape); } catch (e) {}
          try {
            let spawnPos: Vector3 | null = null;
            try {
              const cam = parentCamera as any;
              if (cam && cam.getForwardRay) {
                const dir = cam.getForwardRay(1).direction as Vector3;
                const pos = cam.getAbsolutePosition ? cam.getAbsolutePosition() as Vector3 : new Vector3(0, 1, 0);
                spawnPos = pos.add(dir.scale(0.4));
              } else if (cam && cam.getAbsolutePosition) {
                const pos = cam.getAbsolutePosition() as Vector3;
                spawnPos = pos.add(new Vector3(0, 0, -0.4));
              } else spawnPos = new Vector3(0, 1, -0.6);
            } catch (e) { spawnPos = new Vector3(0, 1, -0.6); }
            if (onPick) onPick(shape, spawnPos || undefined, typeof shapeSize === 'number' ? shapeSize : undefined);
          } catch (e) {}
        }));
      } catch (e) {}

      shapeModels.push({ mesh: shapeModel, shapeType: shape });
      try { console.log('placed shape', label, { x: xOffset, y: yOffset, z: zOffset }); } catch (e) {}
    }
  };

  try {
    console.log('palette shapes count', shapesList.length, 'grid', `${cols}x${rows}x${layers}`);
  } catch (e) {}

  const slotsPerLayer = cols * rows;
  for (let i = 0; i < shapesList.length; i++) {
    const layer = Math.floor(i / slotsPerLayer);
    const indexInLayer = i % slotsPerLayer;
    const row = Math.floor(indexInLayer / cols);
    const col = indexInLayer % cols;
    const s = shapesList[i];
    createPaletteShape(s.label, s.shape, s.color, row, col, layer);
  }

  try {
    // expose to global debug object for inspection from browser console
    (window as any).__MENU_DEBUG = (window as any).__MENU_DEBUG || {};
    (window as any).__MENU_DEBUG.menu = menuBox;
    (window as any).__MENU_DEBUG.shapeModels = shapeModels;
    try { console.log('MENU_DEBUG.models', (window as any).__MENU_DEBUG.shapeModels.map((m: any) => m.mesh.name)); } catch (e) {}
  } catch (e) {}

  return { menu: menuBox as AbstractMesh, shapeModels };
}
