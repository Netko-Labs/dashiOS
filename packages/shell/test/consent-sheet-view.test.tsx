import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { SCOPES } from "../src/agents/consent.ts";
import type { Allow, Ask } from "../src/agents/presence.ts";
import { ConsentSheet } from "../src/consent.tsx";

// The agents' consent sheet on a stand-in for the Metal host: every other permission in view once opened, and ticks.

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 20));

test("Other permissions opens every one of them at once, a tick each, and the answer carries the ticks", async () => {
  const ask: Ask = {
    agent: 1,
    who: { name: "vm-agent", detail: "connected over SSH", claims: null, remote: true },
    scopes: SCOPES.map((scope) => ({ id: scope.id, label: scope.label, detail: scope.detail, checked: scope.id === "act", needed: scope.id === "act" })),
  };
  const answers: Array<[Allow, string[]]> = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(<ConsentSheet ask={ask} onAnswer={(allow, scopes) => answers.push([allow, scopes])} />, transport);
  await settle();
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const press = (testID: string) => emit({ type: "press", nodeId: root.nodeId(testID) ?? "" });
  const others = SCOPES.filter((scope) => scope.id !== "act");

  expect(root.lastTree()).toContain(`Other permissions (${others.length})…`);
  expect(root.nodeId("consent-scope:screen")).toBeUndefined();
  await press("consent-more");
  for (const scope of others) expect(root.nodeId(`consent-scope:${scope.id}`)).toBeDefined();
  // What the pointed-at one allows, on a line of its own that keeps its height.
  expect(root.lastTree()).toContain("Point at one to see what it allows.");
  await emit({ type: "hover", nodeId: root.nodeId("consent-scope:screen") ?? "", hovered: true });
  expect(root.lastTree()).toContain("Screenshots of the screen");

  await press("consent-scope:screen");
  await press("consent-scope:notes");
  await press("consent-always");
  expect(answers).toEqual([["always", ["act", "screen", "notes"]]]);
  root.unmount();
});
