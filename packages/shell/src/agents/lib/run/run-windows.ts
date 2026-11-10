/** A window asked to come forward, minimize, close or take a tile. */

import { type RunContext, type ToolResult, text } from "../../context.ts";
import { named, noWindow, subject } from "../subject.ts";
import type { CallOf, Handlers } from "./run-types.ts";

type WindowVerb = "focus_window" | "minimize_window" | "close_window" | "tile_window";

const STATUS = { focus_window: "Bringing", minimize_window: "Minimizing", close_window: "Closing", tile_window: "Arranging" } as const;

const DONE = {
  focus_window: "is in front and focused",
  minimize_window: "is minimized",
  close_window: "was asked to close (the app may ask the person to save first)",
  tile_window: "is arranged",
} as const;

async function windowVerb(call: CallOf<WindowVerb>, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  ctx.status(`${STATUS[call.name]} ${subject(window, ctx)}`);
  if (call.name === "tile_window") {
    await ctx.tile(window.id, call.tile);
  } else {
    const method = { focus_window: "focus", minimize_window: "minimize", close_window: "close" } as const;
    await ctx.compositor[method[call.name]]({ window: window.id });
  }
  return text(`w${window.id}${ctx.mayName() ? ` (“${window.title}”)` : ""} ${DONE[call.name]}.`);
}

export const windowHandlers = {
  focus_window: windowVerb,
  minimize_window: windowVerb,
  close_window: windowVerb,
  tile_window: windowVerb,
} satisfies Handlers<WindowVerb>;
