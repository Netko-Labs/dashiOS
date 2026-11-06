/**
 * A plan: the calls an answerer wants made, as numbered steps the person
 * reads before anything runs (docs/betterments.html, "A plan before
 * acting"). Each step is a registry action (actions/) with its arguments,
 * checked by the action's own `check`; the words on the step are Dashi's,
 * from the action and its arguments, never the model's, so a step says what
 * it will really do. One Return, pressed by the person, runs exactly these
 * calls (tasks.ts).
 *
 * The tools offered are the actions a person and agents both use (`who:
 * "both"`, with a tool): what the person could do from the launcher
 * themselves. Pictures, the agent's own pointer and keys, sign-in, and
 * paying are not plan steps.
 */

import type { ActionDef, Args } from "../../actions/types.ts";
import { agentRow, describeValue, rowName } from "../../settings-app/registry/index.ts";
import { label, type Scope } from "../consent.ts";
import type { ModelCall, PlanTool } from "./answerer.ts";

/**
 * A plan longer than this is cut: the rest is not run. Nine 40 px steps,
 * their head and a line of the model's words fit the launcher's 600 px
 * surface under its field, so every step that runs is on screen (the plan's
 * rows keep text size 1's measures, launcher/agents/plan-view.tsx).
 */
export const MAX_STEPS = 9;

export type StepState =
  | { kind: "ready" }
  /** Its arguments don't fit (or Dashi has no such action): never run. */
  | { kind: "invalid"; error: string }
  | { kind: "running" }
  | { kind: "done"; text: string }
  /** The person's press couldn't be confirmed, or its own sheet was answered no: "Allow once" is right there. */
  | { kind: "not-allowed" }
  | { kind: "failed"; error: string }
  /** Stopped before it ran. */
  | { kind: "skipped" };

/** How a settings change is taken back: the same action, with the value it had. */
export interface Undo {
  address: string;
  args: Args;
  /** "Turn Dark Mode off". */
  title: string;
}

export interface Step {
  /** The model's id for the call (a follow-up reports how it went under it). */
  id: string;
  /** The action's tool name, as the model called it. */
  tool: string;
  action: ActionDef | null;
  args: Args;
  /** What it does, in Dashi's words: "Turn Dark Mode on". */
  title: string;
  /** What it needs an agent to have been allowed ("Change settings"); null for none. */
  scope: string | null;
  /** It asks on its own sheet anyway (force quit, the Trash, installs). */
  asks: boolean;
  state: StepState;
  undo?: Undo;
  undone?: boolean;
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** The actions a plan may use: the person's commands that are agents' tools too. */
export const planActions = (actions: readonly ActionDef[]): ActionDef[] => actions.filter((action) => action.tool !== undefined && action.who === "both");

/** The tools as a model is told of them, from the actions. */
export function planTools(actions: readonly ActionDef[]): PlanTool[] {
  return planActions(actions).map((action) => ({
    name: action.tool as string,
    description: action.description || action.title,
    schema: { type: "object", properties: action.properties, required: [...(action.required ?? [])], additionalProperties: false },
    check: (args: Args) => {
      const checked = action.check(args);
      return checked.ok ? { ok: true as const } : { ok: false as const, error: checked.error };
    },
  }));
}

/** Text from a model, safe on one line of a row: no control characters, and short. */
export function oneLine(text: string, max = 60): string {
  const flat = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Its tools talking, not the answerer to the person: the plan's own answers
 * echoed back ("Planned as step 1…", "Not planned: …"), a tool count, a log
 * line's "ok:"/"error:".
 */
const CHATTER: readonly RegExp[] = [
  /\bPlanned as step \d+\b/i,
  /\bNot planned:/i,
  /\bDashi has no tool called\b/i,
  /\bnothing more can be added\b/i,
  /\b\d+ tools\b/i,
  /(?:^|[|\n])\s*(?:ok|error):/i,
];

/**
 * What an answerer says to the person under its plan: its last paragraph
 * (its final words, after any tool calls), on one line; nothing when that
 * is its tools' chatter, never "29 tools | ok: Planned as step 1…".
 */
export function spokenWords(text: string, max = 140): string {
  const last =
    text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return CHATTER.some((pattern) => pattern.test(last)) ? "" : oneLine(last, max);
}

const quoted = (value: unknown): string => `“${oneLine(String(value), 40)}”`;
const onOff = (value: unknown): string => (value === true ? "on" : "off");

/** Switches whose row title isn't a name to turn on or off: what on and off say. */
const TOGGLE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  dock_autohide: ["Hide the Dock automatically", "Keep the Dock in view"],
  battery_percentage: ["Show the battery percentage in the menu bar", "Hide the battery percentage in the menu bar"],
  sound_in_menu_bar: ["Show Sound in the menu bar", "Hide Sound in the menu bar"],
};

/** What setting `name` to `value` is called on a step: "Turn Dark Mode on", "Set Dock style to taskbar". */
export function settingWords(name: unknown, value: unknown): string {
  const phrase = typeof name === "string" && typeof value === "boolean" ? TOGGLE_WORDS[name] : undefined;
  if (phrase) return value ? phrase[0] : phrase[1];
  // The row's name and its value's words come from the settings registry, by the row's `set_setting` name.
  const row = agentRow(name);
  const title = row ? rowName(row) : oneLine(String(name), 32);
  if (typeof value === "boolean") return `Turn ${title} ${onOff(value)}`;
  const shown = row && (typeof value === "string" || typeof value === "number") ? describeValue(row, value).toLowerCase() : String(value);
  return `Set ${title} to ${oneLine(shown, 24)}`;
}

/** A step in plain words, from the action and its arguments: what will really happen. */
export function describeStep(action: ActionDef, args: Args): string {
  switch (action.tool) {
    case "set_setting":
      return settingWords(args.name, args.value);
    case "launch_app":
      return `Open ${quoted(args.app)}`;
    case "create_note":
      return `Add a note ${quoted(args.title)}`;
    case "join_wifi":
      return `Join the Wi-Fi network ${quoted(args.ssid)}`;
    case "lock_screen":
      return "Lock the screen";
    case "clear_notifications":
      return "Clear your notifications";
    case "set_clock_24_hour":
      return args.value === true ? "Use 24-hour time" : "Use 12-hour time";
    case "set_time_zone":
      return `Set the time zone to ${quoted(args.time_zone)}`;
    case "set_power_profile":
      return `Change the power mode to ${quoted(args.profile)}`;
    case "switch_space":
      return `Switch to Desktop ${oneLine(String(args.space), 4)}`;
    case "set_bluetooth_connection":
      return `${args.connected === true ? "Connect" : "Disconnect"} ${quoted(args.device)}`;
    case "set_volume": {
      const what = args.target === "input" ? "the microphone" : "the sound";
      if (args.muted === true) return `Mute ${what}`;
      if (typeof args.level === "number") return `Set ${what} to ${Math.round(args.level)}%`;
      return args.muted === false ? `Unmute ${what}` : `Change ${what}`;
    }
  }
  const values = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key.replaceAll("_", " ")} ${typeof value === "string" ? quoted(value) : oneLine(JSON.stringify(value), 24)}`);
  return values.length > 0 ? `${action.title}: ${oneLine(values.join(", "), 56)}` : action.title;
}

/** The scope's words for a step's chip. */
export const scopeWords = (scope: Scope | null): string | null => (scope ? label(scope) : null);

/** The model's calls as steps, each checked; past MAX_STEPS they are cut. */
export function stepsFrom(calls: readonly ModelCall[], actions: readonly ActionDef[]): Step[] {
  const usable = planActions(actions);
  return calls.slice(0, MAX_STEPS).map((call): Step => {
    const action = usable.find((each) => each.tool === call.name) ?? null;
    const args: Args = isRaw(call.input) ? call.input : {};
    if (!action) {
      return {
        id: call.id,
        tool: call.name,
        action: null,
        args,
        title: `Use ${quoted(call.name)}`,
        scope: null,
        asks: false,
        state: { kind: "invalid", error: "Dashi can't do this from a plan." },
      };
    }
    const checked = action.check(args);
    return {
      id: call.id,
      tool: call.name,
      action,
      args,
      title: describeStep(action, args),
      scope: scopeWords(action.scope),
      asks: action.asksEveryTime === true,
      state: checked.ok ? { kind: "ready" } : { kind: "invalid", error: oneLine(checked.error, 80) },
    };
  });
}

/** The steps a Return runs now. */
export const runnable = (steps: readonly Step[]): Step[] => steps.filter((step) => step.state.kind === "ready" || step.state.kind === "not-allowed");

/** How a step went, for the model's next turn (a follow-up): plain words, never a secret (the tools return none). */
export function resultFor(step: Step): { id: string; text: string; error: boolean } {
  switch (step.state.kind) {
    case "done":
      return { id: step.id, text: step.state.text || "Done.", error: false };
    case "invalid":
      return { id: step.id, text: `Not run: ${step.state.error}`, error: true };
    case "failed":
      return { id: step.id, text: step.state.error, error: true };
    case "not-allowed":
      return { id: step.id, text: "The person did not allow this step.", error: true };
    default:
      return { id: step.id, text: "Not run.", error: true };
  }
}
