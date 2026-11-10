import { planTools } from "../../src/agents/ask/plan.ts";
import { TOOL_ACTIONS } from "../../src/agents/index.ts";

export const TOOLS = planTools(TOOL_ACTIONS);
