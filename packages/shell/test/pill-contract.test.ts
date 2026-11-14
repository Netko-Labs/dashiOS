/** The night build's hub (shared/pill; docs/night-0.9-contract.md): cells tell their readers, ports reach their one handler. */

import { expect, test } from "bun:test";
import { readSettings } from "../src/settings-app/sections.ts";
import { createPillHub, DEFAULT_PERSONA, type DictationState, type KeyGesture } from "../src/shared/pill/index.ts";

test("a hub starts idle, with Dashi's own persona", () => {
  const hub = createPillHub();
  expect(hub.dictation.getSnapshot()).toEqual({ phase: "idle" });
  expect(hub.voiceMode.getSnapshot()).toEqual({ phase: "idle" });
  expect(hub.asks.getSnapshot()).toEqual([]);
  expect(hub.bar.getSnapshot()).toEqual({ mode: "rest" });
  expect(hub.persona.getSnapshot()).toBe(DEFAULT_PERSONA);
});

test("a cell tells its readers once per change, and not after they leave", () => {
  const hub = createPillHub();
  let told = 0;
  const off = hub.dictation.subscribe(() => told++);
  const listening: DictationState = { phase: "listening", text: "", handsFree: false, endsAt: null, hint: null };
  hub.dictation.set(listening);
  hub.dictation.set(listening);
  expect(told).toBe(1);
  expect(hub.dictation.getSnapshot()).toBe(listening);
  off();
  hub.dictation.set({ phase: "idle" });
  expect(told).toBe(1);
});

test("a port drops a message until its owner handles it, and listeners hear it either way", () => {
  const hub = createPillHub();
  const heard: KeyGesture[] = [];
  hub.keys.listen((gesture) => heard.push(gesture));
  expect(hub.dictationCommands.send({ do: "copy" })).toBe(false);
  const got: string[] = [];
  const stop = hub.dictationCommands.handle((command) => got.push(command.do));
  expect(hub.dictationCommands.send({ do: "finish" })).toBe(true);
  stop();
  expect(hub.dictationCommands.send({ do: "dismiss" })).toBe(false);
  expect(got).toEqual(["finish"]);
  expect(hub.keys.send({ key: "dictation", gesture: "double-tap", at: 12 })).toBe(false);
  expect(heard).toEqual([{ key: "dictation", gesture: "double-tap", at: 12 }]);
});

test("settings.json keeps dictation's and the persona's keys, and drops a bad value", () => {
  const data = readSettings({
    dictation: { on: true, key: "caps-lock", handsFree: false, tidy: true },
    persona: { name: "Miso", character: "calm", colour: "#0F766E", mark: "spark", talk: "less" },
  });
  expect(data.dictation).toEqual({ on: true, key: "caps-lock", handsFree: false, tidy: true });
  expect(data.persona).toEqual({ name: "Miso", character: "calm", colour: "#0F766E", mark: "spark", talk: "less" });
  const bad = readSettings({ dictation: { key: "space" }, persona: { colour: "purple", name: "" } });
  expect(bad.dictation.key).toBeUndefined();
  expect(bad.persona.colour).toBeUndefined();
  expect(bad.persona.name).toBeUndefined();
});
