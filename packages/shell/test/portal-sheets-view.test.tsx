import { expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { askOnScreen } from "../apps/portal/access.tsx";
import { ChooserModel, type Row, type Sources } from "../apps/portal/file-chooser/model.ts";
import { type ChooserAnswer, parseChooser } from "../apps/portal/file-chooser/options.ts";
import { ChooserView } from "../apps/portal/file-chooser/view.tsx";
import { printOnScreen } from "../apps/portal/print/sheet.tsx";
import type { ShowDialog } from "../apps/portal/windows.ts";

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

// The portal's sheets on a stand-in for the Metal host, with input sent back the way the host sends it.

const settle = (ms = 5): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface Mounted {
  root: NativeRoot;
  send: (event: NativeEvent) => void;
  node: (testID: string) => string;
}

function mount(element: ReactElement): Mounted {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(element, transport);
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const send = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { root, node, send };
}

/** A ShowDialog that mounts the sheet here and hands back its answer. */
function showHere(): { show: ShowDialog; mounted: () => Mounted } {
  let current: Mounted | null = null;
  const show: ShowDialog = <T,>(_window: unknown, build: (answer: (value: T) => void) => ReactElement) =>
    new Promise<T>((resolve) => {
      current = mount(build(resolve));
    });
  return {
    show,
    mounted: () => {
      if (!current) throw new Error("nothing shown");
      return current;
    },
  };
}

const row = (path: string, folder = false): Row => ({
  path,
  name: path.split("/").pop() ?? path,
  folder,
  mime: folder ? "inode/directory" : "application/pdf",
  mtime: 1,
  hidden: false,
});

const sources: Sources = {
  home: "/h",
  recents: async () => [],
  search: async () => [],
  folder: async (path) => ({ rows: path === "/h/Docs" ? [row("/h/Docs/Lease.pdf"), row("/h/Docs/Taxes", true)] : [], error: null }),
};

test("the chooser: a slow second click only selects; a real double-click opens; Up and Back move between folders", async () => {
  const request = parseChooser("open", ["org.example.App", "", "Open Lease", new Map()]);
  const model = new ChooserModel(request, sources, { folder: "/h/Docs", name: "" });
  model.go({ kind: "folder", path: "/h/Docs" });
  const answers: Array<ChooserAnswer | null> = [];
  const { root, node, send } = mount(
    <ChooserView model={model} places={[]} saveFolder="/h/Docs" exists={() => false} answer={(value) => answers.push(value)} />,
  );
  await settle();
  const down = (testID: string, x: number, y: number) => send({ type: "pointer", nodeId: node(testID), phase: "down", x, y });

  down("chooser:row:Lease.pdf", 200, 80);
  expect(model.getSnapshot().selected).toEqual(["/h/Docs/Lease.pdf"]);
  // Pressed again a second later (Date.now moves on): still only a click, nothing opens.
  await settle(450);
  down("chooser:row:Lease.pdf", 200, 80);
  expect(answers).toEqual([]);
  // Two presses far apart are two clicks, not a double-click.
  await settle(450);
  down("chooser:row:Lease.pdf", 200, 80);
  down("chooser:row:Lease.pdf", 260, 80);
  expect(answers).toEqual([]);
  // A real double-click opens it.
  await settle(450);
  down("chooser:row:Lease.pdf", 200, 80);
  down("chooser:row:Lease.pdf", 201, 81);
  expect(answers.map((answer) => answer?.paths)).toEqual([["/h/Docs/Lease.pdf"]]);

  // A folder's double-click goes in; Up comes back out, and Back retraces.
  await settle(450);
  down("chooser:row:Taxes", 200, 110);
  down("chooser:row:Taxes", 200, 110);
  await settle();
  expect(model.getSnapshot().place).toEqual({ kind: "folder", path: "/h/Docs/Taxes" });
  expect(root.lastTree()).toContain("Taxes");
  send({ type: "press", nodeId: node("chooser:up") });
  await settle();
  expect(model.getSnapshot().place).toEqual({ kind: "folder", path: "/h/Docs" });
  send({ type: "press", nodeId: node("chooser:back") });
  await settle();
  expect(model.getSnapshot().place).toEqual({ kind: "folder", path: "/h/Docs/Taxes" });

  // The folder pop-up lists the folders it is in; choosing one goes there.
  send({ type: "press", nodeId: node("chooser:folder"), bounds: { x: 300, y: 6, width: 120, height: 28 } });
  await settle();
  send({ type: "press", nodeId: node("chooser:folder:menu:Home") });
  await settle();
  expect(model.getSnapshot().place).toEqual({ kind: "folder", path: "/h" });
  root.unmount();
});

test("an access sheet: Enter never grants; Esc says no; only a click on Allow allows", async () => {
  const { show, mounted } = showHere();
  const ask = askOnScreen(show);
  const request = {
    appId: "org.example.Camera",
    parent: "",
    title: "Use the camera?",
    subtitle: "",
    body: "",
    grantLabel: "Allow",
    denyLabel: "Don’t Allow",
    icon: "camera-web-symbolic",
    choices: [],
  };
  let answer: unknown = "pending";
  void ask(request, new AbortController().signal).then((value) => {
    answer = value;
  });
  await settle();
  const sheet = mounted();
  // The line under the question names no Settings pane that doesn't exist.
  expect(sheet.root.lastTree()).not.toContain("Privacy");
  expect(sheet.root.lastTree()).toContain("Dashi remembers your answer");
  sheet.send(windowKey(sheet.node("portal:keys"), "enter"));
  await settle();
  expect(answer).toBe("pending");
  sheet.send({ type: "press", nodeId: sheet.node("access:grant") });
  await settle();
  expect(answer).toEqual({ granted: true, choices: [] });

  const again = showHere();
  let second: unknown = "pending";
  void askOnScreen(again.show)(request, new AbortController().signal).then((value) => {
    second = value;
  });
  await settle();
  again.mounted().send(windowKey(again.mounted().node("portal:keys"), "escape"));
  await settle();
  expect(second).toEqual({ granted: false, choices: [] });
});

test("the print sheet: Copies keeps what is typed, Enter prints from the field, Esc cancels", async () => {
  const printer = {
    name: "Office",
    label: "Office",
    location: "",
    state: "idle" as const,
    accepting: true,
    color: false,
    sides: [],
    media: [],
    mediaDefault: null,
  };
  const start = { printer: "Office", pdfPath: null, copies: 1, pages: "", twoSided: false, color: false, media: null };
  const request = { appId: "org.example.App", parent: "", title: "Lease", printers: [printer], start, pages: 3 };
  const run = async () => {
    const { show, mounted } = showHere();
    let answer: unknown = "pending";
    void printOnScreen(show, async () => null)
      .ask(request, new AbortController().signal)
      .then((value) => {
        answer = value;
      });
    await settle();
    return { sheet: mounted(), answer: () => answer };
  };

  const first = await run();
  const copies = first.sheet.node("print:copies");
  first.sheet.send({ type: "change", nodeId: copies, value: "" });
  await settle();
  // Cleared, it stays cleared (no snapping back to 1), and Print waits.
  expect(first.sheet.root.lastTree()).toContain("A number from 1 to 999");
  first.sheet.send({ type: "submit", nodeId: copies, value: "" });
  await settle();
  expect(first.answer()).toBe("pending");
  first.sheet.send({ type: "change", nodeId: copies, value: "2" });
  await settle();
  first.sheet.send({ type: "submit", nodeId: copies, value: "2" });
  await settle();
  expect(first.answer()).toMatchObject({ kind: "print", choice: { copies: 2, printer: "Office" } });

  // Enter with nothing focused prints too; Esc in a field cancels.
  const second = await run();
  second.sheet.send(windowKey(second.sheet.node("portal:keys"), "enter"));
  await settle();
  expect(second.answer()).toMatchObject({ kind: "print", choice: { copies: 1 } });
  const third = await run();
  third.sheet.send({ type: "key", nodeId: third.sheet.node("print:copies"), value: "Escape" });
  await settle();
  expect(third.answer()).toBeNull();
});
