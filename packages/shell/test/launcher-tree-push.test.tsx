import { afterEach, expect, test } from "bun:test";
import { parseTree, type ViewNode } from "@dashi/applet";
import type { TreeActed, TreeSnapshot, TreeView } from "../src/actions/index.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import type { Row } from "../src/launcher/row-model.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

// Pass 42: ↩ on a repository ("Show Pull Requests") pushed its pull requests, but the field kept the
// repository's name, which filtered every one away; keys typed meanwhile searched repositories again;
// and ↩ or ❖↩ on the launcher's own row ("Nothing in …", the list loading) ran the view's Settings
// actions, so the field asked for "Repository" or "GitHub token".

afterEach(() => unmountLauncher());

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

const action = (i: string, title: string, kind: string, extra: Record<string, unknown> = {}) => ({ t: "Action", i, p: { title, kind, ...extra } });
const settings = (n: string) => ({
  t: "ActionPanel",
  i: `settings${n}`,
  c: [action(`repo${n}`, "Choose Repository…", "set", { target: "repo" }), action(`token${n}`, "Use a GitHub Token…", "set", { target: "token" })],
});

const REPOS = tree({
  t: "List",
  i: "repos",
  p: { filter: "extension" },
  c: [
    {
      t: "Item",
      i: "k:renovatebot-renovate",
      p: { title: "renovatebot/renovate" },
      c: [{ t: "ActionPanel", i: "pr", c: [action("show", "Show Pull Requests", "push")] }],
    },
  ],
});

const prs = (loading: boolean) =>
  tree({
    t: "List",
    i: "prs",
    p: { filter: "launcher", loading },
    c: [
      settings("1"),
      {
        t: "Section",
        i: "s",
        p: { title: "Open in renovatebot/renovate" },
        c: loading ? [] : [{ t: "Item", i: "k:47608", p: { title: "Update dependency", keywords: ["47608"] } }],
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
  constructor(stack: ViewNode[]) {
    this.state = { stack, phase: "shown", since: 0 };
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
  // As the session does: the action is answered first, the pushed view comes after.
  act = async (node: string): Promise<TreeActed> => {
    this.acted.push(node);
    return node.startsWith("repo") || node.startsWith("token") ? { kind: "ask", name: node, title: node, secret: false } : { kind: "done" };
  };
  setPreference = async () => true;
  back = () => false;
  close = () => {};
}

const row = (id: string): Row => ({ id, title: "", kind: "", icon: { none: true }, action: { kind: "scope", verb: "first" } });

test("a pushed view starts with an empty field; what was typed after ↩ stays and is not searched here", async () => {
  const view = new FakeView([REPOS]);
  const scope = treeScope("Search GitHub Repositories", view);
  const ids = ["tree:k:renovatebot-renovate", "tree:k:47608", "tree:loading"];
  const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, ids);
  await launcher.type("renovatebot/renovate");
  expect(view.searched.at(-1)).toBe("renovatebot/renovate");
  await launcher.enter();
  expect(view.acted).toEqual(["show"]);
  // Typed before the pull requests came: not a repository search.
  await launcher.type("renovatebot/renovate4760");
  expect(view.searched).not.toContain("renovatebot/renovate4760");
  view.set({ stack: [REPOS, prs(true)] });
  await launcher.type("renovatebot/renovate4760");
  expect(launcher.tree()).toContain('"value":"4760"');
  expect(launcher.tree()).toContain("Loading…");
  expect(launcher.tree()).not.toContain("Nothing in GitHub");
  // ↩ while the list loads asks for nothing.
  await launcher.enter();
  expect(view.acted).toEqual(["show"]);
  expect(launcher.tree()).not.toContain("Return keeps it");
  view.set({ stack: [REPOS, prs(false)] });
  await launcher.type("4760");
  expect(launcher.rows().ids).toContain("tree:k:47608");
});

test("the launcher's own rows (Loading…, Nothing in …) carry none of the view's actions", () => {
  const view = new FakeView([prs(true)]);
  const scope = treeScope("Pull Requests", view);
  expect(scope.sections("").flatMap((section) => section.rows.map((each) => each.id))).toEqual(["tree:loading"]);
  expect(scope.verbs(row("tree:loading"), "")).toEqual([]);
  expect(scope.hints?.(row("tree:loading"))).toEqual([]);
  view.set({ stack: [prs(false)] });
  expect(scope.sections("nothing like it").flatMap((section) => section.rows.map((each) => each.title))).toEqual(["Nothing in GitHub for “nothing like it”"]);
  expect(scope.verbs(row("tree:empty"), "")).toEqual([]);
  // An item still has the view's actions after its own (❖K).
  expect(scope.verbs(row("tree:k:47608"), "").map((verb) => verb.title)).toEqual(["Choose Repository…", "Use a GitHub Token…"]);
});
