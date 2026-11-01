/**
 * click, scroll, drag, type_text, and press_keys: checked against the
 * window, then sent to the compositor's agent seat by `Hands`. What the menu
 * bar and the results say never carries typed text, and names a window only
 * as far as the agent may know it (a title needs "see").
 */

import { SETUP_APP_ID } from "../../apps.ts";
import type { CompositorWindow } from "../../compositor.ts";
import { type RunContext, text, toolError, type ToolResult } from "../context.ts";
import { named, noWindow, subject } from "../subject.ts";
import type { Call } from "../tools/index.ts";
import { keySteps } from "../tools/index.ts";
import { borrowsPersonSeat, PersonBusy } from "./hands.ts";

type InputCall = Extract<Call, { name: "click" | "scroll" | "drag" | "type_text" | "press_keys" }>;

/** Pause between the clicks of a double click, and between a drag's steps. */
const CLICK_GAP_MS = 60;
const DRAG_STEPS = 8;
const DRAG_STEP_MS = 30;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const at = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

/** The size of a window's content, or why there is none to act in. */
function content(window: CompositorWindow): { width: number; height: number } | ToolResult {
  if (window.state !== "normal" || window.frame === null) {
    return toolError(`w${window.id} is ${window.state === "normal" ? "not on screen" : window.state}; focus_window brings it back.`);
  }
  return { width: window.frame.width, height: window.frame.height - window.titleBar };
}

const isResult = (value: object): value is ToolResult => "content" in value;

/** Every point must land inside the window's content. */
function inside(window: CompositorWindow, size: { width: number; height: number }, points: ReadonlyArray<{ x: number; y: number }>): ToolResult | null {
  const out = points.find((point) => point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height);
  return out
    ? toolError(`${at(out.x, out.y)} is outside w${window.id}, whose content is ${size.width}×${size.height} points; coordinates start at its top left.`)
    : null;
}

function describePerson(error: PersonBusy): ToolResult {
  return toolError(
    error.desktop
      ? "The person is using the desktop and didn't pause in time, so nothing was done. Try again in a moment."
      : `The person is using w${error.window}, so nothing was done. Wait a couple of seconds and try again, or work in another window.`,
  );
}

export async function handsCall(call: InputCall, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  // The Setup Assistant is the person's: its pages change the whole computer's settings, one of them behind a password sheet.
  if (window.appId === SETUP_APP_ID) return toolError(`w${window.id} is the Setup Assistant, which is for the person to use; open_setup_assistant only shows it.`);
  const size = content(window);
  if (isResult(size)) return size;
  const where = subject(window, ctx);
  const say = (words: string) => ctx.status(words);
  const send = (payload: Record<string, unknown>) => ctx.hands.send(window, payload, ctx.agent, say);
  try {
    switch (call.name) {
      case "click": {
        const problem = inside(window, size, [call]);
        if (problem) return problem;
        say(`Clicking in ${where}`);
        for (let n = 0; n < call.count; n++) {
          if (n > 0) await sleep(CLICK_GAP_MS);
          await send({ pointer: { x: call.x, y: call.y }, action: "click", button: call.button });
        }
        return text(`Clicked ${call.count > 1 ? `${call.count} times ` : ""}in w${window.id} at ${at(call.x, call.y)}.`);
      }
      case "scroll": {
        const problem = inside(window, size, [call]);
        if (problem) return problem;
        say(`Scrolling ${where}`);
        await send({ pointer: { x: call.x, y: call.y }, action: "scroll", scroll: { dx: call.dx, dy: call.dy } });
        return text(`Scrolled w${window.id} by (${call.dx}, ${call.dy}) at ${at(call.x, call.y)}.`);
      }
      case "drag": {
        const problem = inside(window, size, [call.from, call.to]);
        if (problem) return problem;
        if (borrowsPersonSeat(window)) {
          return toolError(`w${window.id} only listens to the person's pointer, so it can't be dragged without taking it over; use click, type_text, or press_keys there.`);
        }
        say(`Dragging in ${where}`);
        return await drag(call, window.id, send, ctx);
      }
      case "type_text":
        say(`Typing in ${where}`);
        await send({ keys: [{ text: call.text }] });
        // Never what was typed: only how much.
        return text(`Typed ${[...call.text].length} characters into w${window.id}.`);
      case "press_keys":
        say(`Pressing keys in ${where}`);
        await send({ keys: keySteps(call.chords) });
        return text(`Pressed ${call.keys} in w${window.id}.`);
    }
  } catch (error) {
    if (error instanceof PersonBusy) return describePerson(error);
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

async function drag(call: Extract<InputCall, { name: "drag" }>, id: number, send: (payload: Record<string, unknown>) => Promise<void>, ctx: RunContext): Promise<ToolResult> {
  const { from, to } = call;
  const move = (x: number, y: number, action: "move" | "press" | "release") => send({ pointer: { x, y }, action });
  try {
    await move(from.x, from.y, "press");
    for (let step = 1; step <= DRAG_STEPS; step++) {
      await sleep(DRAG_STEP_MS);
      const t = step / DRAG_STEPS;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await (step === DRAG_STEPS ? move(x, y, "release") : move(x, y, "move"));
    }
  } catch (error) {
    // The person came back, or something refused: don't leave the button down.
    await ctx.hands.release();
    throw error;
  }
  return text(`Dragged in w${id} from ${at(from.x, from.y)} to ${at(to.x, to.y)}.`);
}
