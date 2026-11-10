/** What an agent sees of the screen: a picture of it, a window or a part (never what mask.ts blanks), and a recording. */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type RunContext, type ToolResult, toolError } from "./context.ts";
import { recordScreen } from "./desktop/record.ts";
import { AGENT_MASK } from "./mask.ts";
import type { Handlers } from "./run-types.ts";
import { named, noWindow, subject } from "./subject.ts";
import type { Rect } from "./tools/index.ts";

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
  const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-agents");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
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
        { type: "text", text: `${answer.width}×${answer.height} pixels at scale ${scale}: divide pixel positions by ${scale} for points.` },
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
