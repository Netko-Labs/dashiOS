import { describe, expect, test } from "bun:test";
import { applyPatch, diffTrees, isRefusal, parseTree, parseViewMessage, toWire, type ViewNode } from "../src/index.ts";
import { ELEMENTS } from "../src/view/elements.ts";

const item = (i: string, title: string, extra: Record<string, unknown> = {}) => ({ t: "Item", i, p: { title, ...extra } });
const list = (...children: unknown[]) => ({
  t: "List",
  i: "root",
  p: { filter: "launcher" },
  c: [{ t: "Section", i: "s1", p: { title: "Yours" }, c: children }],
});

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if (isRefusal(parsed)) throw new Error(parsed.error);
  return parsed;
}

describe("the element set", () => {
  test("the shared elements are named once, and marked shared", () => {
    const shared = Object.entries(ELEMENTS)
      .filter(([, spec]) => spec.shared)
      .map(([name]) => name)
      .sort();
    expect(shared).toEqual(["Action", "Image", "Label", "Link", "Tag", "Text"]);
  });
});

describe("parseTree", () => {
  test("a list with sections, items, accessories and actions", () => {
    const root = tree(
      list({
        ...item("i1", "Fix the dock", { subtitle: "dashiOS #42", keywords: ["dock"] }),
        c: [
          { t: "Tag", i: "t1", p: { text: "Checks pass", tone: "moss" } },
          { t: "ActionPanel", i: "ap", c: [{ t: "Action", i: "a1", p: { title: "Open in Browser", kind: "open", target: "https://github.com" } }] },
        ],
      }),
    );
    expect(root.c[0]?.c[0]?.p.title).toBe("Fix the dock");
    expect(root.c[0]?.c[0]?.c[0]?.t).toBe("Tag");
  });

  test("refuses what a view can't be", () => {
    expect(parseTree({ t: "Item", i: "x", p: { title: "a" } })).toEqual({ error: "a view is a List, Grid, Detail, Form, not a Item" });
    expect(parseTree(list({ t: "Tag", i: "t", p: { text: "x" } }))).toEqual({ error: "Section can't hold Tag “t”" });
    expect(parseTree(list(item("a", "")))).toEqual({ error: "Item “a”: title is empty" });
    expect(parseTree(list(item("a", "one"), item("a", "two")))).toEqual({ error: "two nodes are “a”" });
    expect(parseTree(list(item("a", "x", { colour: "red" })))).toEqual({ error: "Item “a”: Item has no prop “colour”" });
    expect(parseTree(list({ t: "Script", i: "s" }))).toEqual({ error: "“Script” is not an element" });
    expect(parseTree(list(item("a", "x", { title: "bad‮word" })))).toEqual({ error: "Item “a”: title has control characters" });
  });

  test("holds the node limit", () => {
    const many = Array.from({ length: 2001 }, (_, at) => item(`i${at}`, `Row ${at}`));
    expect(parseTree(list(...many))).toEqual({ error: "a view has more than 2000 nodes" });
  });
});

describe("patches", () => {
  test("a diff applied gives the new tree, for changes, inserts and removals", () => {
    const before = tree(list(item("a", "A"), item("b", "B"), item("c", "C"), item("d", "D")));
    const after = tree(list(item("a", "A changed"), item("x", "X"), item("d", "D"), item("e", "E")));
    const ops = diffTrees(before, after);
    const applied = applyPatch(before, JSON.parse(JSON.stringify(ops)));
    expect(isRefusal(applied) ? applied : toWire(applied)).toEqual(toWire(after));
    // a changed in place: its own node is replaced, not the section around it.
    expect(ops.find((op) => op.op === "replace")).toEqual({ op: "replace", path: [0, 0], node: after.c[0]?.c[0] as ViewNode });
  });

  test("nothing changed, nothing sent", () => {
    const one = tree(list(item("a", "A")));
    expect(diffTrees(one, tree(list(item("a", "A"))))).toEqual([]);
  });

  test("a patch that would break the tree is refused, and the tree stays", () => {
    const before = tree(list(item("a", "A")));
    expect(applyPatch(before, [{ op: "insert", path: [0, 1], node: item("a", "again") }])).toEqual({ error: "two nodes are “a”" });
    expect(applyPatch(before, [{ op: "remove", path: [0, 5] }])).toEqual({ error: "a patch removes a node that isn't there" });
    expect(applyPatch(before, [{ op: "replace", path: [0, 0], node: { t: "Tag", i: "t", p: { text: "x" } } }])).toEqual({
      error: "Section can't hold Tag “t”",
    });
  });
});

describe("the wire", () => {
  test("a tree message is checked as a tree", () => {
    expect(parseViewMessage("tree", { type: "tree", seq: 3, root: list(item("a", "A")) })).toMatchObject({ type: "tree", seq: 3 });
    expect(parseViewMessage("tree", { type: "tree", seq: 3, root: { t: "Text", i: "x", p: { text: "hi" } } })).toEqual({
      error: "tree: a view is a List, Grid, Detail, Form, not a Text",
    });
    expect(parseViewMessage("toast", { type: "toast", seq: 3, style: "done", title: "Copied" })).toEqual({
      type: "toast",
      seq: 3,
      style: "done",
      title: "Copied",
    });
  });
});
