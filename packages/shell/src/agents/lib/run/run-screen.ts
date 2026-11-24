/** What an agent sees of the screen: a picture of it, a window or a part (never what mask.ts blanks), and a recording. */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { type RunContext, type ToolResult, toolError } from "../../context.ts";
import { recordScreen } from "../../desktop/index.ts";
import { AGENT_MASK } from "../../mask.ts";
import type { Rect } from "../../tools/index.ts";
import { scratchDir } from "../scratch.ts";
import { named, noWindow, subject } from "../subject.ts";
import type { Handlers } from "./run-types.ts";

/**
 * What a picture's words say: its size and scale, and, while a sheet waits
 * for the person (a consent, a question), that the grey block is that sheet,
 * blanked: theirs to answer, never an agent's to read or press.
 */
export function pictureNote(size: { width: number; height: number }, scale: number, sheetUp: boolean): string {
  const measure = `${size.width}×${size.height} pixels at scale ${scale}: divide pixel positions by ${scale} for points.`;
  if (!sheetUp) return measure;
  return `${measure} The grey block is a Dashi sheet waiting for the person (a permission or a question), blanked in agents' pictures: it is theirs to read and answer, and agents can't press it.`;
}

async function screenshot(id: number | null, rect: Rect | undefined, ctx: RunContext): Promise<ToolResult> {
  if (id !== null) {
    const window = await named(ctx.compositor, id);
    if (!window) return noWindow(id);
    ctx.status(`Looking at ${subject(window, ctx)}`);
  } else {
    ctx.status(rect ? "Looking at part of the screen" : "Taking a screenshot");
  }
  // Never in an agent's picture, blanked (mask.ts): consent sheets (so a screenshot needn't wait for
  // the person to answer one), password fields, the vault, a window handed to the person.
  try {
    await ctx.mask.update();
  } catch {
    return toolError("The screenshot was not taken: Dashi couldn't blank what agents must not see.");
  }
  const dir = scratchDir();
  const path = join(dir, `${crypto.randomUUID()}.png`);
  try {
    const answer = await ctx.compositor.capture({
      path,
      mask: AGENT_MASK,
      ...(id !== null ? { window: id } : {}),
      ...(rect ? { rect } : {}),
    });
    const data = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
    const scale = Number(answer.scale) || 1;
    return {
      content: [
        { type: "image", data, mimeType: "image/png" },
        { type: "text", text: pictureNote(answer, scale, id === null && ctx.ui.sheetUp?.() === true) },
      ],
    };
  } finally {
    rmSync(path, { force: true });
  }
}

export const screenHandlers = {
  screenshot: (call, ctx) => screenshot(call.window, call.rect, ctx),
  record_screen: (call, ctx) => recordScreen(call, ctx),
} satisfies Handlers<"screenshot" | "record_screen">;
