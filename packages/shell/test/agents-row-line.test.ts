import { expect, test } from "bun:test";
import { type AgentInfo, mergeAgents } from "../src/agents/index.ts";
import { rowLine } from "../src/agents-panel/lib/agents-rows.tsx";

const agent = (over: Partial<AgentInfo>): AgentInfo => ({ id: 7, name: "Remote agent", status: "Connected", scopes: [], ...over });
const lineOf = (over: Partial<AgentInfo>) => {
  const [entry] = mergeAgents([agent(over)], []);
  if (!entry) throw new Error("no entry");
  return rowLine(entry);
};

test("at work on another Desktop the row says the Desktop and who the agent says it is, with no chip to cut them", () => {
  // Space 3 is "Desktop 4"; the row also holds Show and Stop, so the line is short.
  expect(lineOf({ space: 3, status: "Working on Desktop 4", remote: true, claims: "dashi-vm-agent", detail: "connected over SSH" })).toEqual({
    chip: false,
    words: "On Desktop 4 · “dashi-vm-agent”",
  });
  // A remote agent that says no name: the Desktop alone (its title is "Remote agent").
  expect(lineOf({ space: 3, status: "Working on Desktop 4", remote: true })).toEqual({ chip: false, words: "On Desktop 4" });
  // One on this computer: where it runs from.
  expect(lineOf({ space: 1, status: "Working on Desktop 2", detail: "~/.local/bin/claude" }).words).toBe("On Desktop 2 · from ~/.local/bin/claude");
});

test("while it sees the screen from another Desktop, the chip says so and its name follows, short", () => {
  expect(lineOf({ space: 3, status: "Taking a screenshot", watching: "screen", remote: true, claims: "dashi-vm-agent", detail: "connected over SSH" })).toEqual(
    {
      chip: true,
      words: "“dashi-vm-agent”",
    },
  );
});

test("a chip that says more than Connected stays, and a row with no Desktop is as it was", () => {
  // Waiting on the person there: the chip says so, and the line says what it does.
  expect(lineOf({ space: 3, status: "Working on Desktop 4", waiting: true, remote: true, claims: "claude-ai" }).chip).toBe(true);
  expect(lineOf({ remote: true, claims: "claude-ai", detail: "connected over SSH" })).toEqual({ chip: true, words: "“claude-ai”, connected over SSH" });
  expect(lineOf({ status: "Recording the screen", watching: "recording", remote: true, claims: "claude-ai" })).toEqual({
    chip: true,
    words: "“claude-ai”, connected over SSH",
  });
});
