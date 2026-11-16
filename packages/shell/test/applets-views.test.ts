import { describe, expect, test } from "bun:test";
import { type AppletCommand, type Manifest, parseManifest, type ViewShellMessage } from "@dashi/applet";
import type { Shown, TreeView } from "../src/actions/index.ts";
import { ExtensionViews, IDLE_STOP_MS, START_TIMEOUT_MS } from "../src/applets/views.ts";

function manifest(): Manifest {
  const parsed = parseManifest({
    id: "dev.example.github",
    name: "GitHub",
    version: "0.1.0",
    dashi: ">=0.9",
    entry: "main.tsx",
    summary: "Pull requests.",
    author: { name: "Alex Kim" },
    shows: ["launcher"],
    permissions: ["network:api.github.com"],
    preferences: [{ name: "token", type: "secret", title: "GitHub token" }],
    commands: [{ id: "prs", title: "Pull Requests", mode: "list" }],
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** Timers the test moves by hand. */
function handTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 0;
  return {
    set: (fn: () => void, ms: number) => {
      pending.set(++next, { at: now + ms, fn });
      return next;
    },
    clear: (handle: unknown) => {
      if (typeof handle === "number") pending.delete(handle);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at > now) continue;
        pending.delete(id);
        timer.fn();
      }
    },
    now: () => now,
  };
}

const list = (title: string) => ({
  t: "List",
  i: "root",
  c: [
    {
      t: "Item",
      i: "i1",
      p: { title },
      c: [{ t: "ActionPanel", i: "ap", c: [{ t: "Action", i: "copy", p: { title: "Copy Link", kind: "copy", content: "https://github.com/x" } }] }],
    },
  ],
});

function setup() {
  const timers = handTimers();
  const calls = { ensure: [] as string[], sleep: [] as string[], copied: [] as string[] };
  const views = new ExtensionViews({
    open: async () => ({ ok: true, text: "" }),
    copy: async (text) => {
      calls.copied.push(text);
      return true;
    },
    preferences: async () => ({ token: "ghp_example" }),
    setPreference: async () => true,
    timers,
    now: timers.now,
  });
  views.connect({ ensure: (id) => calls.ensure.push(id), sleep: (id) => calls.sleep.push(id) });
  const m = manifest();
  const command = m.commands[0] as AppletCommand;
  return { views, timers, calls, m, command };
}

const treeOf = (shown: Shown | undefined): TreeView => {
  if (shown?.kind !== "tree") throw new Error("not a tree view");
  return shown.view;
};

const flush = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

describe("an extension's view", () => {
  test("opening a command starts the extension, sends open with its preferences, and draws its tree", async () => {
    const { views, calls, m, command } = setup();
    const outcome = views.open(m, command, {}, null);
    const view = treeOf(outcome.ok ? outcome.show : undefined);
    expect(view.snapshot().phase).toBe("starting");
    expect(calls.ensure).toEqual(["dev.example.github"]);
    const sent: ViewShellMessage[] = [];
    const peer = views.attach({ manifest: m, send: (message) => sent.push(message) });
    await flush();
    expect(sent[0]).toEqual({ type: "open", seq: 1, command: "prs", args: {}, query: "", preferences: { token: "ghp_example" } });
    expect(peer.receive({ type: "tree", seq: 1, root: { t: "List", i: "root", p: {}, c: [] } })).toBeNull();
    expect(view.snapshot().phase).toBe("shown");
  });

  test("Copy runs in the shell, then the extension hears it; a patch that breaks the tree is refused", async () => {
    const { views, calls, m, command } = setup();
    const sent: ViewShellMessage[] = [];
    const peer = views.attach({ manifest: m, send: (message) => sent.push(message) });
    const outcome = views.open(m, command, {}, null);
    const view = treeOf(outcome.ok ? outcome.show : undefined);
    await flush();
    const parsed = await import("@dashi/applet").then(({ parseTree }) => parseTree(list("Fix the dock")));
    if ("error" in parsed) throw new Error(parsed.error);
    peer.receive({ type: "tree", seq: 1, root: parsed });
    expect(await view.act("copy")).toEqual({ kind: "done", notice: "Copied" });
    expect(calls.copied).toEqual(["https://github.com/x"]);
    expect(sent.at(-1)).toEqual({ type: "event", seq: 1, on: "action", node: "copy" });
    expect(peer.receive({ type: "patch", seq: 1, ops: [{ op: "insert", path: [0], node: { t: "Item", i: "i1", p: { title: "again" } } }] })).toBe(
      "patch: two nodes are “i1”",
    );
    expect(view.snapshot().stack[0]?.c[0]?.p.title).toBe("Fix the dock");
  });

  test("an extension that never connects: the view says so after 10 s", () => {
    const { views, timers, m, command } = setup();
    const outcome = views.open(m, command, {}, null);
    const view = treeOf(outcome.ok ? outcome.show : undefined);
    timers.advance(START_TIMEOUT_MS);
    return flush().then(() => expect(view.snapshot()).toMatchObject({ phase: "failed", error: "GitHub didn't start." }));
  });

  test("a launcher-only extension is stopped a minute after its last view closed, and not before", async () => {
    const { views, timers, calls, m, command } = setup();
    views.attach({ manifest: m, send: () => {} });
    const first = views.open(m, command, {}, null);
    await flush();
    treeOf(first.ok ? first.show : undefined).close();
    timers.advance(IDLE_STOP_MS - 1);
    expect(calls.sleep).toEqual([]);
    // Opened again within the minute: it stays.
    const second = views.open(m, command, {}, null);
    timers.advance(IDLE_STOP_MS);
    expect(calls.sleep).toEqual([]);
    treeOf(second.ok ? second.show : undefined).close();
    timers.advance(IDLE_STOP_MS);
    expect(calls.sleep).toEqual(["dev.example.github"]);
  });

  test("a set action asks for its preference; a stranger's messages are not this view's", async () => {
    const { views, m, command } = setup();
    const own = views.attach({ manifest: m, send: () => {} });
    const outcome = views.open(m, command, {}, null);
    const view = treeOf(outcome.ok ? outcome.show : undefined);
    await flush();
    const { parseTree } = await import("@dashi/applet");
    const root = parseTree({
      t: "Detail",
      i: "d",
      p: { markdown: "# hi" },
      c: [{ t: "ActionPanel", i: "p", c: [{ t: "Action", i: "tok", p: { title: "Use a GitHub Token…", kind: "set", target: "token" } }] }],
    });
    if ("error" in root) throw new Error(root.error);
    own.receive({ type: "tree", seq: 1, root });
    expect(await view.act("tok")).toEqual({ kind: "ask", name: "token", title: "GitHub token", secret: true });
    // Another connection (a stale one, after a restart) can't touch this view.
    const stranger = views.attach({ manifest: { ...m }, send: () => {} });
    expect(stranger.receive({ type: "close", seq: 1 })).toBeNull();
    own.detach();
  });
});
