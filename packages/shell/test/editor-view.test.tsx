import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@mirinjs/metal";
import { EditorModel } from "../apps/editor/lib/model.ts";
import { DEFAULT_PREFS } from "../apps/editor/lib/prefs.ts";
import { EditorWindow } from "../apps/editor/lib/views/view.tsx";
import { fakeHost, press, scratchHome } from "./support/editor-view.ts";
import { fakeClockEachTest, settle, shows, until } from "./support/time.ts";

fakeClockEachTest();

const scratch = scratchHome();

test("an Untitled document is a draft, counted once typing pauses; the Save sheet saves it", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const quits: boolean[] = [];
  const root = render(
    <EditorWindow
      model={model}
      quit={(discard) => quits.push(discard)}
      newWindow={() => {}}
      press={() => {}}
      scroll={() => {}}
      focusText={() => {}}
      setTitle={() => {}}
    />,
    host.transport,
  );
  // Dashi's unified title bar: the toolbar shows the document's name.
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  await settle();
  expect(host.trees.at(-1)).toContain("Untitled");

  const text = root.nodeId("text");
  if (!text) throw new Error("no text input");
  host.emit({ type: "change", nodeId: text, value: "hello there" });
  await settle();
  expect(model.getSnapshot().text).toBe("hello there");
  // The title row keeps the name and "Draft"; the counts wait in the chip at the text's foot (review 54).
  expect(host.trees.at(-1)).toContain(' — Draft"');
  expect(host.trees.at(-1)).toContain("1 line · 0 words");
  expect(root.nodeId("counts")).toBeDefined();
  // The chip ends on the toolbar's right edge (paddingRight 12), under Find.
  expect(host.trees.at(-1)).toMatch(new RegExp(`"id":"${root.nodeId("counts")}"[^}]*"absolute":true,"right":12,`));
  expect(host.trees.at(-1)).toContain('"paddingRight":12,"borderBottom":1,"height":38');
  await settle(350);
  expect(host.trees.at(-1)).toContain("1 line · 2 words");

  // Save on an Untitled document asks where: Files' chooser, in the home folder, the name ready.
  host.emit({ type: "press", nodeId: root.nodeId("save") as string });
  await settle(80);
  const field = root.nodeId("chooser:name");
  if (!field) throw new Error("no Save As chooser");
  expect(host.trees.at(-1)).toContain("Untitled.txt");
  const path = join(scratch.dir, "Documents", "hello.txt");
  host.emit({ type: "change", nodeId: field, value: "hello.txt" });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: "hello.txt" });
  await settle();
  expect(readFileSync(path, "utf8")).toBe("hello there");
  expect(host.trees.at(-1)).toContain("hello.txt");
  expect(host.trees.at(-1)).not.toContain("Draft");
  expect(root.nodeId("chooser:name")).toBeUndefined();
  root.unmount();
});

test("Save As asks before replacing another file, with Replace in ume", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const existing = join(scratch.dir, "Documents", "taken.txt");
  writeFileSync(existing, "keep me");
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => {}} setTitle={() => {}} />,
    host.transport,
  );
  await settle();
  model.edit("new text");
  await settle();
  host.emit({ type: "press", nodeId: root.nodeId("save") as string });
  const field = await shows(root, "chooser:name");
  host.emit({ type: "change", nodeId: field, value: "taken.txt" });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: "taken.txt" });
  await until(() => host.trees.at(-1)?.includes("already exists") ?? false, "the replace question");
  expect(readFileSync(existing, "utf8")).toBe("keep me");
  host.emit(press(root.nodeId("chooser:replace:ok") as string));
  await until(() => readFileSync(existing, "utf8") === "new text", "the file to be replaced");
  root.unmount();
});

test("Open takes an untouched window's place, and opens another window otherwise", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const opened: (readonly string[])[] = [];
  const first = join(scratch.dir, "first.txt");
  const second = join(scratch.dir, "second.txt");
  writeFileSync(first, "one");
  writeFileSync(second, "two");
  const root = render(
    <EditorWindow
      model={model}
      quit={() => {}}
      newWindow={(files) => opened.push(files)}
      press={() => {}}
      scroll={() => {}}
      focusText={() => {}}
      setTitle={() => {}}
    />,
    host.transport,
  );
  await settle();
  // Open is Files' chooser: Home in its sidebar, the file's icon, then Open.
  const openWith = async (path: string): Promise<void> => {
    host.emit({ type: "press", nodeId: root.nodeId("open") as string });
    host.emit(press(await shows(root, "place:home")));
    host.emit(press(await shows(root, `item:${path}`)));
    host.emit(press(await shows(root, "chooser:accept")));
    await until(() => root.nodeId("chooser:accept") === undefined && (model.getSnapshot().path === path || opened.length > 0), "the file to open");
  };
  host.emit({ type: "press", nodeId: root.nodeId("open") as string });
  host.emit(press(await shows(root, "chooser:cancel")));
  await settle();
  expect(root.nodeId("chooser:cancel")).toBeUndefined();

  await openWith(first);
  expect(model.getSnapshot()).toMatchObject({ path: first, text: "one" });
  expect(opened).toEqual([]);
  await openWith(second);
  expect(model.getSnapshot().path).toBe(first);
  expect(opened).toEqual([[second]]);
  root.unmount();
});
