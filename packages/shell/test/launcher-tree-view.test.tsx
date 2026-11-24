import { afterEach, describe, expect, test } from "bun:test";
import { parseTree, type ViewNode } from "@dashi/applet";
import type { TreeActed, TreeSnapshot, TreeView } from "../src/actions/index.ts";
import { markdownBlocks } from "../src/launcher/lib/detail-markdown.ts";
import { keyOf, panelVerbs, treeSections } from "../src/launcher/lib/tree-rows.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

// An extension's view in the launcher: drawn by the launcher from the tree, in its own rows,
// cells and detail; ↩ is the first action, Esc goes back a view, then out.

afterEach(() => unmountLauncher());

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

const action = (i: string, title: string, kind: string, extra: Record<string, unknown> = {}) => ({ t: "Action", i, p: { title, kind, ...extra } });

const PRS = tree({
  t: "List",
  i: "root",
  p: { filter: "launcher", placeholder: "Filter pull requests" },
  c: [
    {
      t: "Section",
      i: "s",
      p: { title: "Open in oven-sh/bun", subtitle: "2" },
      c: [
        {
          t: "Item",
          i: "k:42",
          p: { title: "Fix the dock", subtitle: "#42 · alexk", keywords: ["dock"] },
          c: [
            { t: "Tag", i: "t42", p: { text: "Draft", tone: "secondary" } },
            { t: "Text", i: "x42", p: { text: "2 h ago" } },
            {
              t: "ActionPanel",
              i: "p42",
              c: [
                action("open42", "Open in Browser", "open", { target: "https://github.com" }),
                action("push42", "Show Details", "push"),
                action("copy42", "Copy Link", "copy", { content: "x", shortcut: "mod+c" }),
              ],
            },
          ],
        },
        { t: "Item", i: "k:43", p: { title: "Speed up the grid", subtitle: "#43" } },
      ],
    },
  ],
});

class FakeView implements TreeView {
  readonly from = "GitHub";
  readonly dir = null;
  readonly acted: string[] = [];
  readonly searched: string[] = [];
  private state: TreeSnapshot;
  private readonly listeners = new Set<() => void>();
  closed = false;
  constructor(stack: ViewNode[]) {
    this.state = { stack, phase: stack.length > 0 ? "shown" : "starting", since: 0 };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  set(next: Partial<TreeSnapshot>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  search = (text: string) => void this.searched.push(text);
  select = () => {};
  more = () => {};
  act = async (node: string): Promise<TreeActed> => {
    this.acted.push(node);
    return node === "copy42" ? { kind: "done", notice: "Copied" } : { kind: "done" };
  };
  setPreference = async () => true;
  connect = async (): Promise<TreeActed> => ({ kind: "done" });
  change = (): void => {};
  back = () => {
    if (this.state.stack.length <= 1) return false;
    this.set({ stack: this.state.stack.slice(0, -1) });
    return true;
  };
  close = () => {
    this.closed = true;
  };
}

describe("the tree as rows", () => {
  test("items become rows with their tags and words; the launcher filters by title, subtitle and keywords", () => {
    const [section] = treeSections(PRS, "", { dir: null, from: "GitHub" });
    expect(section?.title).toBe("Open in oven-sh/bun");
    expect(section?.rows[0]).toMatchObject({
      id: "tree:k:42",
      title: "Fix the dock",
      detail: "#42 · alexk",
      kind: "2 h ago",
      tags: [{ text: "Draft", tone: "secondary" }],
    });
    expect(treeSections(PRS, "dock", { dir: null, from: "GitHub" })[0]?.rows.map((row) => row.title)).toEqual(["Fix the dock"]);
    expect(treeSections(PRS, "zebra", { dir: null, from: "GitHub" })[0]?.rows[0]?.title).toBe("Nothing in GitHub for “zebra”");
  });

  test("an ActionPanel's actions are verbs: ↩, ❖↩, then their own keys", () => {
    const panel = PRS.c[0]?.c[0]?.c[2];
    expect(panelVerbs(panel).map((verb) => [verb.title, verb.key])).toEqual([
      ["Open in Browser", "↩"],
      ["Show Details", "❖↩"],
      ["Copy Link", "❖C"],
    ]);
    expect(keyOf("shift+mod+enter")).toBe("⇧❖↩");
  });

  test("a grid is one window of cells; a detail is one row with its Markdown", () => {
    const grid = tree({
      t: "Grid",
      i: "g",
      p: { columns: 8, filter: "extension" },
      c: [
        {
          t: "Section",
          i: "s",
          p: { title: "Smileys" },
          c: [{ t: "Item", i: "e1", p: { title: "grinning face" }, c: [{ t: "Image", i: "im", p: { emoji: "😀" } }] }],
        },
      ],
    });
    const [cells] = treeSections(grid, "", { dir: null, from: "Emoji" });
    expect(cells).toMatchObject({ id: "tree:grid", title: "Smileys", grid: 8, window: 8 });
    expect(cells?.rows[0]?.icon).toEqual({ text: "😀" });
    const detail = tree({ t: "Detail", i: "d", p: { markdown: "# Fix the dock" } });
    expect(treeSections(detail, "", { dir: null, from: "GitHub" })[0]?.detail?.markdown).toBe("# Fix the dock");
  });
});

describe("the view in the launcher", () => {
  test("rows drawn by the launcher; ↩ runs the first action; typing filters", async () => {
    const view = new FakeView([PRS]);
    const scope = treeScope("Pull Requests", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ["tree:k:42", "tree:k:43"]);
    expect(launcher.has("launcher:chip")).toBe(true);
    expect(launcher.tree()).toContain("Pull Requests");
    expect(launcher.tree()).toContain("Draft");
    expect(launcher.rows().ids).toEqual(["tree:k:42", "tree:k:43"]);
    await launcher.type("grid");
    expect(launcher.rows().ids).toEqual(["tree:k:43"]);
    await launcher.type("");
    await launcher.enter();
    expect(view.acted).toEqual(["open42"]);
  });

  test("before its tree: the skeleton; Esc on a pushed view goes back to the list, then out", async () => {
    const view = new FakeView([]);
    const scope = treeScope("Pull Requests", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ["tree:k:42", "tree:k:43"]);
    expect(launcher.rows().ids).toEqual([]);
    view.set({ stack: [PRS, tree({ t: "Detail", i: "d", p: { markdown: "# Fix the dock\n\nIt flickered." } })], phase: "shown" });
    await launcher.type("");
    expect(launcher.has("launcher:detail")).toBe(true);
    expect(launcher.tree()).toContain("It flickered.");
    await launcher.key("Escape");
    expect(launcher.tree()).toContain("Fix the dock");
    expect(launcher.has("launcher:detail")).toBe(false);
    await launcher.key("Escape");
    expect(launcher.closed.length).toBe(1);
  });
});

// Pass 37: a pull request's body drew its Markdown table as raw `| --- |` lines.
describe("a detail's Markdown table", () => {
  const Body = "## Checks\n\n| Check | Result |\n| --- | :-: |\n| **lint** | pass |\n| [tests](https://x) | 2 failed |\nAfter the table.";

  test("is read as a table (header, alignment, rows), its cells' marks dropped as a line's are", () => {
    const blocks = markdownBlocks(Body);
    expect(blocks.map((block) => block.kind)).toEqual(["h2", "table", "p"]);
    expect(blocks[1]).toEqual({
      kind: "table",
      table: {
        header: ["Check", "Result"],
        align: ["left", "center"],
        rows: [
          ["**lint**", "pass"],
          ["[tests](https://x)", "2 failed"],
        ],
      },
    });
    // Not a table: dashes with no header above them, or a header whose dashes don't match.
    expect(markdownBlocks("| a | b |\n| --- |").map((block) => block.kind)).toEqual(["p", "p"]);
  });

  test("is drawn as a table in the launcher, with no pipes left", async () => {
    const view = new FakeView([]);
    const scope = treeScope("Pull Requests", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ["tree:k:42", "tree:k:43"]);
    view.set({ stack: [PRS, tree({ t: "Detail", i: "d", p: { markdown: Body } })], phase: "shown" });
    await launcher.type("");
    expect(launcher.has("launcher:detail:table")).toBe(true);
    // A detail longer than its room clips: the table keeps its height (it shrank to its borders in the VM).
    expect(launcher.tree()).toMatch(/"id":"[^"]+","direction":"column"(,"width":\d+)?,"shrink":false[^}]*"cornerRadius":5/);
    const drawn = launcher.tree();
    expect(drawn).toContain('"lint"');
    expect(drawn).toContain('"tests"');
    expect(drawn).not.toContain("| --- |");
    expect(drawn).not.toContain("**lint**");
    expect(drawn).toContain("After the table.");
  });
});

// Pass 37: Esc back from a pull request's detail put the selection on row 1, not on the one opened.
test("Esc back from a detail keeps the row that opened it selected, with what was typed then", async () => {
  const item = (n: number, title: string) => ({
    t: "Item",
    i: `k:${n}`,
    p: { title },
    c: [{ t: "ActionPanel", i: `p${n}`, c: [action(`push${n}`, "Show Details", "push")] }],
  });
  const list = tree({
    t: "List",
    i: "root",
    p: { filter: "launcher" },
    c: [item(41, "Fix the dock"), item(42, "Fix the grid"), item(43, "Speed up the grid")],
  });
  const view = new FakeView([list]);
  view.act = async (node) => {
    view.acted.push(node);
    view.set({ stack: [...view.snapshot().stack, tree({ t: "Detail", i: `d:${node}`, p: { markdown: `# ${node}` } })] });
    return { kind: "done" };
  };
  const scope = treeScope("Pull Requests", view);
  const ids = ["tree:k:41", "tree:k:42", "tree:k:43"];
  const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ids);
  await launcher.key("ArrowDown");
  await launcher.key("ArrowDown");
  expect(launcher.rows(ids).selected).toBe("tree:k:43");
  await launcher.enter();
  expect(view.acted).toEqual(["push43"]);
  expect(launcher.has("launcher:detail")).toBe(true);
  await launcher.key("Escape");
  expect(launcher.has("launcher:detail")).toBe(false);
  expect(launcher.rows(ids).selected).toBe("tree:k:43");
  // Filtered first: the words come back with the row.
  await launcher.type("grid");
  await launcher.key("ArrowDown");
  expect(launcher.rows(ids)).toEqual({ ids: ["tree:k:42", "tree:k:43"], selected: "tree:k:43" });
  await launcher.enter();
  await launcher.key("Escape");
  expect(launcher.rows(ids)).toEqual({ ids: ["tree:k:42", "tree:k:43"], selected: "tree:k:43" });
  expect(launcher.tree()).toContain('"grid"');
});
