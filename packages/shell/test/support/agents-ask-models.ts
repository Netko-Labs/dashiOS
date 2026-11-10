import type { PlanTool } from "../../src/agents/ask/answerer.ts";

export const TOOLS: PlanTool[] = [
  { name: "lock_screen", description: "Lock the screen", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];

export const signal = () => new AbortController().signal;
