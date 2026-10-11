export interface EditCommand {
  undo: () => void;
  redo: () => void;
  dispose?: () => void;
}

export class EditHistory {
  private undoStack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];
  isApplying = false;

  constructor(private readonly changed: () => void, private readonly limit = 100) {}

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  record(command: EditCommand) {
    if (this.isApplying) return;
    this.redoStack.splice(0).forEach((entry) => entry.dispose?.());
    this.undoStack.push(command);
    while (this.undoStack.length > this.limit) this.undoStack.shift()!.dispose?.();
    this.changed();
  }

  undo() { this.apply(this.undoStack, this.redoStack, "undo"); }
  redo() { this.apply(this.redoStack, this.undoStack, "redo"); }

  clear() {
    if (this.isApplying) return;
    [...this.undoStack, ...this.redoStack].forEach((entry) => entry.dispose?.());
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.changed();
  }

  private apply(from: EditCommand[], to: EditCommand[], action: "undo" | "redo") {
    const command = from[from.length - 1];
    if (!command) return;
    this.isApplying = true;
    try {
      command[action]();
      from.pop();
      to.push(command);
    } finally {
      this.isApplying = false;
      this.changed();
    }
  }
}
