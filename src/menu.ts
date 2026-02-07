import * as GUI from "@babylonjs/gui";
import { Mesh, Scene, TransformNode, AbstractMesh } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type ShapeType = "box" | "sphere" | "cylinder" | "torus";

export default function createFloatingMenu(parentCamera: TransformNode, scene: Scene, onPick: (shape: ShapeType) => void) {
  const menuPlane = Mesh.CreatePlane("menuPlane", 1, scene);
  menuPlane.scaling = new Vector3(0.35, 0.55, 1);
  menuPlane.parent = parentCamera;
  menuPlane.position = new Vector3(0, -0.25, 0.6);
  menuPlane.rotation.x = 0;

  const adt = GUI.AdvancedDynamicTexture.CreateForMesh(menuPlane, 512, 512);
  const panel = new GUI.StackPanel();
  panel.width = "220px";
  panel.isVertical = true;
  panel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  panel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  adt.addControl(panel);

  function addButton(name: string, shape: ShapeType) {
    const btn = GUI.Button.CreateSimpleButton(name, name);
    btn.width = "200px";
    btn.height = "60px";
    btn.color = "white";
    btn.background = "#333";
    btn.onPointerUpObservable.add(() => onPick(shape));
    panel.addControl(btn);
  }

  addButton("Box", "box");
  addButton("Sphere", "sphere");
  addButton("Cylinder", "cylinder");
  addButton("Torus", "torus");

  return menuPlane as AbstractMesh;
}
