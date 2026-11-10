import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChooserModel } from "../apps/files/chooser/model.ts";
import { ChooserView } from "../apps/files/chooser/view.tsx";
import type { Env } from "../apps/files/env.ts";
import { parseChooser } from "../apps/portal/lib/file-chooser/options.ts";
import type { ChooserAnswer } from "../src/shared/files/index.ts";
import { mount } from "./support/portal-sheets.ts";
import { fakeClockEachTest, flush, settle, until } from "./support/time.ts";

fakeClockEachTest();
/** Until the chooser is in `folder` and has drawn it (a folder lists on the file system, outside the event loop's turns). */
const folderIs = (m: ChooserModel, folder: string) => until(() => m.folder() === folder && !m.store.getSnapshot().loading, folder).then(() => flush());

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
