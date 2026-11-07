/**
 * The menu bar's recording stop button stays put while agents' pills come
 * and go: it is the last pill, beside the status items, and the bar's row
 * is right-aligned. A press on it stops the recording, an agent's too.
 */

import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { AgentInfo } from "../src/agents/index.ts";
import { BarPills } from "../src/bar-pills.tsx";
import type { RecorderState, ScreenRecorder } from "../src/recorder/recorder.ts";
import { ScreenCaptureStore } from "../src/screen-capture.ts";

const settle = (ms = 20): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The recorder as the stop button sees it: an agent's recording, until stopped. */
function fakeRecorder() {
  let state: RecorderState = { kind: "recording", since: Date.now(), file: "/v/a.mp4", target: { kind: "screen", output: "Virtual-1" }, by: "agent" };
  const listeners = new Set<() => void>();
  let stops = 0;
  const recorder = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    ownsCapture: () => state.kind !== "idle",
    stop: async () => {
      stops++;
      state = { kind: "saving", file: "/v/a.mp4" };
      for (const listener of listeners) listener();
      return "/v/a.mp4";
    },
  };
  return { recorder: recorder as unknown as ScreenRecorder, stops: () => stops };
}

/** The agents' list as a store, so a test can connect and disconnect one. */
function agentList() {
  let agents: AgentInfo[] = [];
  const listeners = new Set<() => void>();
  return {
    set(next: AgentInfo[]) {
      agents = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => agents,
  };
}

const agent = (id: number, status: string): AgentInfo => ({ id, name: "Remote agent", status, scopes: [] });

test("the stop button is the last pill, whatever agents come and go, and a press stops an agent's recording", async () => {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const { recorder, stops } = fakeRecorder();
  const list = agentList();
  function Bar() {
    const agents = useSyncExternalStore(list.subscribe, list.get);
    return (
      <View style={{ flexDirection: "row" }}>
        <BarPills capture={new ScreenCaptureStore()} recorder={recorder} agents={agents} onStopAgent={() => {}} />
        <View testID="status-area" />
      </View>
    );
  }
  const root = render(<Bar />, transport);
  await settle();
  const order = () => {
    const tree = trees.at(-1) ?? "";
    const at = (needle: string) => tree.indexOf(needle);
    const node = (testID: string) => at(`"id":"${root.nodeId(testID) ?? "none"}"`);
    return { stop: node("recording-stop"), agent: at("Taking a screenshot"), recording: at("Recording the screen"), status: node("status-area") };
  };
  expect(order().stop).toBeGreaterThan(-1);

  list.set([agent(1, "Recording the screen"), agent(2, "Taking a screenshot")]);
  await settle();
  let now = order();
  expect(now.recording).toBeGreaterThan(-1);
  expect(now.agent).toBeGreaterThan(now.recording);
  // After every agent's pill, just before the status items.
  expect(now.stop).toBeGreaterThan(now.agent);
  expect(now.stop).toBeLessThan(now.status);

  list.set([agent(1, "Recording the screen")]);
  await settle();
  now = order();
  expect(now.agent).toBe(-1);
  expect(now.stop).toBeGreaterThan(now.recording);

  const id = root.nodeId("recording-stop");
  if (!id) throw new Error("no stop button");
  for (const listener of listeners) listener({ type: "press", nodeId: id });
  await settle();
  expect(stops()).toBe(1);
  expect(trees.at(-1)).toContain("Saving…");
  root.unmount();
});
