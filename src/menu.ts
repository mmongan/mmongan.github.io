import { MeshBuilder, Scene, TransformNode, AbstractMesh, StandardMaterial, Color3, DynamicTexture } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type ShapeType = "tetrahedron" | "cube" | "octahedron" | "dodecahedron" | "icosahedron" | "sphere" | "poly0" | "poly1" | "poly2" | "poly3" | "poly4" | "poly5" | "poly6" | "poly7" | "poly8" | "poly9" | "poly10" | "poly11" | "poly12" | "poly13" | "poly14";

export interface MenuShapeModel {
  mesh: AbstractMesh;
  shapeType: ShapeType;
}

export interface MenuHandle {
  mesh: AbstractMesh;
  isHandle: true;
}

export default async function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (s: ShapeType) => void): Promise<{ menu: AbstractMesh; shapeModels: MenuShapeModel[]; handles: MenuHandle[] }> {
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
  const handles: MenuHandle[] = [];

  // Create an invisible edge/border zone for grabbing (parented to menu, larger than menu to catch edges)
  const edgeZone = MeshBuilder.CreateBox("edgeZone", { width: menuWidth + (menuPadding * 2), height: menuHeight + (menuPadding * 2), depth: menuDepth }, scene);
  edgeZone.parent = menuBox;
  edgeZone.position = new Vector3(0, 0, 0);
  edgeZone.isVisible = false;
  edgeZone.isPickable = false;
  handles.push({ mesh: edgeZone, isHandle: true });

  // Create visible handles on the edges of the menu (parented to menu)
  const handleMaterial = new StandardMaterial("handleMat", scene);
  handleMaterial.diffuseColor = Color3.FromHexString("#555555");
  handleMaterial.alpha = 0.7;

  // Left handle
  const leftHandle = MeshBuilder.CreateCylinder("leftHandle", { height: menuHeight, diameter: 0.02 }, scene);
  leftHandle.parent = menuBox;
  leftHandle.position = new Vector3(-menuWidth / 2 - 0.02, 0, 0.015);
  leftHandle.material = handleMaterial;
  handles.push({ mesh: leftHandle, isHandle: true });

  // Right handle
  const rightHandle = MeshBuilder.CreateCylinder("rightHandle", { height: menuHeight, diameter: 0.02 }, scene);
  rightHandle.parent = menuBox;
  rightHandle.position = new Vector3(menuWidth / 2 + 0.02, 0, 0.015);
  rightHandle.material = handleMaterial;
  handles.push({ mesh: rightHandle, isHandle: true });

  // Top handle
  const topHandle = MeshBuilder.CreateCylinder("topHandle", { height: menuWidth, diameter: 0.02 }, scene);
  topHandle.parent = menuBox;
  topHandle.position = new Vector3(0, menuHeight / 2 + 0.02, 0.015);
  topHandle.rotation.z = Math.PI / 2;
  topHandle.material = handleMaterial;
  handles.push({ mesh: topHandle, isHandle: true });

  // Bottom handle
  const bottomHandle = MeshBuilder.CreateCylinder("bottomHandle", { height: menuWidth, diameter: 0.02 }, scene);
  bottomHandle.parent = menuBox;
  bottomHandle.position = new Vector3(0, -menuHeight / 2 - 0.02, 0.015);
  bottomHandle.rotation.z = Math.PI / 2;
  bottomHandle.material = handleMaterial;
  handles.push({ mesh: bottomHandle, isHandle: true });

  // Corner connectors: small decorative spheres at each corner to visually link edges
  const cornerSize = 0.03;
  const halfW = menuWidth / 2;
  const halfH = menuHeight / 2;
  const cornerZ = 0.015; // slightly in front of the menu surface to avoid z-fighting
  const cornerPositions = [
    new Vector3(-halfW, halfH, cornerZ),  // top-left
    new Vector3(halfW, halfH, cornerZ),   // top-right
    new Vector3(-halfW, -halfH, cornerZ), // bottom-left
    new Vector3(halfW, -halfH, cornerZ)   // bottom-right
  ];
  cornerPositions.forEach((pos, idx) => {
    const sphere = MeshBuilder.CreateSphere(`cornerSphere${idx}`, { diameter: cornerSize }, scene);
    sphere.parent = menuBox;
    sphere.position = pos;
    sphere.material = handleMaterial;
    // decorative only: do not allow these spheres to be pickable
    sphere.isPickable = false;
  });

  // Create shape models positioned around the menu, parented to menu so they move together
  const cols = 6;
  const rows = 3;
  // compute spacing inside an inner rect (respect padding) so shapes fit comfortably
  const innerWidth = menuWidth - menuPadding * 2;
  const innerHeight = menuHeight - menuPadding * 2;
  const xSpacing = innerWidth / (cols - 1);
  const ySpacing = innerHeight / (rows - 1);
  const zOffset = menuDepth + 0.03; // slightly in front of menu surface
  const shapeSize = 0.06; // smaller to ensure fit and avoid clipping

  const createPaletteShape = (label: string, shape: ShapeType, color: string, gridRow: number, gridCol: number) => {
    const xOffset = -innerWidth / 2 + gridCol * xSpacing;
    const yOffset = innerHeight / 2 - gridRow * ySpacing;

    let shapeModel: AbstractMesh | null = null;

    if (shape === 'sphere') {
      shapeModel = MeshBuilder.CreateSphere(label + "-shape", { diameter: shapeSize }, scene);
    } else if (shape === 'cube') {
      shapeModel = MeshBuilder.CreateBox(label + "-shape", { size: shapeSize }, scene);
    } else if ((shape as string).startsWith('poly')) {
      const idx = parseInt((shape as string).replace('poly', ''), 10);
      shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: idx, size: shapeSize }, scene);
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

    if (shapeModel) {
      const mat = new StandardMaterial(label + "-mat", scene);
      mat.diffuseColor = Color3.FromHexString(color);
      shapeModel.material = mat;
      shapeModel.isVisible = true;

      // Parent to menu so it moves with the menu
      shapeModel.parent = menuBox;
      shapeModel.position = new Vector3(xOffset, yOffset, zOffset);

      // Track this shape model for grabbing
      shapeModels.push({ mesh: shapeModel, shapeType: shape });
    }
  };

  // build shapes list: poly0..poly14 + sphere + cube
  const paletteColors = ['#98D8C8','#FF6B6B','#45B7D1','#FFA07A','#F6C9E2','#D4A5FF','#FFB86B','#B0E57C','#9AD0FF','#E3E66D','#C0C0C0','#FF9FB4','#8FD3C7','#D9B8FF','#FFD7A6'];
  const shapesList: Array<{label:string, shape:ShapeType, color:string}> = [];
  for (let i = 0; i < 15; i++) {
    shapesList.push({ label: `Poly${i}`, shape: (`poly${i}` as ShapeType), color: paletteColors[i % paletteColors.length] });
  }
  shapesList.push({ label: 'Sphere', shape: 'sphere', color: '#FFD166' });
  shapesList.push({ label: 'Cube', shape: 'cube', color: '#4ECDC4' });

  // place into grid
  for (let i = 0; i < shapesList.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const s = shapesList[i];
    createPaletteShape(s.label, s.shape, s.color, row, col);
  }

  return { menu: menuBox as AbstractMesh, shapeModels, handles };
}
