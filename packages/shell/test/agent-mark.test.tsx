/**
 * The menu bar's one mark for every agent (agents/mark.ts, agent-mark.tsx):
 * runs and connections merged into one list, the mark's states (idle,
 * working, needs you, the red dot, overlapping discs and "+N"), and the
 * recordings: the person's own keeps its timer pill, an agent's folds into
 * the mark's red dot, and is never out of sight.
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { AgentMark } from "../src/agent-mark.tsx";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentInfo } from "../src/agents/index.ts";
import { accessWords, agentRecording, connectionHarness, markState, mergeAgents, recordingPill, watchingOf } from "../src/agents/mark.ts";
import { settle } from "./support/time.ts";

const connection = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: "Remote agent",
  status: "Connected",
  scopes: [],
  detail: "connected over SSH",
  remote: true,
  claims: "claude-ai",
  harness: null,
  since: id,
  ...extra,
});

/** A run from the launcher, working: `id` started at `at`. */
function runs(...list: Array<{ id: string; at: number; harness?: "claude-code" | "codex" }>) {
  const store = new AgentRuns({ now: () => 0 });
  for (const { id, at, harness = "claude-code" } of list)
    store.start({ id, request: "Cut the demo video", harness, harnessName: harness === "codex" ? "Codex" : "Claude Code", started: at });
  return store;
}

describe("one list of agents", () => {
  test("runs and connections, once each: a run's own connection folds into its run", () => {
    const store = runs({ id: "r1", at: 100 });
    const list = mergeAgents(
      [connection(1, { task: "r1", name: "claude", status: "Recording the screen", watching: "recording" }), connection(2)],
      store.getSnapshot(),
    );
    expect(list.map((entry) => entry.key)).toEqual(["run:r1", "agent:2"]);
    // What the run's connection does shows on the run.
    expect(list[0]?.watching).toBe("recording");
    expect(list[1]).toMatchObject({ kind: "connection", name: "Remote agent", phase: "idle", doing: "Connected" });
  });

  test("a connection whose run ended is still connected, and still listed", () => {
    const store = runs({ id: "r1", at: 100 });
    store.event("r1", { kind: "done", text: "ok" });
    const list = mergeAgents([connection(1, { task: "r1" })], store.getSnapshot());
    expect(list.map((entry) => entry.key)).toEqual(["agent:1"]);
  });

  test("waiting on the person first, then working, then idle; newest first in each", () => {
    const store = runs({ id: "old", at: 1 }, { id: "new", at: 2 });
    const list = mergeAgents(
      [connection(3), connection(4, { status: "Taking a screenshot" }), connection(5, { waiting: true, status: "Waiting for you" })],
      store.getSnapshot(),
    );
    expect(list.map((entry) => entry.key)).toEqual(["agent:5", "agent:4", "run:new", "run:old", "agent:3"]);
    expect(list.map((entry) => entry.phase)).toEqual(["waiting", "working", "working", "working", "idle"]);
  });

  test("a run waiting on a question waits on the person", () => {
    const store = runs({ id: "r1", at: 1 });
    store.ask("r1", { kind: "site", title: "Use x?", detail: "", choices: [], needs: "needs you" });
    expect(mergeAgents([], store.getSnapshot())[0]).toMatchObject({ phase: "waiting", doing: "Waiting for you" });
  });
});

describe("the mark", () => {
  test("none without agents", () => {
    expect(markState([])).toEqual({ kind: "none" });
  });

  test("idle: the mark alone, no ring, no dot", () => {
    expect(markState(mergeAgents([connection(1)], []))).toMatchObject({
      kind: "mark",
      discs: [null],
      more: 0,
      working: false,
      watching: false,
      tip: "Remote agent · Connected",
    });
  });

  test("working: the ring turns", () => {
    expect(markState(mergeAgents([connection(1, { status: "Opening Notes" })], []))).toMatchObject({
      kind: "mark",
      working: true,
      tip: "Remote agent · Opening Notes",
    });
    expect(markState(mergeAgents([], runs({ id: "r", at: 1 }).getSnapshot()))).toMatchObject({ working: true });
  });

  test("needs you: amber words, the only time it has words", () => {
    const state = markState(mergeAgents([connection(1, { waiting: true, status: "Waiting for you", harness: "codex" })], []));
    expect(state).toMatchObject({ kind: "ask", harness: "codex", watching: false });
  });

  test("the red dot: an agent sees or records the screen, or uses its pointer; or the recorder records for one", () => {
    for (const watching of ["recording", "screen", "pointer"] as const) {
      expect(markState(mergeAgents([connection(1, { watching })], []))).toMatchObject({ watching: true });
    }
    expect(markState(mergeAgents([connection(1)], []), true)).toMatchObject({ watching: true });
    // Never hidden behind the amber words either.
    expect(markState(mergeAgents([connection(1, { waiting: true, watching: "screen" })], []))).toMatchObject({ kind: "ask", watching: true });
  });

  test("discs overlap, up to three, then +N; the lead first", () => {
    const five = [1, 2, 3, 4, 5].map((id) => connection(id, { harness: id === 5 ? "codex" : null }));
    const state = markState(mergeAgents(five, []));
    expect(state).toMatchObject({ kind: "mark", discs: ["codex", null, null], more: 2, tip: "Remote agent · Connected, and 4 more" });
    expect(markState(mergeAgents(five.slice(0, 3), []))).toMatchObject({ more: 0 });
  });

  test("its row's chip says the access it has now", () => {
    expect(accessWords({ watching: "recording", phase: "working", kind: "connection" })).toBe("Recording the screen");
    expect(accessWords({ watching: null, phase: "waiting", kind: "connection" })).toBe("Waiting for you");
    expect(accessWords({ watching: null, phase: "idle", kind: "connection" })).toBe("Connected");
  });

  test("a connection's harness, from its process or the name it claims", () => {
    expect(connectionHarness("claude", null)).toBe("claude-code");
    expect(connectionHarness("node", "claude-code")).toBe("claude-code");
    expect(connectionHarness("codex", null)).toBe("codex");
    expect(connectionHarness("node", "codex-mcp-client")).toBe("codex");
    expect(connectionHarness("opencode", null)).toBe("opencode");
    // Claude on a phone is not Claude Code: the sparkle.
    expect(connectionHarness("Remote agent", "claude-ai")).toBeNull();
  });

  test("which calls light the red dot", () => {
    expect(watchingOf("record_screen")).toBe("recording");
    expect(watchingOf("screenshot")).toBe("screen");
    expect(["click", "drag", "scroll", "type_text", "press_keys"].map(watchingOf)).toEqual(["pointer", "pointer", "pointer", "pointer", "pointer"]);
    expect(watchingOf("list_windows")).toBeNull();
  });
});

describe("recordings", () => {
  test("the person's own keeps its timer pill, mark or not", () => {
    expect(recordingPill({ kind: "recording", by: "person" }, true)).toBe(true);
    expect(recordingPill({ kind: "saving", by: "person" }, false)).toBe(true);
    expect(agentRecording({ kind: "recording", by: "person" })).toBe(false);
  });

  test("an agent's folds into the mark's red dot", () => {
    expect(recordingPill({ kind: "recording", by: "agent" }, true)).toBe(false);
    expect(agentRecording({ kind: "recording", by: "agent" })).toBe(true);
    expect(markState(mergeAgents([connection(1)], []), agentRecording({ kind: "recording", by: "agent" }))).toMatchObject({ watching: true });
  });

  test("an agent's with no mark up to carry it keeps the pill: a recording is never out of sight", () => {
    expect(recordingPill({ kind: "recording", by: "agent" }, false)).toBe(true);
  });

  test("nothing while idle or starting", () => {
    expect(recordingPill({ kind: "idle" }, false)).toBe(false);
    expect(recordingPill({ kind: "starting", by: "person" }, false)).toBe(false);
  });
});

describe("the drawn mark", () => {
  function host() {
    const trees: string[] = [];
    const listeners: ((event: NativeEvent) => void)[] = [];
    const transport: NativeTransport = {
      send: (tree) => trees.push(tree),
      onEvent: (listener) => listeners.push(listener),
      onClose() {},
      simulate() {},
      close() {},
    };
    return { trees, listeners, transport };
  }

  test("the red dot is drawn; a press says the mark's right edge; hovering says who", async () => {
    const { trees, listeners, transport } = host();
    const presses: number[] = [];
    const tips: Array<string | null> = [];
    const state = markState(mergeAgents([connection(1, { status: "Recording the screen", watching: "recording" })], []));
    if (state.kind === "none") throw new Error("no agents");
    const root = render(
      <AgentMark
        need={0}
        watching={state.watching}
        open={false}
        label={state.label}
        tip={state.tip}
        onPress={(right) => presses.push(right)}
        onTip={(tip) => tips.push(tip?.text ?? null)}
      />,
      transport,
    );
    await settle();
    expect(root.nodeId("agent-mark-dot")).toBeDefined();
    // Words only in the tip, never in the bar.
    expect(trees.at(-1)).not.toContain("Recording the screen");
    const mark = root.nodeId("agent-mark");
    if (!mark) throw new Error("no mark");
    for (const listener of listeners) listener({ type: "hover", nodeId: mark, hovered: true, bounds: { x: 900, y: 3, width: 28, height: 22 } });
    for (const listener of listeners) listener({ type: "press", nodeId: mark, bounds: { x: 900, y: 3, width: 28, height: 22 } });
    await settle();
    expect(tips).toEqual(["Remote agent · Recording the screen", null]);
    expect(presses).toEqual([928]);
    root.unmount();
  });

  test("at rest it is the spark alone: no count, no dot, no words", async () => {
    const { trees, transport } = host();
    const root = render(<AgentMark need={0} watching={false} open={false} label="Ask Dashi" tip="" onPress={() => {}} />, transport);
    await settle();
    expect(root.nodeId("agent-mark")).toBeDefined();
    expect(root.nodeId("agent-mark-count")).toBeUndefined();
    expect(root.nodeId("agent-mark-dot")).toBeUndefined();
    expect(trees.at(-1)).not.toContain("?");
    root.unmount();
  });

  test("it draws the glyph it is given (the persona's mark), and the spark without one", async () => {
    const { trees, transport } = host();
    const moon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000"><path d="M20.5 14.6A9 9 0 1 1 9.4 3.5a7.2 7.2 0 0 0 11.1 11.1Z"/></svg>';
    const root = render(<AgentMark need={0} watching={false} open={false} glyph={moon} label="Ask Miso" tip="" onPress={() => {}} />, transport);
    await settle();
    expect(trees.at(-1)).toContain("M20.5 14.6A9 9");
    root.unmount();
    const plain = render(<AgentMark need={0} watching={false} open={false} label="Ask Dashi" tip="" onPress={() => {}} />, transport);
    await settle();
    expect(trees.at(-1)).not.toContain("M20.5 14.6A9 9");
    plain.unmount();
  });

  test("needs you: amber, and it counts", async () => {
    const { trees, transport } = host();
    const root = render(<AgentMark need={3} watching={false} open={false} label="Dashi: 3 jobs need you" tip="" onPress={() => {}} />, transport);
    await settle();
    expect(root.nodeId("agent-mark-count")).toBeDefined();
    expect(trees.at(-1)).toContain('"3"');
    expect(trees.at(-1)?.toLowerCase()).toContain("#f0b93c");
    root.unmount();
  });
});

describe("the panel", () => {
  test("a connected agent is a row with its access, where it's from, and Stop; runs keep their cards; Stop all", async () => {
    const { AgentsPanel } = await import("../src/agents-panel/agents-panel.tsx");
    const trees: string[] = [];
    const listeners: ((event: NativeEvent) => void)[] = [];
    const transport: NativeTransport = {
      send: (tree) => trees.push(tree),
      onEvent: (listener) => listeners.push(listener),
      onClose() {},
      simulate() {},
      close() {},
    };
    const store = runs({ id: "r1", at: 1 });
    const connected = [connection(7, { status: "Recording the screen", watching: "recording" })];
    const agents = { subscribe: () => () => {}, getSnapshot: () => connected };
    const stopped: string[] = [];
    const actions = {
      answer() {},
      stop: (run: string) => stopped.push(`run:${run}`),
      show() {},
      undo() {},
      stopAgent: (id: number) => stopped.push(`agent:${id}`),
      stopAll: () => stopped.push("all"),
    };
    const root = render(<AgentsPanel runs={store} agents={agents} right={1000} focus={null} actions={actions} onClose={() => {}} />, transport);
    await settle();
    const tree = trees.at(-1) ?? "";
    expect(root.nodeId("agents-row:7")).toBeDefined();
    expect(root.nodeId("agents-card:r1")).toBeDefined();
    expect(tree).toContain("Recording the screen");
    expect(tree).toContain("“claude-ai”, connected over SSH");
    expect(root.nodeId("agents-dot")).toBeDefined();
    for (const id of ["agents-stop-agent:7", "agents-stop-all"]) {
      const node = root.nodeId(id);
      if (!node) throw new Error(`no ${id}`);
      for (const listener of listeners) listener({ type: "press", nodeId: node });
    }
    expect(stopped).toEqual(["agent:7", "all"]);
    root.unmount();
  });
});
