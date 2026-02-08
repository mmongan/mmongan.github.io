import { MeshBuilder, Scene, TransformNode, AbstractMesh, StandardMaterial, Color3, DynamicTexture } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type ShapeType = "tetrahedron" | "cube" | "octahedron" | "dodecahedron" | "icosahedron";

export interface MenuShapeModel {
  mesh: AbstractMesh;
  shapeType: ShapeType;
}

export interface MenuHandle {
  mesh: AbstractMesh;
  isHandle: true;
}

export default async function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (s: ShapeType) => void): Promise<{ menu: AbstractMesh; shapeModels: MenuShapeModel[]; handles: MenuHandle[] }> {
  // menu visual
  const menuBox = MeshBuilder.CreateBox("menuBox", { width: 0.55, height: 0.35, depth: 0.02 }, scene);
  // position higher and in front (local-floor reference: Y is height above floor)
  menuBox.position = new Vector3(0, 1.0, -0.5);
  // rotate to face the user
  menuBox.rotation.x = 0;
  menuBox.rotation.y = 0;

  // edges disabled for cleaner look

  const shapeModels: MenuShapeModel[] = [];
  const handles: MenuHandle[] = [];

  // Create an invisible edge/border zone for grabbing (parented to menu, larger than menu to catch edges)
  const edgeZone = MeshBuilder.CreateBox("edgeZone", { width: 0.65, height: 0.45, depth: 0.02 }, scene);
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
  const leftHandle = MeshBuilder.CreateCylinder("leftHandle", { height: 0.35, diameter: 0.02 }, scene);
  leftHandle.parent = menuBox;
  leftHandle.position = new Vector3(-0.285, 0, 0.015);
  leftHandle.material = handleMaterial;
  handles.push({ mesh: leftHandle, isHandle: true });

  // Right handle
  const rightHandle = MeshBuilder.CreateCylinder("rightHandle", { height: 0.35, diameter: 0.02 }, scene);
  rightHandle.parent = menuBox;
  rightHandle.position = new Vector3(0.285, 0, 0.015);
  rightHandle.material = handleMaterial;
  handles.push({ mesh: rightHandle, isHandle: true });

  // Top handle
  const topHandle = MeshBuilder.CreateCylinder("topHandle", { height: 0.55, diameter: 0.02 }, scene);
  topHandle.parent = menuBox;
  topHandle.position = new Vector3(0, 0.175, 0.015);
  topHandle.rotation.z = Math.PI / 2;
  topHandle.material = handleMaterial;
  handles.push({ mesh: topHandle, isHandle: true });

  // Bottom handle
  const bottomHandle = MeshBuilder.CreateCylinder("bottomHandle", { height: 0.55, diameter: 0.02 }, scene);
  bottomHandle.parent = menuBox;
  bottomHandle.position = new Vector3(0, -0.175, 0.015);
  bottomHandle.rotation.z = Math.PI / 2;
  bottomHandle.material = handleMaterial;
  handles.push({ mesh: bottomHandle, isHandle: true });

  // Create shape models positioned around the menu, parented to menu so they move together
  const createPaletteShape = (label: string, shape: ShapeType, color: string, gridRow: number, gridCol: number) => {
    // calculate position relative to menu (3-column grid)
    const xOffset = (gridCol - 1) * 0.18; // -0.18, 0, 0.18 for cols 0, 1, 2
    const yOffset = gridRow === 0 ? 0.08 : -0.08; // top row or bottom row
    const zOffset = -0.015;
    
    const shapeSize = 0.04; // small size for palette
    let shapeModel: AbstractMesh | null = null;
    
    switch (shape) {
      case "tetrahedron":
        shapeModel = MeshBuilder.CreatePolyhedron(label + "-shape", { type: 0, size: shapeSize }, scene);
        break;
      case "cube":
        shapeModel = MeshBuilder.CreateBox(label + "-shape", { size: shapeSize }, scene);
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

  createPaletteShape("Tetrahedron", "tetrahedron", "#FF6B6B", 0, 0);
  createPaletteShape("Cube", "cube", "#4ECDC4", 1, 0);
  createPaletteShape("Octahedron", "octahedron", "#45B7D1", 0, 1);
  createPaletteShape("Dodecahedron", "dodecahedron", "#FFA07A", 1, 1);
  createPaletteShape("Icosahedron", "icosahedron", "#98D8C8", 2, 0);

  return { menu: menuBox as AbstractMesh, shapeModels, handles };
}
