/**
 * The menu bar has one sign for every agent from outside (decisions.md
 * D138): never a capsule each, the mark with a count, amber with a count
 * when several wait on the person; and the panel behind it has one row per
 * agent (D137).
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { AgentMark } from "../src/agent-mark.tsx";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentInfo } from "../src/agents/index.ts";
import { mergeAgents, outsideAgents } from "../src/agents/mark.ts";
import { agentJobs, needCount } from "../src/menubar/lib/bar-jobs.ts";
import { settle } from "./support/time.ts";

const claude = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: "claude",
  key: "/home/alexk/.local/bin/claude",
  status: "Idle",
  scopes: [],
  detail: "~/.local/bin/claude",
  claims: "claude-code",
  harness: "claude-code",
  since: id,
  quiet: false,
  acted: 1000 + id,
  ...extra,
});
const idle = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => claude(id, { status: "Connected", quiet: true, acted: undefined, ...extra });

describe("one sign in the bar (D138)", () => {
  test("an agent from outside is never a job capsule, whatever it does; a run from the launcher still is", () => {
    const runs = new AgentRuns({ now: () => 0 });
    runs.start({ id: "r1", request: "Cut the demo video", harness: "claude-code", harnessName: "Claude Code", started: 1 });
    const five = [1, 2, 3, 4, 5].map((id) => claude(id, { status: "Taking a screenshot", watching: "screen" }));
    const codex = claude(6, { name: "codex", key: "/usr/bin/codex", claims: "codex", harness: "codex", waiting: true });
    const entries = mergeAgents([...five, codex], runs.getSnapshot());
    expect(agentJobs(entries).map((job) => job.key)).toEqual(["run:r1"]);
    expect(outsideAgents(entries)).toEqual({ sessions: 6, harness: "codex", waiting: 1 });
    // Two consents at once are one amber mark that counts them.
    expect(needCount([], [], 2)).toBe(2);
    expect(needCount(agentJobs(entries), [], outsideAgents(entries).waiting)).toBe(1);
  });

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

  test("five sessions at work are one mark with a 5; a press there opens their panel, a press on the spark the field", async () => {
    const { listeners, transport } = host();
    const opened: string[] = [];
    const root = render(
      <AgentMark
        need={0}
        watching={false}
        open={false}
        label="Ask Dashi"
        tip=""
        agents={{ sessions: 5, harness: "claude-code" }}
        onAgents={(right) => opened.push(`panel:${right}`)}
        onPress={(right) => opened.push(`field:${right}`)}
      />,
      transport,
    );
    await settle();
    expect(root.nodeId("agent-mark")).toBeDefined();
    expect(root.nodeId("agent-mark-sessions")).toBeDefined();
    for (const id of ["agent-mark-agents", "agent-mark-spark"]) {
      const node = root.nodeId(id);
      if (!node) throw new Error(`no ${id}`);
      for (const listener of listeners) listener({ type: "press", nodeId: node, bounds: { x: 900, y: 3, width: 40, height: 22 } });
    }
    expect(opened).toEqual(["panel:940", "field:940"]);
    root.unmount();
  });

  test("one session shows its glyph and no count; none, the spark alone; a question, amber with its count and nothing else", async () => {
    const { trees, transport } = host();
    const one = render(
      <AgentMark need={0} watching={false} open={false} label="" tip="" agents={{ sessions: 1, harness: null }} onPress={() => {}} />,
      transport,
    );
    await settle();
    expect(one.nodeId("agent-mark-agents")).toBeDefined();
    expect(one.nodeId("agent-mark-sessions")).toBeUndefined();
    one.unmount();
    const none = render(
      <AgentMark need={0} watching={false} open={false} label="" tip="" agents={{ sessions: 0, harness: null }} onPress={() => {}} />,
      transport,
    );
    await settle();
    expect(none.nodeId("agent-mark-agents")).toBeUndefined();
    none.unmount();
    const asking = render(
      <AgentMark need={2} watching={false} open={false} label="" tip="" agents={{ sessions: 5, harness: null }} onPress={() => {}} />,
      transport,
    );
    await settle();
    expect(asking.nodeId("agent-mark-count")).toBeDefined();
    expect(asking.nodeId("agent-mark-agents")).toBeUndefined();
    expect(trees.at(-1)).toContain('"2"');
    asking.unmount();
  });

  test("the panel: one row for three sessions, Stop cuts off all three, and the idle ones are a line at the foot", async () => {
    const { AgentsPanel } = await import("../src/agents-panel/agents-panel.tsx");
    const { trees, listeners, transport } = host();
    const connected = [claude(1), claude(2, { status: "Recording the screen", watching: "recording" }), claude(3), idle(4), idle(5)];
    const stopped: number[] = [];
    const actions = { answer() {}, stop() {}, show() {}, undo() {}, stopAgent: (id: number) => stopped.push(id), stopAll() {} };
    const root = render(
      <AgentsPanel
        runs={new AgentRuns({ now: () => 0 })}
        agents={{ subscribe: () => () => {}, getSnapshot: () => connected }}
        right={1000}
        focus={null}
        actions={actions}
        onClose={() => {}}
      />,
      transport,
    );
    await settle();
    const tree = trees.at(-1) ?? "";
    expect(tree).toContain("claude · 3 sessions");
    expect(tree).toContain("Recording the screen");
    expect(tree).toContain("2 more connected, idle");
    expect(root.nodeId("agents-row:2")).toBeDefined();
    expect(root.nodeId("agents-row:1")).toBeUndefined();
    const stop = root.nodeId("agents-stop-agent:2");
    if (!stop) throw new Error("no Stop");
    for (const listener of listeners) listener({ type: "press", nodeId: stop });
    expect(stopped.sort()).toEqual([1, 2, 3]);
    root.unmount();
  });
});
