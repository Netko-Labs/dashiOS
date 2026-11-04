/**
 * record_screen: a video of a screen or an area, made by the shell's screen
 * recorder (recorder/) while the agent goes on with other calls, and stills
 * taken through the compositor's capture at even times through it, since an
 * agent can see pictures but not watch a video.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RecordTarget } from "../../recorder/command.ts";
import { type RunContext, type ToolResult, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";

type RecordCall = Extract<Call, { name: "record_screen" }>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** When each still is taken, in ms from the start: the middles of `frames` equal slices. */
export function stillTimes(seconds: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => Math.round(((index + 0.5) * seconds * 1000) / frames));
}

export interface Display {
  name: string;
  frame: { x: number; y: number; width: number; height: number };
}

/** The screen named `name` (else the main display, else the first) from the compositor's `outputs` answer. */
export function displayOf(answer: unknown, name: string | null): Display | null {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  const screens = (Array.isArray(outputs) ? outputs : []).flatMap((output: unknown) => {
    if (typeof output !== "object" || output === null) return [];
    const { name, primary, enabled, frame } = output as Record<string, unknown>;
    if (typeof name !== "string" || enabled === false || typeof frame !== "object" || frame === null) return [];
    const { x, y, width, height } = frame as Record<string, unknown>;
    if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return [];
    return [{ name, primary: primary === true, frame: { x, y, width, height } as Display["frame"] }];
  });
  const chosen = name === null ? (screens.find((screen) => screen.primary) ?? screens[0]) : screens.find((screen) => screen.name === name);
  return chosen ? { name: chosen.name, frame: chosen.frame } : null;
}

export async function recordScreen(call: RecordCall, ctx: RunContext): Promise<ToolResult> {
  const recorder = ctx.desktop.recorder;
  if (!recorder?.available()) return toolError("Screen recording isn't available here: it needs wf-recorder.");
  if (recorder.getSnapshot().kind !== "idle") return toolError("The screen is already being recorded; wait for that recording to end.");
  let target: RecordTarget;
  let area = call.rect;
  if (call.rect) target = { kind: "area", ...call.rect };
  else {
    const display = displayOf(await ctx.compositor.request("outputs"), call.display);
    if (!display) return toolError(call.display ? `There is no screen called ${call.display}; list_displays names them.` : "There is no screen to record.");
    target = { kind: "screen", output: display.name };
    area = display.frame;
  }
  // The consent sheet is never in an agent's recording.
  await ctx.ui.whenNoSheet();
  ctx.status("Recording the screen");
  let file: string;
  try {
    file = await recorder.start(target);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
  const started = Date.now();
  const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-agents");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stills: ToolResult["content"] = [];
  for (const at of stillTimes(call.seconds, call.frames)) {
    await sleep(Math.max(0, started + at - Date.now()));
    if (recorder.getSnapshot().kind !== "recording") break;
    const path = join(dir, `${crypto.randomUUID()}.png`);
    try {
      // With the pointer, so a still shows what is being dragged.
      await ctx.compositor.request("capture", { path, rect: area, cursor: true });
      stills.push(
        { type: "image", data: Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64"), mimeType: "image/png" },
        { type: "text", text: `The still above is at ${(at / 1000).toFixed(1)} s.` },
      );
    } catch {
      // A still that can't be taken leaves a gap; the video has it.
    } finally {
      rmSync(path, { force: true });
    }
  }
  await sleep(Math.max(0, started + call.seconds * 1000 - Date.now()));
  const early = recorder.getSnapshot().kind !== "recording";
  await recorder.stop();
  const length = ((Date.now() - started) / 1000).toFixed(1);
  return {
    content: [{ type: "text", text: `${early ? "The person stopped the recording early. " : ""}Recorded about ${length} s to ${file}.` }, ...stills],
  };
}
