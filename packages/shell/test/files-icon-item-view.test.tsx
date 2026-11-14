import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChooser } from "../apps/portal/lib/file-chooser/options.ts";
import { ChooserModel } from "../src/shared/file-browser/chooser-model.ts";
import { ChooserView } from "../src/shared/file-browser/chooser-view.tsx";
import type { Env } from "../src/shared/file-browser/env.ts";
import { mount } from "./support/portal-sheets.ts";
import { fakeClockEachTest, flush, until } from "./support/time.ts";

fakeClockEachTest();

test("in the icon view the icon and the name are the item; the cell around them takes no press, so a press there is one on empty space", async () => {
  const root = mkdtempSync(join(tmpdir(), "icon-item-"));
  const docs = join(root, "h", "Docs");
  mkdirSync(join(docs, "Taxes"), { recursive: true });
  writeFileSync(join(docs, "Lease.pdf"), "%PDF");
  const env = {
    home: join(root, "h"),
    user: "alexk",
    mime: { extensions: new Map([["pdf", "application/pdf"]]), literals: new Map() },
    run: async () => ({ ok: false, code: 1, stdout: "", stderr: "" }),
    trash: { files: join(root, "trash/files"), info: join(root, "trash/info") },
    cache: join(root, "cache"),
    dirs: [],
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
  model.store.go({ kind: "folder", path: docs });
  const { root: mounted, node, send } = mount(<ChooserView model={model} title="Open" exists={() => false} answer={() => {}} />);
  await until(() => model.folder() === docs && !model.store.getSnapshot().loading, docs);
  await flush();
  const lease = join(docs, "Lease.pdf");
  const selection = () => model.store.getSnapshot().selection;

  // The icon selects, and so does the name.
  send({ type: "press", nodeId: node(`item:${lease}`) });
  expect(selection()).toEqual([lease]);
  send({ type: "press", nodeId: node(`item:${join(docs, "Taxes")}`) });
  send({ type: "press", nodeId: node(`name:${lease}`) });
  expect(selection()).toEqual([lease]);
  // The cell hears no press and no pointer of its own: the listing around it does.
  send({ type: "press", nodeId: node(`cell:${lease}`) });
  expect(selection()).toEqual([lease]);
  send({ type: "press", nodeId: node("content") });
  expect(selection()).toEqual([]);
  mounted.unmount();
});
