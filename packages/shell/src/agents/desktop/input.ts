/**
 * click, scroll, drag, type_text, and press_keys: checked against the
 * window, then sent to the compositor's agent seat by `Hands`. What the menu
 * bar and the results say never carries typed text, and names a window only
 * as far as the agent may know it (a title needs "see").
 */

import { chordText } from "../../app-menus/shortcut.ts";
import { SETUP_APP_ID } from "../../apps.ts";
import type { CompositorWindow } from "../../compositor.ts";
import { type KeyChord, resolveChord } from "../../keymap-match.ts";
import { type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { named, noWindow, subject } from "../subject.ts";
import type { Call } from "../tools/index.ts";
import { keySteps } from "../tools/index.ts";
import { borrowsPersonSeat, type Payload, PersonBusy, QUIET_MS, WAIT_MS } from "./hands.ts";

type InputCall = Extract<Call, { name: "click" | "scroll" | "drag" | "type_text" | "press_keys" }>;

/** Pause between the clicks of a double click, and between a drag's steps. */
const CLICK_GAP_MS = 60;
const DRAG_STEPS = 8;
const DRAG_STEP_MS = 30;
/**
 * A long scroll is played as a wheel spun fast: flicks of at most 120 pixels
 * (8 notches), a frame apart, never one event of hundreds of notches, which
 * no wheel sends (a 2400 pixel one came right before the display froze,
 * review 20). The tool keeps a scroll within 10 000 pixels (tools/input.ts).
 */
const WHEEL_FLICK_PX = 120;
const WHEEL_FLICK_MS = 16;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const at = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

/** The size of a window's content, or why there is none to act in. */
function content(window: CompositorWindow): { width: number; height: number } | ToolResult {
  if (window.state !== "normal" || window.frame === null) {
    return toolError(`w${window.id} is ${window.state === "normal" ? "not on screen" : window.state}; focus_window brings it back.`);
  }
  return { width: window.frame.width, height: window.frame.height - window.titleBar };
}

/** A scroll of (dx, dy) as the wheel flicks that play it, in order; none for (0, 0). */
export function wheelFlicks(dx: number, dy: number): Array<{ dx: number; dy: number }> {
  const count = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / WHEEL_FLICK_PX);
  // Even shares, so the last flick isn't a stub.
  return Array.from({ length: count }, () => ({ dx: dx / count, dy: dy / count }));
}

const isResult = (value: object): value is ToolResult => "content" in value;

/** The keymap's binding that hands ❖ chords to a Dashi app's menus (keymap.ts). */
const APP_CHORD = "app-chord";
/** ❖⌫ in a Dashi app: its menu row first, else erasing to the line's start (keymap.ts). */
const APP_ERASE = "app-erase";

const shortcutOf = (chord: KeyChord): string =>
  chordText({ key: chord.key, shift: chord.mods.includes("shift"), ctrl: chord.mods.includes("ctrl"), alt: chord.mods.includes("alt") }) ??
  [...chord.mods, chord.key].join("+");

/**
 * Why press_keys refused a chord the desktop keeps, and what does it instead:
 * ❖Q is the shell's Quit (keymap.ts `quit-app`), which an agent reaches
 * through the app's menu.
 */
export function desktopChordRefusal(shortcut: string, binding: string | null): string {
  const instead =
    binding === "quit-app"
      ? "to quit the app, choose_menu_item its app menu's Quit (list_menus names it), or close_window"
      : "use the window tools (focus_window, close_window, …) instead";
  return `${shortcut} is the desktop's own shortcut, not the window's; ${instead}.`;
}

/** ❖ played as the app's own Ctrl, Shift kept. */
const asCtrl = (chord: KeyChord): KeyChord => ({ mods: ["ctrl", ...chord.mods.filter((mod) => mod === "shift")], key: chord.key });

/** Every point must land inside the window's content. */
function inside(window: CompositorWindow, size: { width: number; height: number }, points: ReadonlyArray<{ x: number; y: number }>): ToolResult | null {
  const out = points.find((point) => point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height);
  return out
    ? toolError(`${at(out.x, out.y)} is outside w${window.id}, whose content is ${size.width}×${size.height} points; coordinates start at its top left.`)
    : null;
}

const seconds = (ms: number) => `${Math.max(1, Math.ceil(ms / 1000))} s`;

/** Why nothing was done, and how long to wait: the agent may act QUIET_MS after the person's last input. */
export function describePerson(error: PersonBusy): ToolResult {
  const rule = `an agent may act once the person has left it alone for ${seconds(QUIET_MS)}`;
  return toolError(
    error.desktop
      ? `The person is using the desktop and didn't pause within ${seconds(WAIT_MS)}, so nothing was done; ${rule}. Wait at least ${seconds(error.waitMs)} and try again.`
      : `The person is using w${error.window}, so nothing was done; ${rule}. Wait at least ${seconds(error.waitMs)} and try again, or work in another window.`,
  );
}

export async function handsCall(call: InputCall, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  // The Setup Assistant is the person's: its pages change the whole computer's settings, one of them behind a password sheet.
  if (window.appId === SETUP_APP_ID)
    return toolError(`w${window.id} is the Setup Assistant, which is for the person to use; open_setup_assistant only shows it.`);
  const size = content(window);
  if (isResult(size)) return size;
  const where = subject(window, ctx);
  const say = (words: string) => ctx.status(words);
  const send = (payload: Payload) => ctx.hands.send(window, payload, ctx.agent, say);
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
        for (const [n, flick] of wheelFlicks(call.dx, call.dy).entries()) {
          if (n > 0) await sleep(WHEEL_FLICK_MS);
          await send({ pointer: { x: call.x, y: call.y }, action: "scroll", scroll: flick });
        }
        return text(`Scrolled w${window.id} by (${call.dx}, ${call.dy}) at ${at(call.x, call.y)}.`);
      }
      case "drag": {
        const problem = inside(window, size, [call.from, call.to]);
        if (problem) return problem;
        if (borrowsPersonSeat(window)) {
          return toolError(
            `w${window.id} only listens to the person's pointer, so it can't be dragged without taking it over; use click, type_text, or press_keys there.`,
          );
        }
        say(`Dragging in ${where}`);
        return await drag(call, window.id, send, ctx);
      }
      case "type_text":
        say(`Typing in ${where}`);
        await send({ keys: [{ text: call.text }] });
        // Never what was typed: only how much.
        return text(`Typed ${[...call.text].length} characters into w${window.id}.`);
      case "press_keys": {
        // The person's keys pass the keymap in the compositor; an agent's are
        // resolved here, so ⌥← and ❖S mean the same for both (keymap-match.ts).
        const plan = call.chords.map((chord) => ({ chord, resolved: resolveChord(chord, window.appId) }));
        const kept = plan.find(
          ({ resolved }) => resolved.kind === "swallow" || (resolved.kind === "bind" && resolved.name !== APP_CHORD && resolved.name !== APP_ERASE),
        );
        if (kept) return toolError(desktopChordRefusal(shortcutOf(kept.chord), kept.resolved.kind === "bind" ? kept.resolved.name : null));
        say(`Pressing keys in ${where}`);
        for (const { chord, resolved } of plan) {
          if (resolved.kind === "keys") await send({ keys: keySteps(resolved.chords) });
          else if (resolved.kind === "bind" && resolved.name === APP_ERASE) {
            if (!(await ctx.desktop.appShortcut?.(window.id, "❖⌫")))
              await send({
                keys: keySteps([
                  { mods: ["shift"], key: "Home" },
                  { mods: [], key: "BackSpace" },
                ]),
              });
          }
          // A ❖ chord in one of Dashi's apps: its menu item with that shortcut, else the app's Ctrl chord (shortcuts.ts).
          else if (!(await ctx.desktop.appShortcut?.(window.id, shortcutOf(chord)))) await send({ keys: keySteps([asCtrl(chord)]) });
        }
        return text(`Pressed ${call.keys} in w${window.id}.`);
      }
    }
  } catch (error) {
    if (error instanceof PersonBusy) return describePerson(error);
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

async function drag(call: Extract<InputCall, { name: "drag" }>, id: number, send: (payload: Payload) => Promise<void>, ctx: RunContext): Promise<ToolResult> {
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
