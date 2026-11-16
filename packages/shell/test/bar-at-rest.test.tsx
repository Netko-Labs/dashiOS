/**
 * Nothing of Dashi's agent in the menu bar at rest (decisions.md D261): no
 * field, no job capsules; the one indicator (D138) shows only while an
 * outside agent, a run, or Dashi kept working on its own acts, and Dashi's
 * own turns in front of the person (the capsule, the launcher) are not it.
 */

import { expect, test } from "bun:test";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import { markState, mergeAgents, outsideAgents } from "../src/agents/mark.ts";
import type { AgentInfo } from "../src/agents/presence.ts";
import { barPill } from "../src/boot/lib/bar-sources.ts";
import * as menubar from "../src/menubar/index.ts";
import { agentMarkSlot } from "../src/menubar/lib/menubar-pill-slots.tsx";
import type { ProgramContext } from "../src/menubar/lib/menubar-program-slots.tsx";

const slotsFor = (agents: readonly AgentInfo[], runs = new AgentRuns({ now: () => 0 })) => {
  const entries = mergeAgents(agents, runs.getSnapshot());
  const context = {
    sources: { output: undefined, menus: { toggleAgents: async () => {} } },
    mark: markState(entries),
    outside: outsideAgents(entries),
    pill: null,
    tip: () => {},
    appName: "Helium",
  } as unknown as ProgramContext;
  return agentMarkSlot(context, false);
};

const dashi = (extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 7,
  name: "Dashi",
  status: "Reading the page",
  scopes: [],
  task: "talk1",
  since: 1,
  acted: 1,
  ...extra,
});

test("the bar has no field and no job capsules any more", () => {
  for (const gone of ["BarField", "BarJobs", "startBarPill", "FIELD_LAYER", "insertWords", "taskFocus"]) expect(gone in menubar).toBe(false);
});

test("at rest the bar shows nothing of Dashi; a run or an outside agent at work is the one indicator", () => {
  expect(slotsFor([])).toEqual([]);
  const runs = new AgentRuns({ now: () => 0 });
  runs.start({ id: "r1", request: "Find flights", harness: "claude-code", harnessName: "Claude Code", started: 1 });
  expect(slotsFor([], runs).map((slot) => slot.key)).toEqual(["agent-mark"]);
  const outside: AgentInfo = { id: 3, name: "claude", status: "Taking a screenshot", scopes: ["screen"], since: 1, acted: 1, harness: "claude-code" };
  expect(slotsFor([outside]).map((slot) => slot.key)).toEqual(["agent-mark"]);
});

test("Dashi in front of the person is not in the bar; kept working on its own, it is", () => {
  let background = false;
  const late = {
    get: () => ({ persona: { subscribe: () => () => {}, getSnapshot: () => ({}) } }),
    peek: (name: string) => (name === "assistant" ? { talk: { id: "talk1" }, background: () => background } : undefined),
  };
  const pill = barPill(late as never);
  expect(pill.foreground("talk1")).toBe(true);
  expect(pill.foreground("r1")).toBe(false);
  const shown = (agents: AgentInfo[]) => slotsFor(agents.filter((agent) => agent.task === undefined || !pill.foreground(agent.task)));
  expect(shown([dashi()])).toEqual([]);
  background = true;
  expect(shown([dashi()]).map((slot) => slot.key)).toEqual(["agent-mark"]);
});
