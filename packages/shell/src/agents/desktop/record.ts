/**
 * record_screen: a video of a screen or an area, made by the shell's screen
 * recorder (recorder/) while the agent goes on with other calls, and stills
 * taken through the compositor's capture at even times through it, since an
 * agent can see pictures but not watch a video.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Output } from "../../compositor.ts";
import type { RecordTarget } from "../../recorder/index.ts";
import { type RunContext, type ToolResult, toolError } from "../context.ts";
import { AGENT_MASK } from "../mask.ts";
import type { Call } from "../tools/index.ts";

type RecordCall = Extract<Call, { name: "record_screen" }>;

/** How often the blanks follow the screen while an agent's recording runs. */
const MASK_EVERY_MS = 400;
/** How often the wait looks for a recording the person stopped early. */
const STOPPED_POLL_MS = 100;

/**
 * How long the video is, in seconds: the recorder's own clock, from when
 * wf-recorder began to when it ended (`measured`), else the time the tool
 * waited. The tool used to say the time it waited, which runs on after a
 * recording the person stopped early (a 6.4 s file was "about 40.0 s").
 */
export function recordedLength(measured: number | null, started: number, now: number): number {
  return measured ?? Math.max(0, now - started) / 1000;
}

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
export function displayOf(outputs: readonly Output[], name: string | null): Display | null {
  const screens = outputs.flatMap((output) => (output.enabled && output.frame ? [{ name: output.name, primary: output.primary, frame: output.frame }] : []));
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
    const display = displayOf(await ctx.compositor.outputs(), call.display);
    if (!display) return toolError(call.display ? `There is no screen called ${call.display}; list_displays names them.` : "There is no screen to record.");
    target = { kind: "screen", output: display.name };
    area = display.frame;
  }
  // Consent sheets are blanked in the recording with the rest of the mask (below), so it needn't wait for one.
  ctx.status("Recording the screen");
  let file: string;
  // The video gets the agent's blanks too: the recorder's pid is masked before
  // its first frame, and the mask follows the screen while it records.
  const beforeCapture = async (pid: number) => {
    ctx.mask.recording(pid);
    await ctx.mask.update();
  };
  try {
    file = await recorder.start(target, { beforeCapture, by: "agent" });
  } catch (error) {
    ctx.mask.recording(null);
    return toolError(error instanceof Error ? error.message : String(error));
  }
  // A mask that can't follow ends the recording.
  const following = setInterval(() => void ctx.mask.update().catch(() => recorder.stop()), MASK_EVERY_MS);
  const started = Date.now();
  // Until `until`, or until the person stops it (the menu bar's stop button): a stopped recording isn't waited out.
  const whileRecording = async (until: number): Promise<void> => {
    // A stopped agent's recording stops with it: the menu bar showed it as the agent's, and the agent is gone.
    while (Date.now() < until && recorder.getSnapshot().kind === "recording" && !ctx.signal.aborted) await sleep(Math.min(STOPPED_POLL_MS, until - Date.now()));
  };
  const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-agents");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stills: ToolResult["content"] = [];
  for (const at of stillTimes(call.seconds, call.frames)) {
    await whileRecording(started + at);
    if (recorder.getSnapshot().kind !== "recording" || ctx.signal.aborted) break;
    const path = join(dir, `${crypto.randomUUID()}.png`);
    try {
      await ctx.mask.update();
      // With the pointer, so a still shows what is being dragged; with the agent's blanks.
      await ctx.compositor.capture({ path, rect: area, cursor: true, mask: AGENT_MASK });
      stills.push(
        { type: "image", data: Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64"), mimeType: "image/png" },
        { type: "text", text: `The still above is at ${(at / 1000).toFixed(1)} s.` },
      );
    } catch {
      // A still that can't be taken (or blanked) leaves a gap; the video has it.
    } finally {
      rmSync(path, { force: true });
    }
  }
  await whileRecording(started + call.seconds * 1000);
  const early = recorder.getSnapshot().kind !== "recording";
  await recorder.stop();
  clearInterval(following);
  ctx.mask.recording(null);
  await ctx.mask.update().catch(() => {});
  const length = recordedLength(recorder.lengthOf(file), started, Date.now()).toFixed(1);
  return {
    content: [{ type: "text", text: `${early ? "The person stopped the recording early. " : ""}Recorded about ${length} s to ${file}.` }, ...stills],
  };
}
