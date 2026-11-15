import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChooser } from "../apps/portal/lib/file-chooser/options.ts";
import { ChooserModel } from "../src/shared/file-browser/chooser-model.ts";
import { ChooserView } from "../src/shared/file-browser/chooser-view.tsx";
import type { Env } from "../src/shared/file-browser/env.ts";
import { marqueeOf } from "../src/shared/file-browser/lib/marquee/of.ts";
import { mount } from "./support/portal-sheets.ts";
import { fakeClockEachTest, flush, until } from "./support/time.ts";

fakeClockEachTest();

// The listing's scroll view tells the marquee where it is and how far it is scrolled (D143), in both views of a sheet.
for (const view of ["icons", "list"] as const) {
  test(`in the ${view} view the scroll view's place and offset reach the marquee, and another view starts at its start`, async () => {
    const root = mkdtempSync(join(tmpdir(), "scroll-place-"));
    const docs = join(root, "h", "Docs");
    mkdirSync(docs, { recursive: true });
    for (let at = 0; at < 40; at++) writeFileSync(join(docs, `Note ${at}.txt`), "x");
    const env = {
      home: join(root, "h"),
      user: "alexk",
      mime: { extensions: new Map(), literals: new Map() },
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
      { prefs: { view, sort: { key: "name", ascending: true }, showHidden: false }, watch: false },
    );
    model.start();
    model.store.go({ kind: "folder", path: docs });
    const { root: mounted, node, send } = mount(<ChooserView model={model} title="Open" exists={() => false} answer={() => {}} />);
    await until(() => model.folder() === docs && !model.store.getSnapshot().loading, docs);
    await flush();
    const rows = view === "icons" ? "grid:rows" : "list:rows";
    const place = marqueeOf(model.store).place;
    expect(place.origin()).toBeNull();
    send({ type: "resize", nodeId: node(rows), bounds: { x: 200, y: 90, width: 500, height: 300 } });
    expect(place.origin()).toEqual({ x: 200, y: 90 });
    // A wheel: the view says where it stands.
    send({ type: "scroll", nodeId: node(rows), x: 0, y: 120, contentWidth: 500, contentHeight: 1100, width: 500, height: 300 });
    expect(place.origin()).toEqual({ x: 200, y: -30 });
    expect(place.top).toBe(120);
    expect(place.range(0)).toBe(800);
    // The other view is another scroll view: it starts at its start.
    model.store.setView(view === "icons" ? "list" : "icons");
    await flush();
    expect(place.top).toBe(0);
    mounted.unmount();
  });
}
