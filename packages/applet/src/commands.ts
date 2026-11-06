/**
 * Commands an applet adds to the launcher (docs/applets.md, "Commands"):
 * declared in applet.json, so the launcher finds them before the applet has
 * ever run, and carried out over protocol 3 (protocol.ts: `run`, `result`,
 * `items`, `view`). Everything here parses what arrives from an applet, as
 * untrusted as the rest of its messages.
 *
 *   "commands": [
 *     { "id": "refresh", "title": "Refresh the weather", "keywords": ["update"], "mode": "instant" },
 *     { "id": "city", "title": "Weather in a city", "mode": "pick" },
 *     { "id": "radar", "title": "Rain radar", "mode": "view" }
 *   ]
 *
 * A mode says what choosing it is like:
 * - `instant`: it runs, and its `result` is a line in the launcher, the clipboard, or something opened;
 * - `pick`: the launcher asks it for rows as the person types (`items`), draws them, and runs the one chosen;
 * - `view`: the applet's own Metal host draws its answer where the launcher's rows were.
 */

import { id, isRefusal, list, type Refusal, record, refuse, text } from "./parse.ts";

export const COMMAND_MODES = ["instant", "pick", "view"] as const;
export type CommandMode = (typeof COMMAND_MODES)[number];

export const ARG_TYPES = ["string", "number", "boolean"] as const;
export type CommandArgType = (typeof ARG_TYPES)[number];

export interface CommandArg {
  /** Its name in `run`'s `args`, and in a `dashi://` address's query. */
  name: string;
  type: CommandArgType;
  /** What the person is asked for ("City"). */
  title?: string;
  required: boolean;
}

export interface AppletCommand {
  id: string;
  /** Sentence case, as the launcher's row shows it ("Weather in a city"). */
  title: string;
  /** Other words it is found by. */
  keywords: string[];
  args: CommandArg[];
  mode: CommandMode;
}

export const COMMAND_LIMITS = {
  /** Commands one applet may add. */
  commands: 16,
  title: 60,
  keywords: 12,
  keyword: 40,
  args: 4,
  /** Rows one `items` may carry. */
  rows: 20,
  rowTitle: 80,
  rowDetail: 80,
  /** Characters of a `result` line, and of what it copies. */
  text: 2000,
  copy: 16 * 1024,
  /** Characters of what a `result` opens. */
  open: 2048,
  /** A `view`'s height in points. */
  view: { minHeight: 40, maxHeight: 400 },
} as const;

const ARG_NAME = /^[a-z_][a-z0-9_]{0,31}$/;

function parseArg(value: unknown, where: string): CommandArg | Refusal {
  const fields = record(value, where, ["name", "type", "title", "required"]);
  if (isRefusal(fields)) return fields;
  if (typeof fields.name !== "string" || !ARG_NAME.test(fields.name)) return refuse(`${where}: name must be lowercase letters, digits and _ (32 at most)`);
  const type = ARG_TYPES.find((each) => each === fields.type);
  if (!type) return refuse(`${where}: type must be one of ${ARG_TYPES.join(", ")}`);
  const title = fields.title === undefined ? undefined : text(fields.title, `${where}: title`, 40);
  if (isRefusal(title)) return title;
  if (fields.required !== undefined && typeof fields.required !== "boolean") return refuse(`${where}: required must be true or false`);
  return { name: fields.name, type, ...(title === undefined ? {} : { title }), required: fields.required === true };
}

function parseCommand(value: unknown, where: string): AppletCommand | Refusal {
  const fields = record(value, where, ["id", "title", "keywords", "args", "mode"]);
  if (isRefusal(fields)) return fields;
  const commandId = id(fields.id, `${where}: id`);
  if (isRefusal(commandId)) return commandId;
  const title = text(fields.title, `${where}: title`, COMMAND_LIMITS.title);
  if (isRefusal(title)) return title;
  const keywords = list(fields.keywords ?? [], `${where}: keywords`, COMMAND_LIMITS.keywords, (entry, at) => text(entry, at, COMMAND_LIMITS.keyword));
  if (isRefusal(keywords)) return keywords;
  const args = list(fields.args ?? [], `${where}: args`, COMMAND_LIMITS.args, parseArg);
  if (isRefusal(args)) return args;
  const names = args.map((arg) => arg.name);
  const twice = names.find((name, at) => names.indexOf(name) !== at);
  if (twice) return refuse(`${where}: args names “${twice}” twice`);
  const mode = COMMAND_MODES.find((each) => each === fields.mode);
  if (!mode) return refuse(`${where}: mode must be one of ${COMMAND_MODES.join(", ")}`);
  return { id: commandId, title, keywords, args, mode };
}

/** applet.json's `commands`. */
export function parseCommands(value: unknown): AppletCommand[] | Refusal {
  const commands = list(value, "commands", COMMAND_LIMITS.commands, parseCommand);
  if (isRefusal(commands)) return commands;
  const ids = commands.map((command) => command.id);
  const twice = ids.find((each, at) => ids.indexOf(each) !== at);
  return twice ? refuse(`commands lists “${twice}” twice`) : commands;
}

/** A command's arguments as JSON Schema properties (what an action's `properties` are). */
export function argSchema(command: Pick<AppletCommand, "args">): { properties: Record<string, unknown>; required: string[] } {
  return {
    properties: Object.fromEntries(command.args.map((arg) => [arg.name, { type: arg.type, ...(arg.title ? { description: arg.title } : {}) }])),
    required: command.args.filter((arg) => arg.required).map((arg) => arg.name),
  };
}

/** Values a command was given: only its own names, each of its type, every required one there; or what is wrong, in words. */
export function checkArgs(
  command: Pick<AppletCommand, "args">,
  args: Record<string, unknown>,
): { values: Record<string, string | number | boolean> } | Refusal {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(args)) {
    const arg = command.args.find((each) => each.name === name);
    if (!arg) return refuse(`It takes no “${name}”.`);
    if (arg.type === "string" && (typeof value !== "string" || value.length > 1000)) return refuse(`“${arg.title ?? name}” must be text.`);
    if (arg.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return refuse(`“${arg.title ?? name}” must be a number.`);
    if (arg.type === "boolean" && typeof value !== "boolean") return refuse(`“${arg.title ?? name}” must be true or false.`);
    out[name] = value as string | number | boolean;
  }
  const missing = command.args.find((arg) => arg.required && !(arg.name in out));
  return missing ? refuse(`It needs “${missing.title ?? missing.name}”.`) : { values: out };
}

/** One row of a pick command's answer, drawn by the shell. */
export interface CommandRow {
  id: string;
  title: string;
  detail?: string;
}

function parseRow(value: unknown, where: string): CommandRow | Refusal {
  const fields = record(value, where, ["id", "title", "detail"]);
  if (isRefusal(fields)) return fields;
  const rowId = id(fields.id, `${where}: id`);
  if (isRefusal(rowId)) return rowId;
  const title = text(fields.title, `${where}: title`, COMMAND_LIMITS.rowTitle);
  if (isRefusal(title)) return title;
  const detail = fields.detail === undefined ? undefined : text(fields.detail, `${where}: detail`, COMMAND_LIMITS.rowDetail);
  if (isRefusal(detail)) return detail;
  return { id: rowId, title, ...(detail === undefined ? {} : { detail }) };
}

export function parseRows(value: unknown): CommandRow[] | Refusal {
  const rows = list(value, "items: rows", COMMAND_LIMITS.rows, parseRow);
  if (isRefusal(rows)) return rows;
  const ids = rows.map((row) => row.id);
  const twice = ids.find((each, at) => ids.indexOf(each) !== at);
  return twice ? refuse(`items: rows has “${twice}” twice`) : rows;
}

/** What a command came to: a line to show, text to copy, something to open, or why it couldn't. */
export type CommandResult = { text: string } | { copy: string } | { open: string } | { error: string };

/** What a result may open: a web page, or a place in Dashi. */
const OPENABLE = /^(https?:\/\/[^\s"<>]+|dashi:\/\/[^\s"<>]+)$/;

/** A `result`'s answer: exactly one of text, copy, open, error. */
export function parseResult(fields: Record<string, unknown>): CommandResult | Refusal {
  const given = (["text", "copy", "open", "error"] as const).filter((key) => fields[key] !== undefined);
  if (given.length !== 1) return refuse("result: give one of text, copy, open, or error");
  const [key] = given as ["text" | "copy" | "open" | "error"];
  const value = fields[key];
  if (key === "copy") {
    if (typeof value !== "string" || value === "" || value.length > COMMAND_LIMITS.copy)
      return refuse(`result: copy must be text of ${COMMAND_LIMITS.copy} characters at most`);
    return { copy: value };
  }
  if (key === "open") {
    if (typeof value !== "string" || value.length > COMMAND_LIMITS.open || !OPENABLE.test(value))
      return refuse("result: open must be an https:// or dashi:// address");
    return { open: value };
  }
  const line = text(value, `result: ${key}`, COMMAND_LIMITS.text);
  if (isRefusal(line)) return line;
  return key === "text" ? { text: line } : { error: line };
}
