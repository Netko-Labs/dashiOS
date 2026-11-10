import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { ChooserModel } from "../apps/files/chooser/model.ts";
import { ChooserView } from "../apps/files/chooser/view.tsx";
import type { Env } from "../apps/files/env.ts";
import { accessHeight, askOnScreen } from "../apps/portal/access.tsx";
import { appInfo } from "../apps/portal/apps.ts";
import { type ChooserAnswer, parseChooser } from "../apps/portal/file-chooser/options.ts";
import { printOnScreen } from "../apps/portal/print/sheet.tsx";
import type { ShowDialog } from "../apps/portal/windows.ts";
import { fakeClockEachTest, flush, settle, until } from "./support/time.ts";

fakeClockEachTest();
/** Until the chooser is in `folder` and has drawn it (a folder lists on the file system, outside the event loop's turns). */
const folderIs = (m: ChooserModel, folder: string) => until(() => m.folder() === folder && !m.store.getSnapshot().loading, folder).then(() => flush());

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

test("the chooser is Files: a slow second click only selects, a double-click opens, Up and Back move, the folder pop-up goes up", async () => {
  const root = mkdtempSync(join(tmpdir(), "chooser-view-"));
  const home = join(root, "h");
  const docs = join(home, "Docs");
  mkdirSync(join(docs, "Taxes"), { recursive: true });
  writeFileSync(join(docs, "Lease.pdf"), "%PDF");
  const env = {
    home,
    user: "alexk",
    mime: { extensions: new Map([["pdf", "application/pdf"]]), literals: new Map() },
    run: async () => ({ ok: false, code: 1, stdout: "", stderr: "" }),
    trash: { files: join(root, "trash/files"), info: join(root, "trash/info") },
    cache: join(root, "cache"),
    dirs: [{ name: "DOCUMENTS", path: docs }],
    now: Date.now,
    recents: async () => [],
  } as unknown as Env;
  const request = parseChooser("open", ["org.example.App", "", "Open Lease", new Map()]);
  const model = new ChooserModel(
    request,
    env,
    { folder: docs, name: "" },
    { prefs: { view: "icons", sort: { key: "name", ascending: true }, showHidden: false }, watch: false },
  );
  model.start();
  model.store.go({ kind: "folder", path: docs });
  const answers: Array<ChooserAnswer | null> = [];
  const { root: mounted, node, send } = mount(<ChooserView model={model} title="Open Lease" exists={() => false} answer={(value) => answers.push(value)} />);
  await folderIs(model, docs);
  const lease = join(docs, "Lease.pdf");
  const taxes = join(docs, "Taxes");
  const press = (testID: string) => send({ type: "press", nodeId: node(testID) });

  press(`item:${lease}`);
  expect(model.store.getSnapshot().selection).toEqual([lease]);
  // Pressed again a while later: still only a click, nothing opens.
  await settle(500);
  press(`item:${lease}`);
  expect(answers).toEqual([]);
  // A double-click opens it.
  await settle(500);
  press(`item:${lease}`);
  press(`item:${lease}`);
  expect(answers.map((answer) => answer?.paths)).toEqual([[lease]]);

  // A folder's double-click goes in; Up comes back out, and Back retraces.
  await settle(500);
  press(`item:${taxes}`);
  press(`item:${taxes}`);
  await folderIs(model, taxes);
  press("chooser:up");
  await folderIs(model, docs);
  press("chooser:back");
  await folderIs(model, taxes);

  // The folder pop-up lists the folders it is in; choosing one goes there.
  send({ type: "press", nodeId: node("chooser:folder"), bounds: { x: 300, y: 6, width: 120, height: 28 } });
  await settle();
  send({ type: "press", nodeId: node("chooser:folder:menu:Home") });
  await folderIs(model, home);
  // Esc, with nothing typed, cancels.
  send({ type: "windowkey", nodeId: node("keys"), key: "escape", ctrl: false, alt: false, shift: false, meta: false, repeat: false });
  expect(answers.at(-1)).toBeNull();
  mounted.unmount();
  model.stop();
  rmSync(root, { recursive: true, force: true });
});

test("an access sheet: Enter never grants; Esc says no; only a click on Allow allows", async () => {
  const { show, mounted } = showHere();
  const opened: string[] = [];
  const ask = askOnScreen(show, async (url) => {
    opened.push(url);
    return { ok: true, text: "" };
  });
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
  // The line under the question, and the way to where the answer can be taken back: a pane that exists.
  expect(sheet.root.lastTree()).toContain("Dashi remembers your answer");
  expect(sheet.root.lastTree()).toContain("Privacy…");
  sheet.send({ type: "press", nodeId: sheet.node("access:privacy") });
  await settle();
  expect(opened).toEqual(["dashi://settings/privacy/apps"]);
  expect(answer).toBe("pending");
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

test("an access sheet opens as tall as its alert, check boxes and all", () => {
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
  const app = appInfo(request.appId);
  // The controls' strip and 6, the 40 px tile beside the question and its line, 10 and 6, the 28 px buttons, 18.
  expect(accessHeight(request, app)).toBe(146);
  const boxes = [
    { id: "a", label: "Remember", options: [], initial: "true" },
    { id: "b", label: "Also the microphone", options: [], initial: "false" },
  ];
  // Two check boxes, 16 each and 8 apart, 6 under the line: the words outgrow the tile.
  expect(accessHeight({ ...request, choices: boxes }, app)).toBe(38 + 6 + (17 + 4 + 16 + 4 + 6 + 40) + 10 + 6 + 28 + 18);
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

test("the chooser's search takes a typed path: Return goes there; one that leads nowhere says so until a good one", async () => {
  const root = mkdtempSync(join(tmpdir(), "chooser-path-"));
  const home = join(root, "h");
  const docs = join(home, "Docs");
  mkdirSync(join(docs, "Taxes"), { recursive: true });
  const env = {
    home,
    user: "alexk",
    mime: { extensions: new Map(), literals: new Map() },
    run: async () => ({ ok: false, code: 1, stdout: "", stderr: "" }),
    trash: { files: join(root, "trash/files"), info: join(root, "trash/info") },
    cache: join(root, "cache"),
    dirs: [{ name: "DOCUMENTS", path: docs }],
    now: Date.now,
    recents: async () => [],
  } as unknown as Env;
  const model = new ChooserModel(
    parseChooser("open", ["org.example.App", "", "Open", new Map()]),
    env,
    { folder: docs, name: "" },
    { prefs: { view: "icons", sort: { key: "name", ascending: true }, showHidden: false }, watch: false },
  );
  model.start();
  const { root: mounted, node, send } = mount(<ChooserView model={model} title="Open" exists={() => false} answer={() => {}} />);
  await folderIs(model, home);
  const field = node("chooser:search");
  // A path is not a name to look for: no search runs while it is typed.
  send({ type: "change", nodeId: field, value: "~/Docs/Tax" });
  expect(model.store.getSnapshot().query).toBe("");
  send({ type: "submit", nodeId: field, value: "~/Docs/Nope" });
  await until(() => model.getSnapshot().problem !== null, "the path's problem");
  expect(model.getSnapshot().problem).toContain("Nope");
  expect(model.folder()).toBe(home);
  send({ type: "submit", nodeId: field, value: "~/Docs/Taxes" });
  await until(() => model.folder() === join(docs, "Taxes"), "the path to open");
  expect(model.folder()).toBe(join(docs, "Taxes"));
  expect(model.getSnapshot().problem).toBeNull();
  // Words still search.
  send({ type: "change", nodeId: field, value: "lease" });
  expect(model.store.getSnapshot().query).toBe("lease");
  mounted.unmount();
  model.stop();
  rmSync(root, { recursive: true, force: true });
});
