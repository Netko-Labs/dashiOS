/** How tools talk about a window: look it up, and name it only as far as the agent may know it. */

import type { Compositor, CompositorWindow } from "../../compositor.ts";
import { type RunContext, type ToolResult, toolError } from "../context.ts";

export async function named(compositor: Compositor, id: number): Promise<CompositorWindow | null> {
  return (await compositor.windows()).find((window) => window.id === id) ?? null;
}

/** How the menu bar speaks of a window: by title if the agent may know it. */
export const subject = (window: CompositorWindow, ctx: RunContext): string => (ctx.mayName() ? `\u201c${window.title}\u201d` : `w${window.id}`);

export const noWindow = (id: number): ToolResult => toolError(`There is no window w${id} now; call list_windows for current ids.`);
