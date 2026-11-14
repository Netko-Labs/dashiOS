/**
 * The agents' tools as actions, and `tools/list` written from actions.
 *
 * Every tool (agents/tools/) becomes an action at `dashi://tool/<name>`
 * with the tool's own schema, scope, and check. The tools a person would
 * use as commands too are `who: "both"` here; they run as the person
 * (agents/server.ts `runAsPerson`), and the ones that ask an agent every
 * time ask the person on a sheet of their own. The rest (pictures, the
 * agent's own pointer, sign-in, paying) stay the agents'.
 *
 * `mcpListing` is the MCP side: what `tools/list` answers, written from the
 * actions that name a tool, in the shape MCP has always seen (the test
 * holds it to the 0.3 list byte for byte).
 */

import { checkToolArgs, isCallError, type ToolDef } from "../agents/tools/define.ts";
import type { ToolName } from "../agents/tools/types.ts";
import { formatAddress, slug } from "./address.ts";
import { type ActionDef, type ActionKind, failed, invalid, ok, ready } from "./types.ts";

/** Tools that are a person's commands too, and what kind of row each is. */
export const PERSON_TOOLS: Readonly<Partial<Record<ToolName, ActionKind>>> = {
  launch_app: "open",
  focus_window: "open",
  minimize_window: "run",
  close_window: "run",
  tile_window: "run",
  force_quit_app: "run",
  lock_screen: "run",
  switch_space: "open",
  move_window_to_space: "run",
  work_in_space: "run",
  set_display_scale: "pick",
  set_display_rotation: "pick",
  set_primary_display: "pick",
  clear_notifications: "run",
  set_setting: "pick",
  join_wifi: "run",
  set_time_zone: "pick",
  set_clock_24_hour: "toggle",
  set_region_formats: "pick",
  open_setup_assistant: "open",
  set_bluetooth_connection: "toggle",
  set_sound_output: "pick",
  set_volume: "run",
  set_power_profile: "pick",
  create_note: "run",
  open_in_preview: "open",
  request_software_install: "run",
  request_software_update: "run",
  open_file: "open",
  trash_file: "run",
};

/** Tools that ask on a sheet every time they run, whoever asked (they call `ctx.confirm`). */
export const ASKS_EVERY_TIME: ReadonlySet<ToolName> = new Set<ToolName>([
  "force_quit_app",
  "trash_file",
  "request_software_install",
  "request_software_update",
  "read_clipboard_history",
]);

/** A tool's address: `dashi://tool/force-quit-app`. */
export const toolAddress = (name: ToolName): string => formatAddress(["tool", slug(name) ?? name]);

/** One tool as an action. */
export function toolAction(def: ToolDef): ActionDef {
  const kind = PERSON_TOOLS[def.name];
  return {
    address: toolAddress(def.name),
    title: def.title,
    description: def.description,
    keywords: { en: def.title.toLowerCase().split(/\s+/) },
    kind: kind ?? "run",
    properties: def.properties,
    ...(def.required ? { required: def.required } : {}),
    scope: def.scope,
    readOnly: def.readOnly,
    destructive: def.destructive,
    ...(def.idempotent !== undefined ? { idempotent: def.idempotent } : {}),
    ...(ASKS_EVERY_TIME.has(def.name) ? { asksEveryTime: true as const } : {}),
    who: kind ? "both" : "agents",
    source: "tools",
    tool: def.name,
    check(args) {
      const call = checkToolArgs(def, args);
      if (isCallError(call)) return invalid("arguments" in call ? call.arguments : `Unknown tool: ${call.unknown}`);
      return ready(async (ctx) => {
        if (!ctx.tool) return failed("This needs Dashi's compositor, which isn't running.");
        const result = await ctx.tool(call);
        const words = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
        return result.isError ? failed(words) : ok(words);
      });
    },
  };
}

/** One entry of `tools/list`, in the shape MCP clients see. */
export interface McpTool {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
}

/** `tools/list` for one action: exactly what MCP clients saw from agents/tools/define.ts's `listing`. */
export function mcpTool(action: ActionDef & { tool: ToolName }): McpTool {
  return {
    name: action.tool,
    title: action.title,
    description: action.description,
    inputSchema: { type: "object", properties: action.properties, required: [...(action.required ?? [])], additionalProperties: false },
    annotations: {
      title: action.title,
      readOnlyHint: action.readOnly,
      destructiveHint: action.destructive,
      idempotentHint: action.idempotent ?? action.readOnly,
      openWorldHint: false,
    },
  };
}

const isTool = (action: ActionDef): action is ActionDef & { tool: ToolName } => action.tool !== undefined && action.who !== "person";

/** `tools/list`: the actions agents may call, in order. */
export function mcpListing(actions: readonly ActionDef[]): ReturnType<typeof mcpTool>[] {
  return actions.filter(isTool).map(mcpTool);
}
