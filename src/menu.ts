import { MeshBuilder, Scene, TransformNode, AbstractMesh, StandardMaterial, Color3, DynamicTexture, ActionManager, ExecuteCodeAction } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Build marker to help identify built bundles
const MENU_BUILD_MARKER = "MENU_BUILD_MARKER_v2026_02_08_1";

export type ShapeType = "tetrahedron" | "cube" | "octahedron" | "dodecahedron" | "icosahedron" | "sphere" | "poly0" | "poly1" | "poly2" | "poly3" | "poly4" | "poly5" | "poly6" | "poly7" | "poly8" | "poly9" | "poly10" | "poly11" | "poly12" | "poly13" | "poly14";

export interface MenuShapeModel {
  mesh: AbstractMesh;
  shapeType: ShapeType;
}

export default async function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (s: ShapeType) => void): Promise<{ menu: AbstractMesh; shapeModels: MenuShapeModel[] }> {
  // menu visual - expanded to fit full palette with internal padding
  const menuWidth = 1.8;
  const menuHeight = 1.0;
  const menuDepth = 0.02;
  const menuPadding = 0.06; // meters of padding so palette shapes don't sit on the edge
  const menuBox = MeshBuilder.CreateBox("menuBox", { width: menuWidth, height: menuHeight, depth: menuDepth }, scene);
  // position higher and further in front (local-floor reference: Y is height above floor)
  // moved back to -1.0m on Z so the menu appears 1 meter in front of the user
  menuBox.position = new Vector3(0, 1.0, -1.0);
  // rotate to face the user
  menuBox.rotation.x = 0;
  menuBox.rotation.y = 0;

  // Create material for menu box with transparency
  const menuMaterial = new StandardMaterial("menuBoxMat", scene);
  menuMaterial.diffuseColor = Color3.FromHexString("#E8E8E8");
  menuMaterial.alpha = 0.2; // highly transparent
  menuBox.material = menuMaterial;

  const shapeModels: MenuShapeModel[] = [];

  // Handles and corner connectors were removed; menu has no edge handles now.


  // Instrumentation: note that handles/corners have been removed
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


  // Create shape models positioned around the menu, parented to menu so they move together
  const cols = 6;
  // build shapes list: poly0..poly14 + sphere + cube (we'll compute rows dynamically)
  const paletteColors = ['#98D8C8','#FF6B6B','#45B7D1','#FFA07A','#F6C9E2','#D4A5FF','#FFB86B','#B0E57C','#9AD0FF','#E3E66D','#C0C0C0','#FF9FB4','#8FD3C7','#D9B8FF','#FFD7A6'];
  const shapesList: Array<{label:string, shape:ShapeType, color:string}> = [];
  for (let i = 0; i < 15; i++) {
    shapesList.push({ label: `Poly${i}`, shape: (`poly${i}` as ShapeType), color: paletteColors[i % paletteColors.length] });
  }
  shapesList.push({ label: 'Sphere', shape: 'sphere', color: '#FFD166' });
  shapesList.push({ label: 'Cube', shape: 'cube', color: '#4ECDC4' });

  const rows = Math.ceil(shapesList.length / cols);

  // compute spacing inside an inner rect (respect padding) so shapes fit comfortably
  const innerWidth = menuWidth - menuPadding * 2;
  const innerHeight = menuHeight - menuPadding * 2;
  const xSpacing = cols > 1 ? innerWidth / (cols - 1) : 0;
  const ySpacing = rows > 1 ? innerHeight / (rows - 1) : 0;
  const zOffset = menuDepth + 0.05; // slightly in front of menu surface (a bit larger)
  // choose shape size to fit spacing but make shapes more visible
  const maxShape = Math.min(0.12, Math.min(xSpacing || 0.08, ySpacing || 0.08) * 0.6);
  const shapeSize = Math.max(0.05, maxShape);

  // Debug/version label: show build timestamp so we can confirm deployed code is running
  try {
    const MENU_DEBUG_MARKER = "MENU_DEBUG_TOKEN_v1";
    const debugText = `${MENU_DEBUG_MARKER} ${new Date().toISOString()}`;
    const tex = new DynamicTexture("menuDebugTex", { width: 512, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.getContext().font = "bold 36px Arial";
    tex.drawText(debugText, null, 40, "bold 28px Arial", "#FFFFFF", "transparent", true);

    const labelMat = new StandardMaterial("menuDebugMat", scene);
    labelMat.diffuseTexture = tex;
    labelMat.specularColor = Color3.Black();
    labelMat.emissiveColor = Color3.FromHexString("#FFFFFF");

    const labelWidth = Math.min(innerWidth * 0.9, 0.7);
    const labelHeight = 0.12;
    const labelPlane = MeshBuilder.CreatePlane("menuDebugPlane", { width: labelWidth, height: labelHeight }, scene);
    labelPlane.parent = menuBox;
    // place inside top-left padding
    labelPlane.position = new Vector3(-innerWidth / 2 + labelWidth / 2 + menuPadding, innerHeight / 2 - labelHeight / 2 - menuPadding, zOffset + 0.005);
    labelPlane.material = labelMat;
    labelPlane.isPickable = false;
  } catch (e) {
    // ignore debug label errors
  }

  const createPaletteShape = (label: string, shape: ShapeType, color: string, gridRow: number, gridCol: number) => {
    const xOffset = -innerWidth / 2 + gridCol * xSpacing;
    const yOffset = innerHeight / 2 - gridRow * ySpacing;

    let shapeModel: AbstractMesh | null = null;

    try {
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
          // fallback to box so the slot is visible
          shapeModel = MeshBuilder.CreateBox(label + "-shape", { size: shapeSize }, scene);
        }
      } else {
        // fallback to known named polyhedra for compatibility
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
      // ensure the mesh is visible and unique
      shapeModel.name = label + "-shape";
      const mat = new StandardMaterial(label + "-mat", scene);
      mat.diffuseColor = Color3.FromHexString(color);
      shapeModel.material = mat;
      shapeModel.isVisible = true;
      shapeModel.isPickable = true; // allow pointer interactions

      // Parent to menu so it moves with the menu
      shapeModel.parent = menuBox;
      shapeModel.position = new Vector3(xOffset, yOffset, zOffset);

      // add pick interaction only (hover highlight disabled)
      try {
        shapeModel.actionManager = new ActionManager(scene);
        shapeModel.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
          try { console.log('menu pick (pointer):', shape); } catch (e) {}
          try { onPick && onPick(shape); } catch (e) {}
        }));
      } catch (e) {}

      // Label: small plane under the shape showing its name
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
      } catch (e) {}

      // Track this shape model for grabbing
      shapeModels.push({ mesh: shapeModel, shapeType: shape });
    }
  };

  // debug: log final palette configuration
  try {
    console.log('palette shapes count', shapesList.length, 'cols', cols);
  } catch (e) {}

  // place into grid
  for (let i = 0; i < shapesList.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const s = shapesList[i];
    createPaletteShape(s.label, s.shape, s.color, row, col);
  }

  return { menu: menuBox as AbstractMesh, shapeModels };
} 
