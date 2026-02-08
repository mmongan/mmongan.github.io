import { MeshBuilder, Mesh, Scene, TransformNode, AbstractMesh } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type ShapeType = "box" | "sphere" | "cylinder" | "torus";

export default async function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (shape: ShapeType) => void): Promise<AbstractMesh> {
  const GUI: any = await import("@babylonjs/gui");

  // create a thin rectangular box so the menu is a 3D object
  const menuBox = MeshBuilder.CreateBox("menuBox", { width: 0.34, height: 0.24, depth: 0.02 }, scene);
  // Do not parent to the camera — create at an initial world position in front of the provided camera transform.
  try {
    const camPos = parentCamera.getAbsolutePosition();
    menuBox.position = camPos.add(new Vector3(0.35, -0.25, 0.6));
  } catch (e) {
    // fallback to local offset if absolute position isn't available yet
    menuBox.position = new Vector3(0.35, -0.25, 0.6);
  }
  menuBox.rotation.x = 0;

  const adt = GUI.AdvancedDynamicTexture.CreateForMesh(menuBox, 1024, 512, false);

  // Background plate
  const plate = new GUI.Rectangle("plate");
  plate.width = "320px";
  plate.height = "220px";
  plate.cornerRadius = 20;
  plate.background = "rgba(20,20,20,0.6)";
  plate.thickness = 0;
  plate.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  plate.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  adt.addControl(plate);

  // Grid layout (2x2) for palette buttons
  const grid = new GUI.Grid();
  grid.addColumnDefinition(0.5);
  grid.addColumnDefinition(0.5);
  grid.addRowDefinition(0.5);
  grid.addRowDefinition(0.5);
  grid.width = "100%";
  grid.height = "100%";
  plate.addControl(grid);

  function makePaletteButton(label: string, shape: ShapeType, color: string) {
    const btn = GUI.Button.CreateSimpleButton(label + "-btn", "");
    btn.width = "100%";
    btn.height = "100%";
    btn.color = "white";
    btn.background = "transparent";
    btn.thickness = 0;
    btn.onPointerUpObservable.add(() => onPick(shape));

    const circle = new GUI.Ellipse();
    circle.width = "75%";
    circle.height = "75%";
    circle.color = "transparent";
    circle.background = color;
    circle.thickness = 0;
    btn.addControl(circle);

    const txt = new GUI.TextBlock();
    txt.text = label;
    txt.color = "white";
    txt.fontSize = 14;
    txt.marginTop = 8;
    circle.addControl(txt);

    return btn;
  }

  const btnBox = makePaletteButton("Box", "box", "#4CAF50");
  const btnSphere = makePaletteButton("Sphere", "sphere", "#2196F3");
  const btnCyl = makePaletteButton("Cylinder", "cylinder", "#FF9800");
  const btnTorus = makePaletteButton("Torus", "torus", "#9C27B0");

  grid.addControl(btnBox, 0, 0);
  grid.addControl(btnSphere, 0, 1);
  grid.addControl(btnCyl, 1, 0);
  grid.addControl(btnTorus, 1, 1);

  // small subtle shadow using a slightly larger, very thin box behind
  const shadowBox = MeshBuilder.CreateBox("menuShadow", { width: 0.36, height: 0.26, depth: 0.018 }, scene);
  // make the shadow a child of the menu box so it moves with the menu when unparented
  shadowBox.parent = menuBox;
  // position slightly behind the menu box in local space
  shadowBox.position = new Vector3(0, 0, -0.011);
  shadowBox.rotation.x = 0;
  const shadowAdt = GUI.AdvancedDynamicTexture.CreateForMesh(shadowBox, 512, 256, false);
  const shadowRect = new GUI.Rectangle("shadowRect");
  shadowRect.width = "320px";
  shadowRect.height = "220px";
  shadowRect.cornerRadius = 22;
  shadowRect.background = "rgba(0,0,0,0.25)";
  shadowRect.thickness = 0;
  shadowAdt.addControl(shadowRect);

  return menuBox as AbstractMesh;
}
