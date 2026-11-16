/**
 * One start or one ❖N makes one Text Editor window (D310): New's window takes
 * no draft, a plain start takes the newest, and File › Open Drafts brings
 * back the rest, one window each, once.
 */

import { describe, expect, test } from "bun:test";
import { parseArgs } from "../apps/editor/lib/args.ts";
import { KeptDrafts, startingDraft } from "../apps/editor/lib/drafts.ts";
import { editorMenus, type MenuContext } from "../apps/editor/lib/menus.ts";
import { windowCommand } from "../apps/editor/lib/windows.ts";

const LAUNCH = { bun: "/bun", main: "/m.tsx", host: "/host" };
const KEPT = ["100-41.json", "200-42.json", "300-43.json", "400-44.json"];

describe("which draft a window takes", () => {
  test("New's window (❖N, the toolbar) is a new Untitled one and takes none, however many are kept", () => {
    const command = windowCommand(LAUNCH, []);
    expect(command).toEqual(["/bun", "/m.tsx", "--host", "/host", "--new"]);
    expect(startingDraft(parseArgs(command.slice(2)), KEPT)).toBeNull();
  });

  test("a plain start (the Dock, the launcher, launch_app) takes only the newest", () => {
    expect(startingDraft(parseArgs([]), KEPT)).toBe("400-44.json");
    expect(startingDraft(parseArgs([]), [])).toBeNull();
  });

  test("a window for a file or for one kept draft takes no other", () => {
    expect(startingDraft(parseArgs(windowCommand(LAUNCH, ["a.txt"]).slice(2)), KEPT)).toBeNull();
    expect(startingDraft(parseArgs(windowCommand(LAUNCH, [], "200-42.json").slice(2)), KEPT)).toBe("200-42.json");
  });
});

describe("File › Open Drafts", () => {
  test("counts the kept drafts and opens each once, one window each", () => {
    let onDisk = [...KEPT];
    const drafts = new KeptDrafts(() => onDisk);
    expect(drafts.getSnapshot()).toBe(0);
    drafts.refresh();
    expect(drafts.getSnapshot()).toBe(4);
    let heard = 0;
    drafts.subscribe(() => heard++);
    const opened: string[] = [];
    drafts.openAll((name) => opened.push(name));
    expect(opened).toEqual(KEPT);
    expect(drafts.getSnapshot()).toBe(0);
    expect(heard).toBeGreaterThan(0);
    // Their windows have not taken them yet: still not offered again.
    drafts.refresh();
    expect(drafts.getSnapshot()).toBe(0);
    drafts.openAll((name) => opened.push(name));
    expect(opened).toHaveLength(4);
    // A new one kept later is offered.
    onDisk = [...onDisk, "500-45.json"];
    drafts.refresh();
    expect(drafts.getSnapshot()).toBe(1);
  });

  test("the row is there, enabled only while drafts are kept, and runs once", () => {
    let runs = 0;
    const context = (keptDrafts: number): MenuContext => ({
      hasFile: false,
      pristine: true,
      hasVersions: false,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      hasMatches: false,
      monospace: false,
      lineNumbers: false,
      tabWidth: 4,
      caseSensitive: false,
      keptDrafts,
      actions: new Proxy({} as MenuContext["actions"], { get: (_target, key) => (key === "openDrafts" ? () => runs++ : () => {}) }),
    });
    const row = (n: number) =>
      editorMenus(context(n))
        .menus.flatMap((menu) => menu.items)
        .find((item) => item.type !== "separator" && item.id === "open-drafts");
    expect(row(0)).toMatchObject({ label: "Open Drafts", enabled: false });
    expect(row(3)).toMatchObject({ enabled: true });
    editorMenus(context(0)).run("open-drafts");
    expect(runs).toBe(0);
    editorMenus(context(3)).run("open-drafts");
    expect(runs).toBe(1);
  });
});
