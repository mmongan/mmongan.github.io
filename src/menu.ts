import * as GUI from "@babylonjs/gui";
import { MeshBuilder, Mesh, Scene, TransformNode, AbstractMesh } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type ShapeType = "box" | "sphere" | "cylinder" | "torus";

export default function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (shape: ShapeType) => void) {
  const menuPlane = MeshBuilder.CreatePlane("menuPlane", { size: 1 }, scene);
  menuPlane.scaling = new Vector3(0.45, 0.45, 1);
  menuPlane.parent = parentCamera;
  menuPlane.position = new Vector3(0.35, -0.25, 0.6);
  menuPlane.rotation.x = 0;

  const adt = GUI.AdvancedDynamicTexture.CreateForMesh(menuPlane, 512, 512, false);

  // Background plate
  const plate = new GUI.Rectangle("plate");
  plate.width = "260px";
  plate.height = "260px";
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
    txt.top = "8px";
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

  // small subtle shadow using a semi-transparent plane behind (mesh-level)
  const shadowPlane = MeshBuilder.CreatePlane("menuShadow", { size: 1.05 }, scene);
  shadowPlane.parent = parentCamera;
  shadowPlane.position = new Vector3(0.35, -0.25, 0.595);
  shadowPlane.rotation.x = 0;
  const shadowAdt = GUI.AdvancedDynamicTexture.CreateForMesh(shadowPlane, 256, 256, false);
  const shadowRect = new GUI.Rectangle("shadowRect");
  shadowRect.width = "260px";
  shadowRect.height = "260px";
  shadowRect.cornerRadius = 22;
  shadowRect.background = "rgba(0,0,0,0.25)";
  shadowRect.thickness = 0;
  shadowAdt.addControl(shadowRect);

  return menuPlane as AbstractMesh;
}
