/** How a tool call is carried out: one handler for each tool, written next to the others of its kind (run.ts joins them). */

import type { RunContext, ToolResult } from "./context.ts";
import type { Call, ToolName } from "./tools/index.ts";

/** The `Call` of tool `N` (one variant may serve several names: `focus_window` and its kin). */
export type CallOf<N extends ToolName> = Call extends infer C ? (C extends { name: infer M } ? (N extends M ? C : never) : never) : never;

export type Handler<N extends ToolName> = (call: CallOf<N>, ctx: RunContext) => Promise<ToolResult> | ToolResult;

/** A handler for each of these tools. */
export type Handlers<Names extends ToolName> = { [N in Names]: Handler<N> };
