import { afterEach, expect, test } from "bun:test";
import { parseTree, type ViewNode } from "@dashi/applet";
import type { TreeSnapshot, TreeView } from "../src/actions/index.ts";
import { markdownBlocks } from "../src/launcher/lib/detail-markdown.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import { TASK_BOX, taskOf } from "../src/shared/markdown/index.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

// Passes 41 and 42: Renovate's `- [ ] If you want to rebase…` was drawn as "• [ ] If you want to rebase…".

afterEach(() => unmountLauncher());

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

class OneDetail implements TreeView {
  readonly from = "GitHub";
  readonly dir = null;
  private readonly state: TreeSnapshot;
  constructor(markdown: string) {
    this.state = { stack: [tree({ t: "Detail", i: "d", p: { markdown } })], phase: "shown", since: 0 };
  }
  subscribe = () => () => {};
  snapshot = () => this.state;
  search = () => {};
  select = () => {};
  more = () => {};
  act = async () => ({ kind: "done" as const });
  setPreference = async () => true;
  back = () => false;
  close = () => {};
}

test("a task list's items are read as open or done boxes; a plain item stays a bullet", () => {
  expect(taskOf("[ ] rebase")).toEqual({ done: false, text: "rebase" });
  expect(taskOf("[X] merged")).toEqual({ done: true, text: "merged" });
  expect(taskOf("[link](x)")).toBeNull();
  expect(markdownBlocks("- [ ] If you want to rebase\n* [x] **Done** here\n- plain\n- [ ]")).toEqual([
    { kind: "task", text: "If you want to rebase", done: false },
    { kind: "task", text: "Done here", done: true },
    { kind: "li", text: "plain" },
    { kind: "task", text: "", done: false },
  ]);
});

test("drawn with Notes' boxes, no brackets left", async () => {
  const scope = treeScope("Pull Requests", new OneDetail("- [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box\n- [x] Tests pass"));
  const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, []);
  await launcher.type("");
  expect(launcher.has("launcher:detail:task:open")).toBe(true);
  expect(launcher.has("launcher:detail:task:done")).toBe(true);
  const drawn = launcher.tree();
  expect(drawn).toContain(`"${TASK_BOX.open}"`);
  expect(drawn).toContain(`"${TASK_BOX.done}"`);
  expect(drawn).toContain('"If you want to rebase/retry this PR, check this box"');
  expect(drawn).not.toContain("[ ]");
  expect(drawn).not.toContain("[x]");
});
