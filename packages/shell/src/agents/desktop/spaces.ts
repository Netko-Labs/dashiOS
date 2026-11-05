/**
 * Spaces for agents, through the compositor as the shell's own keys go
 * (spaces/). Agents count Spaces from 1. A full-screen window's own Desktop
 * (spaces/fullscreen.ts) is listed with its window and named after its app;
 * nothing else goes onto it, and its window stays there until it leaves full screen.
 */

import { parseSpaces, spaceLabel } from "../../spaces/model.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { named, noWindow, subject } from "../subject.ts";

async function spaces(ctx: RunContext) {
  return parseSpaces(await ctx.compositor.request("spaces"));
}

/** What the shell calls Space `index` (a full-screen Desktop after its app), else "Desktop N". */
const nameOf = (index: number, ctx: RunContext): string => ctx.desktop.spaces?.getSnapshot().labels[index] ?? spaceLabel(index);

export async function listSpaces(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at your Spaces");
  const [state, windows] = await Promise.all([spaces(ctx), ctx.compositor.windows()]);
  if (!state) return toolError("The compositor did not say what Spaces there are.");
  const desktops = ctx.desktop.spaces?.getSnapshot();
  return json({
    spaces: Array.from({ length: state.count }, (_, index) => {
      const owner = desktops?.fullscreen[index] ?? null;
      return {
        space: index + 1,
        name: nameOf(index, ctx),
        current: index === state.current,
        ...(owner === null ? {} : { fullScreenOf: `w${owner}` }),
        windows: windows.filter((window) => (window.space ?? state.current) === index).map((window) => `w${window.id}`),
      };
    }),
  });
}

export async function switchSpace(space: number, ctx: RunContext): Promise<ToolResult> {
  const state = await spaces(ctx);
  if (!state || space >= state.count) return toolError(`There is no Space ${space + 1}; list_spaces shows the ${state?.count ?? 1} there are.`);
  ctx.status(`Switching to ${nameOf(space, ctx)}`);
  await ctx.compositor.request("space-switch", { space });
  return text(`${nameOf(space, ctx)} shows now.`);
}

export async function moveWindowToSpace(id: number, space: number, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, id);
  if (!window) return noWindow(id);
  const state = await spaces(ctx);
  if (!state || space >= state.count) return toolError(`There is no Space ${space + 1}; list_spaces shows the ${state?.count ?? 1} there are.`);
  const fullscreen = ctx.desktop.spaces?.getSnapshot().fullscreen ?? [];
  if (fullscreen.includes(id)) return toolError(`w${id} is full screen on its own Desktop; take it out of full screen first.`);
  if ((fullscreen[space] ?? null) !== null) return toolError(`Space ${space + 1} is a full-screen window's own Desktop; nothing else goes there.`);
  ctx.status(`Moving ${subject(window, ctx)} to ${spaceLabel(space)}`);
  await ctx.compositor.request("space-move", { window: id, space });
  return text(
    `w${id}${ctx.mayName() ? ` (“${window.title}”)` : ""} is on ${spaceLabel(space)}${space === state.current ? "" : ", off screen until that Space shows"}.`,
  );
}
