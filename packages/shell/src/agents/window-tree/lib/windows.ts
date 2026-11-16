/**
 * Looking a window up and naming it, as agents/lib/subject.ts does, without
 * what that file pulls in (the Spaces' views and the shell's overlays): the
 * window tree loads nothing that starts a host (dashi-a11y-dump reads trees
 * with it alone).
 */

import type { CompositorWindow } from "../../../compositor/index.ts";
import { type RunContext, type ToolResult, toolError } from "../../context.ts";

export async function named(ctx: Pick<RunContext, "compositor">, id: number): Promise<CompositorWindow | null> {
  return (await ctx.compositor.windows()).find((window) => window.id === id) ?? null;
}

export const noWindow = (id: number): ToolResult => toolError(`There is no window w${id} now; call list_windows for current ids.`);

/** A window as the menu bar speaks of it: its title when the agent may know it, and its Desktop when that one does not show. */
export function subject(window: CompositorWindow, ctx: Pick<RunContext, "mayName">): string {
  const name = ctx.mayName() ? `“${window.title}”` : `w${window.id}`;
  return window.away && window.space !== undefined ? `${name} on Desktop ${window.space + 1}` : name;
}
