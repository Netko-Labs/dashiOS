/**
 * An applet's controls in Control Center (protocol 5, docs/applets.md
 * "Version 5: Control Center"): declared in applet.json, so they are in
 * Control Center's Add list before the applet has ever run, and drawn by
 * Dashi as its own tiles. The applet only says their state and hears what
 * was pressed; nothing of its own drawing appears there.
 *
 *   "controls": [
 *     { "id": "lid", "kind": "toggle", "title": "Lid light", "icon": "icons/lid.svg" },
 *     { "id": "fans", "kind": "choice", "title": "Fans", "choices": ["Quiet", "Auto", "Max"] },
 *     { "id": "boost", "kind": "slider", "title": "Boost", "min": 0, "max": 100 },
 *     { "id": "cpu", "kind": "status", "title": "CPU" }
 *   ]
 *
 *   shell → applet  {"type":"controls","shown":["lid","cpu"]}                      (after welcome, and when the person changes the layout)
 *   applet → shell  {"type":"control","id":"lid","on":true,"detail":"Bounce"}      (its state; up to 4 a second each)
 *   shell → applet  {"type":"control-action","id":"lid","action":"toggle","on":false}
 *                   {"type":"control-action","id":"fans","action":"choose","choice":"Max"}
 *                   {"type":"control-action","id":"boost","action":"set","value":40}
 *                   {"type":"control-action","id":"cpu","action":"open"}           (its label, or a status tile: open the applet)
 *
 * A manifest with controls must ask for the `controls` permission, which
 * grants nothing else: a control can only do what the applet's other
 * permissions allow.
 */

import { id, integer, isInsidePath, isRefusal, list, optionalText, type Refusal, record, refuse, text } from "./parse.ts";

/** The protocol that brings them. */
export const CONTROLS_PROTOCOL = 5;

export const CONTROL_KINDS = ["toggle", "button", "choice", "slider", "status"] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const CONTROL_SIZES = ["round", "wide", "tall", "flat"] as const;
export type ControlSize = (typeof CONTROL_SIZES)[number];

export const CONTROL_LIMITS = {
  /** Controls one applet may declare. */
  controls: 8,
  title: 24,
  detail: 40,
  choices: { min: 2, max: 5 },
  choice: 16,
  /** State updates a second, per control: more are coalesced. */
  updatesPerSecond: 4,
  /** A slider's range. */
  range: { min: -100000, max: 100000 },
} as const;

/** The sizes a kind may come in, the first being its default. */
export const KIND_SIZES: Readonly<Record<ControlKind, readonly ControlSize[]>> = {
  toggle: ["round", "wide"],
  button: ["round", "wide"],
  choice: ["wide", "round"],
  status: ["wide", "round"],
  slider: ["flat", "tall"],
};

export interface AppletControl {
  id: string;
  kind: ControlKind;
  title: string;
  /** An .svg in the applet's folder, tinted by Dashi. */
  icon?: string;
  sizes: ControlSize[];
  /** A choice control's choices. */
  choices: string[];
  /** A slider's range. */
  min: number;
  max: number;
}

function parseControl(value: unknown, where: string): AppletControl | Refusal {
  const fields = record(value, where, ["id", "kind", "title", "icon", "sizes", "choices", "min", "max"]);
  if (isRefusal(fields)) return fields;
  const controlId = id(fields.id, `${where}: id`);
  if (isRefusal(controlId)) return controlId;
  const kind = CONTROL_KINDS.find((each) => each === fields.kind);
  if (!kind) return refuse(`${where}: kind must be one of ${CONTROL_KINDS.join(", ")}`);
  const title = text(fields.title, `${where}: title`, CONTROL_LIMITS.title);
  if (isRefusal(title)) return title;
  if (fields.icon !== undefined && (typeof fields.icon !== "string" || !isInsidePath(fields.icon) || !/\.svg$/i.test(fields.icon)))
    return refuse(`${where}: icon must be an .svg inside the applet's folder`);
  const allowed = KIND_SIZES[kind];
  const sizes =
    fields.sizes === undefined
      ? [...allowed]
      : list(
          fields.sizes,
          `${where}: sizes`,
          allowed.length,
          (entry, at) => allowed.find((size) => size === entry) ?? refuse(`${at} must be one of ${allowed.join(", ")} for a ${kind}`),
        );
  if (isRefusal(sizes)) return sizes;
  if (sizes.length === 0 || new Set(sizes).size !== sizes.length) return refuse(`${where}: sizes must name each size once`);
  let choices: string[] = [];
  if (kind === "choice") {
    const parsed = list(fields.choices, `${where}: choices`, CONTROL_LIMITS.choices.max, (entry, at) => text(entry, at, CONTROL_LIMITS.choice));
    if (isRefusal(parsed)) return parsed;
    if (parsed.length < CONTROL_LIMITS.choices.min || new Set(parsed).size !== parsed.length)
      return refuse(`${where}: choices must be ${CONTROL_LIMITS.choices.min} to ${CONTROL_LIMITS.choices.max} different words`);
    choices = parsed;
  } else if (fields.choices !== undefined) return refuse(`${where}: only a choice has choices`);
  let min = 0;
  let max = 100;
  if (kind === "slider") {
    const { min: low, max: high } = CONTROL_LIMITS.range;
    const from = fields.min === undefined ? 0 : integer(fields.min, `${where}: min`, low, high);
    if (isRefusal(from)) return from;
    const to = fields.max === undefined ? 100 : integer(fields.max, `${where}: max`, low, high);
    if (isRefusal(to)) return to;
    if (to <= from) return refuse(`${where}: max must be above min`);
    min = from;
    max = to;
  } else if (fields.min !== undefined || fields.max !== undefined) return refuse(`${where}: only a slider has min and max`);
  return { id: controlId, kind, title, ...(fields.icon === undefined ? {} : { icon: fields.icon as string }), sizes, choices, min, max };
}

/** applet.json's `controls`. */
export function parseControls(value: unknown): AppletControl[] | Refusal {
  const controls = list(value, "controls", CONTROL_LIMITS.controls, parseControl);
  if (isRefusal(controls)) return controls;
  const ids = controls.map((control) => control.id);
  const twice = ids.find((each, at) => ids.indexOf(each) !== at);
  return twice ? refuse(`controls lists “${twice}” twice`) : controls;
}

/** What an applet says of one control (any part it leaves out stays as it was). */
export interface ControlUpdate {
  id: string;
  on?: boolean;
  detail?: string | null;
  choice?: string;
  value?: number;
  /** SVG markup in place of the manifest's icon (tinted; the menu bar glyph's rules). */
  glyph?: string;
}

/** `{"type":"control",…}` from an applet; the glyph is checked by the caller (protocol.ts's glyph rules). */
export function parseControlUpdate(raw: Record<string, unknown>): ({ type: "control" } & ControlUpdate) | Refusal {
  const fields = record(raw, "control", ["type", "id", "on", "detail", "choice", "value", "glyph"]);
  if (isRefusal(fields)) return fields;
  const controlId = id(fields.id, "control: id");
  if (isRefusal(controlId)) return controlId;
  if (fields.on !== undefined && typeof fields.on !== "boolean") return refuse("control: on must be true or false");
  const detail = fields.detail === null ? null : optionalText(fields.detail, "control: detail", CONTROL_LIMITS.detail);
  if (isRefusal(detail)) return detail;
  const choice = optionalText(fields.choice, "control: choice", CONTROL_LIMITS.choice);
  if (isRefusal(choice)) return choice;
  if (fields.value !== undefined && (typeof fields.value !== "number" || !Number.isFinite(fields.value))) return refuse("control: value must be a number");
  if (fields.glyph !== undefined && typeof fields.glyph !== "string") return refuse("control: glyph must be SVG markup");
  return {
    type: "control",
    id: controlId,
    ...(fields.on === undefined ? {} : { on: fields.on as boolean }),
    ...(detail === undefined ? {} : { detail }),
    ...(choice === undefined ? {} : { choice }),
    ...(fields.value === undefined ? {} : { value: fields.value as number }),
    ...(fields.glyph === undefined ? {} : { glyph: fields.glyph as string }),
  };
}

/** Whether an update fits the control it names: a toggle's `on`, a choice among its choices, a slider's value in range. */
export function checkUpdate(control: AppletControl, update: ControlUpdate): string | null {
  const where = `control “${control.id}”`;
  if (update.on !== undefined && control.kind !== "toggle") return `${where}: only a toggle is on or off`;
  if (update.choice !== undefined && (control.kind !== "choice" || !control.choices.includes(update.choice)))
    return `${where}: “${update.choice}” isn't one of its choices`;
  if (update.value !== undefined && (control.kind !== "slider" || update.value < control.min || update.value > control.max))
    return `${where}: value must be from ${control.min} to ${control.max}`;
  return null;
}

/** What Dashi asks of a control. */
export type ControlAction =
  | { action: "toggle"; on: boolean }
  | { action: "press" }
  | { action: "choose"; choice: string }
  | { action: "set"; value: number }
  | { action: "open" };

/** `{"type":"control-action",…}` from the shell (the applet's side); null for anything it can't read. */
export function parseControlAction(fields: Record<string, unknown>): ({ id: string } & ControlAction) | null {
  if (typeof fields.id !== "string") return null;
  const target = fields.id;
  switch (fields.action) {
    case "toggle":
      return typeof fields.on === "boolean" ? { id: target, action: "toggle", on: fields.on } : null;
    case "press":
      return { id: target, action: "press" };
    case "open":
      return { id: target, action: "open" };
    case "choose":
      return typeof fields.choice === "string" ? { id: target, action: "choose", choice: fields.choice } : null;
    case "set":
      return typeof fields.value === "number" && Number.isFinite(fields.value) ? { id: target, action: "set", value: fields.value } : null;
    default:
      return null;
  }
}

/** `{"type":"controls","shown":[…]}` from the shell: which of its controls are in Control Center now. */
export function parseShown(fields: Record<string, unknown>): string[] | null {
  const shown = fields.shown;
  return Array.isArray(shown) && shown.every((each) => typeof each === "string") ? (shown as string[]) : null;
}

/** The manifest's controls for its `controls` permission check: it must ask for it when it declares any. */
export function needsControlsPermission(controls: readonly AppletControl[], permissions: readonly string[]): string | null {
  return controls.length > 0 && !permissions.includes("controls") ? "controls need the “controls” permission" : null;
}
