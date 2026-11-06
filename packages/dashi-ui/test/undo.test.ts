import { expect, test } from "bun:test";
import { redoLabel, UndoStack, undoLabel, undoMenuItems } from "../src/undo.ts";

/** A name that Undo and Redo change back and forth, as a rename does. */
function renamer(stack: UndoStack, log: string[]) {
  let name = "a.txt";
  const rename = (to: string) => {
    const from = name;
    name = to;
    stack.push({ name: "Rename", do: () => void (name = to), undo: () => void (name = from) });
  };
  return { rename, now: () => name, log };
}

test("Undo takes the newest action back and Redo does it again, naming it", async () => {
  const stack = new UndoStack();
  const file = renamer(stack, []);
  expect(stack.state).toMatchObject({ canUndo: false, canRedo: false, undoName: null });
  file.rename("b.txt");
  expect(stack.state).toMatchObject({ canUndo: true, undoName: "Rename", canRedo: false });
  expect(await stack.undo()).toBe(true);
  expect(file.now()).toBe("a.txt");
  expect(stack.state).toMatchObject({ canUndo: false, canRedo: true, redoName: "Rename" });
  expect(await stack.redo()).toBe(true);
  expect(file.now()).toBe("b.txt");
  expect(await stack.redo()).toBe(false);
});

test("a new action drops what could be redone", async () => {
  const stack = new UndoStack();
  const file = renamer(stack, []);
  file.rename("b.txt");
  await stack.undo();
  file.rename("c.txt");
  expect(stack.state.canRedo).toBe(false);
  await stack.undo();
  expect(file.now()).toBe("a.txt");
});

test("the stack keeps only the newest steps", async () => {
  const stack = new UndoStack(2);
  const file = renamer(stack, []);
  file.rename("b");
  file.rename("c");
  file.rename("d");
  expect(await stack.undo()).toBe(true);
  expect(await stack.undo()).toBe(true);
  expect(await stack.undo()).toBe(false);
  expect(file.now()).toBe("b");
});

test("a group is one step, undone in reverse and redone in order", async () => {
  const stack = new UndoStack();
  const log: string[] = [];
  const act = (id: string) => stack.push({ name: "Move to Trash", do: () => void log.push(`do ${id}`), undo: () => void log.push(`undo ${id}`) });
  stack.group("Move to Trash", () => {
    act("1");
    // Groups nest into the outermost.
    stack.group("ignored", () => act("2"));
    act("3");
  });
  expect(stack.state.undoName).toBe("Move to Trash");
  await stack.undo();
  expect(log).toEqual(["undo 3", "undo 2", "undo 1"]);
  expect(stack.state.canUndo).toBe(false);
  await stack.redo();
  expect(log.slice(3)).toEqual(["do 1", "do 2", "do 3"]);
});

test("an async group ends when it settles; an empty one leaves no step", async () => {
  const stack = new UndoStack();
  await stack.group("New Folder", async () => {
    await Promise.resolve();
    stack.push({ name: "x", do: () => {}, undo: () => {} });
  });
  expect(stack.state).toMatchObject({ canUndo: true, undoName: "New Folder" });
  stack.group("Nothing", () => {});
  expect(stack.state.undoName).toBe("New Folder");
});

test("an undo that runs the recording code records nothing; one at a time", async () => {
  const stack = new UndoStack();
  const file = renamer(stack, []);
  file.rename("b.txt");
  let release = () => {};
  stack.push({
    name: "Slow",
    do: () => {},
    undo: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const first = stack.undo();
  expect(stack.state.busy).toBe(true);
  expect(await stack.undo()).toBe(false);
  // What the app records while an undo runs is not a new step.
  stack.push({ name: "Rename", do: () => {}, undo: () => {} });
  release();
  expect(await first).toBe(true);
  expect(stack.state).toMatchObject({ busy: false, undoName: "Rename", redoName: "Slow" });
});

test("a step whose undo fails is dropped, and the failure reaches the caller", async () => {
  const stack = new UndoStack();
  stack.push({ name: "Rename", do: () => {}, undo: () => {} });
  stack.push({
    name: "Move",
    do: () => {},
    undo: () => {
      throw new Error("gone");
    },
  });
  await expect(stack.undo()).rejects.toThrow("gone");
  expect(stack.state).toMatchObject({ undoName: "Rename", canRedo: false, busy: false });
});

test("the menu rows name the step and take the standard keys", () => {
  expect(undoLabel("Rename")).toBe("Undo Rename");
  expect(redoLabel(null)).toBe("Redo");
  const stack = new UndoStack();
  expect(undoMenuItems(stack.state)).toEqual([
    { id: "undo", label: "Undo", shortcut: "❖Z", enabled: false },
    { id: "redo", label: "Redo", shortcut: "⇧❖Z", enabled: false },
  ]);
  stack.push({ name: "Rename", do: () => {}, undo: () => {} });
  expect(undoMenuItems(stack.state)[0]).toEqual({ id: "undo", label: "Undo Rename", shortcut: "❖Z", enabled: true });
});

test("a setting changed again soon joins its step: one Undo goes back to where it started", async () => {
  let at = 0;
  const stack = new UndoStack(100, () => at);
  let value = 10;
  const set = (to: number) => {
    const from = value;
    value = to;
    stack.push({ name: "Text Size", joins: "appearance.textSize", do: () => void (value = to), undo: () => void (value = from) });
  };
  set(11);
  at += 400;
  set(12);
  at += 400;
  set(13);
  expect(stack.state.undoName).toBe("Text Size");
  await stack.undo();
  expect(value).toBe(10);
  expect(stack.state.canUndo).toBe(false);
  await stack.redo();
  expect(value).toBe(13);
  // Later, or once it was undone and redone, it is a step of its own.
  at += 5000;
  set(14);
  await stack.undo();
  expect(value).toBe(13);
});
