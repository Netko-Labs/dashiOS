/** Spaces for agents, through the compositor as the shell's own keys go (spaces/). Agents count Spaces from 1. */

import { parseSpaces, spaceLabel } from "../../spaces/model.ts";
import { json, type RunContext, text, type ToolResult, toolError } from "../context.ts";
import { named, noWindow, subject } from "../subject.ts";

async function spaces(ctx: RunContext) {
  return parseSpaces(await ctx.compositor.request("spaces"));
}

export async function listSpaces(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at your Spaces");
  const [state, windows] = await Promise.all([spaces(ctx), ctx.compositor.windows()]);
  if (!state) return toolError("The compositor did not say what Spaces there are.");
  return json({
    spaces: Array.from({ length: state.count }, (_, index) => ({
      space: index + 1,
      name: spaceLabel(index),
      current: index === state.current,
      windows: windows.filter((window) => (window.space ?? state.current) === index).map((window) => `w${window.id}`),
    })),
  });
}

export async function switchSpace(space: number, ctx: RunContext): Promise<ToolResult> {
  const state = await spaces(ctx);
  if (!state || space >= state.count) return toolError(`There is no Space ${space + 1}; list_spaces shows the ${state?.count ?? 1} there are.`);
  ctx.status(`Switching to ${spaceLabel(space)}`);
  await ctx.compositor.request("space-switch", { space });
  return text(`${spaceLabel(space)} shows now.`);
}

export async function moveWindowToSpace(id: number, space: number, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, id);
  if (!window) return noWindow(id);
  const state = await spaces(ctx);
  if (!state || space >= state.count) return toolError(`There is no Space ${space + 1}; list_spaces shows the ${state?.count ?? 1} there are.`);
  ctx.status(`Moving ${subject(window, ctx)} to ${spaceLabel(space)}`);
  await ctx.compositor.request("space-move", { window: id, space });
  return text(
    `w${id}${ctx.mayName() ? ` (“${window.title}”)` : ""} is on ${spaceLabel(space)}${space === state.current ? "" : ", off screen until that Space shows"}.`,
  );
}
