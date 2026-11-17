/**
 * The preview column beside a list (frame L11): an extension's items that
 * carry a Detail, and the clipboard's copies, show the selected one at the
 * list's right; moving the selection moves the preview. A list without
 * previews stays one column.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { parseTree, type ViewNode } from "@dashi/applet";
import type { TreeActed, TreeSnapshot, TreeView } from "../src/actions/index.ts";
import { copiedWhen, entryPreview } from "../src/clipboard/lib/rows.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

afterEach(() => unmountLauncher());

const item = (id: string, title: string, markdown: string, facts: Record<string, string>) => ({
  t: "Item",
  i: id,
  p: { title },
  c: [
    {
      t: "Detail",
      i: `${id}:d`,
      p: { markdown },
      c: [{ t: "Metadata", i: `${id}:m`, c: Object.entries(facts).map(([title, text], at) => ({ t: "Label", i: `${id}:f${at}`, p: { title, text } })) }],
    },
  ],
});

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

class OneList implements TreeView {
  readonly from = "Notes";
  readonly dir = null;
  private readonly state: TreeSnapshot;
  constructor(root: ViewNode) {
    this.state = { stack: [root], phase: "shown", since: 0 };
  }
  subscribe = () => () => {};
  snapshot = (): TreeSnapshot => this.state;
  search = () => {};
  select = () => {};
  more = () => {};
  act = async (): Promise<TreeActed> => ({ kind: "done" });
  setPreference = async () => true;
  connect = async (): Promise<TreeActed> => ({ kind: "done" });
  change = (): void => {};
  back = () => false;
  close = () => {};
}

describe("the preview column", () => {
  test("an item's Detail shows beside the list for the selected row, and follows the selection", async () => {
    const view = new OneList(
      tree({
        t: "List",
        i: "l",
        p: { filter: "launcher" },
        c: [item("k:a", "Groceries", "Milk, eggs", { Edited: "Today" }), item("k:b", "Trip", "Bogotá in March", { Edited: "Yesterday" })],
      }),
    );
    const scope = treeScope("Notes", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ["tree:k:a", "tree:k:b"]);
    expect(launcher.has("launcher:preview")).toBe(true);
    expect(launcher.tree()).toContain("Milk, eggs");
    expect(launcher.tree()).not.toContain("Bogotá in March");
    await launcher.key("ArrowDown");
    expect(launcher.tree()).toContain("Bogotá in March");
    expect(launcher.tree()).toContain("Yesterday");
  });

  test("a list without previews stays one column", async () => {
    const view = new OneList(tree({ t: "List", i: "l", c: [{ t: "Item", i: "k:a", p: { title: "Plain" } }] }));
    const scope = treeScope("Notes", view);
    const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ["tree:k:a"]);
    expect(launcher.has("launcher:preview")).toBe(false);
  });

  test("a copy's preview: its text, where from, when, and what kind", () => {
    const now = new Date(2026, 10, 15, 9, 41).getTime();
    const at = new Date(2026, 10, 15, 9, 37).getTime();
    const preview = entryPreview({ id: "1", kind: "text", mime: "text/plain", text: "git push -u origin store-v2", app: "Terminal", copiedAt: at }, now, null);
    expect(preview).toEqual({
      text: "git push -u origin store-v2",
      facts: [
        { title: "From", text: "Terminal" },
        { title: "Copied", text: "Today, 9:37 AM" },
        { title: "Kind", text: "Text · 27 characters" },
      ],
    });
    expect(copiedWhen(at - 86_400_000, now)).toBe("Yesterday, 9:37 AM");
  });
});
