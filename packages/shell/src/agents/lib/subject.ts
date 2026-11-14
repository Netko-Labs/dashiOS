/** How tools talk about a window: look it up, and name it only as far as the agent may know it. */

import type { Compositor, CompositorWindow } from "../../compositor/index.ts";
import { spaceLabel } from "../../spaces/index.ts";
import { type RunContext, type ToolResult, toolError } from "../context.ts";

export async function named(compositor: Compositor, id: number): Promise<CompositorWindow | null> {
  return (await compositor.windows()).find((window) => window.id === id) ?? null;
}

/**
 * How the menu bar speaks of a window: by title if the agent may know it, and with its Desktop
 * when that one does not show ("Typing in “Untitled” on Desktop 3"), so the person reads where an
 * agent they sent out of their way is at work.
 */
export function subject(window: CompositorWindow, ctx: RunContext): string {
  const name = ctx.mayName() ? `\u201c${window.title}\u201d` : `w${window.id}`;
  return window.away && window.space !== undefined ? `${name} on ${spaceLabel(window.space)}` : name;
}

export const noWindow = (id: number): ToolResult => toolError(`There is no window w${id} now; call list_windows for current ids.`);
