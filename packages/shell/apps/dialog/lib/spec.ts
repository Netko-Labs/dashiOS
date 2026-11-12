/**
 * What to show, from the command line: the dialog type, the options every
 * dialog has (title, size, buttons, timeout), and the type's own, with
 * Zenity's defaults filled in and its numbers checked. A bad command line is
 * an error string; main.tsx prints it and exits 255 as Zenity does.
 */

import type { ParsedArgs } from "./args.ts";
import { type FileSelectionOptions, parseFileFilter } from "./file-selection.ts";
import { compressEscapes, displayText } from "./markup.ts";
import type { DialogKind } from "./options.ts";

export type MessageKind = "info" | "warning" | "error" | "question";

export interface Common {
  title: string;
  width: number | null;
  height: number | null;
  /** Seconds; the dialog goes with exit 5 after it. */
  timeout: number | null;
  /** The prompt, escapes expanded and markup taken out. */
  text: string;
  okLabel: string;
  cancelLabel: string;
  /** Labels of buttons beside OK and Cancel: pressing one prints it and exits 1. */
  extraButtons: string[];
}

export interface MessageSpec extends Common {
  kind: MessageKind;
  noWrap: boolean;
  /** A question's Enter is No. */
  defaultCancel: boolean;
  /** A question with only the extra buttons. */
  noButtons: boolean;
}

export interface ProgressSpec extends Common {
  kind: "progress";
  percentage: number;
  pulsate: boolean;
  autoClose: boolean;
  /** Cancel sends SIGHUP to the program that started the dialog. */
  autoKill: boolean;
  noCancel: boolean;
  timeRemaining: boolean;
  noMarkup: boolean;
}

export interface EntrySpec extends Common {
  kind: "entry";
  entryText: string;
  hideText: boolean;
}

export interface PasswordSpec extends Common {
  kind: "password";
  username: boolean;
}

export interface ListSpec extends Common {
  kind: "list";
  columns: string[];
  /** Cells from the command line, row by row; none means they come on stdin. */
  cells: string[];
  mode: "plain" | "checklist" | "radiolist";
  multiple: boolean;
  separator: string;
  /** 1-based columns to print, or every column. */
  printColumns: number[] | "all";
  /** 1-based columns not drawn (they can still be printed). */
  hiddenColumns: number[];
  hideHeader: boolean;
}

export interface TextInfoSpec extends Common {
  kind: "text-info";
  /** A file to show; without one, stdin. */
  filename: string | null;
  editable: boolean;
  /** A box to tick before OK is enabled ("I have read and accept"). */
  checkbox: string | null;
}

export interface ScaleSpec extends Common {
  kind: "scale";
  value: number;
  min: number;
  max: number;
  step: number;
  printPartial: boolean;
  hideValue: boolean;
}

export interface CalendarSpec extends Common {
  kind: "calendar";
  /** The day first shown and chosen, as year, month (1-12), day. */
  year: number;
  month: number;
  day: number;
  dateFormat: string | null;
}

/** `--file-selection`: Files' chooser (file-selection.ts). */
export interface FileSelectionSpec extends Common, FileSelectionOptions {
  kind: "file-selection";
}

export type DialogSpec = MessageSpec | ProgressSpec | EntrySpec | PasswordSpec | ListSpec | TextInfoSpec | ScaleSpec | CalendarSpec | FileSelectionSpec;

/** Types Zenity has that Dashi's dialog doesn't draw yet: they exit 255 with a message. */
export const UNSUPPORTED: ReadonlySet<DialogKind> = new Set(["forms", "color-selection", "notification"]);

const TITLES: Record<DialogKind, string> = {
  info: "Information",
  warning: "Warning",
  error: "Error",
  question: "Question",
  progress: "Progress",
  entry: "Add a new entry",
  password: "Type your password",
  list: "Select items from the list",
  "text-info": "Text View",
  scale: "Adjust the scale value",
  calendar: "Calendar selection",
  "file-selection": "Select a file",
  forms: "Forms dialog",
  "color-selection": "Select a color",
  notification: "Notification",
};

const TEXTS: Record<DialogKind, string> = {
  info: "All updates are complete.",
  warning: "Are you sure you want to proceed?",
  error: "An error has occurred.",
  question: "Are you sure you want to proceed?",
  progress: "Running...",
  entry: "Enter new text:",
  password: "Type your password",
  list: "Select items from the list below.",
  "text-info": "",
  scale: "Adjust the scale value",
  calendar: "Select a date from below.",
  "file-selection": "",
  forms: "",
  "color-selection": "",
  notification: "",
};

class SpecError extends Error {}

function integer(args: ParsedArgs, name: Parameters<ParsedArgs["values"]["get"]>[0], fallback: number): number {
  const raw = args.values.get(name);
  if (raw === undefined) return fallback;
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) throw new SpecError(`Cannot parse integer value '${raw}' for --${name}`);
  return Number.parseInt(raw, 10);
}

function optionalInteger(args: ParsedArgs, name: Parameters<ParsedArgs["values"]["get"]>[0]): number | null {
  return args.values.has(name) ? integer(args, name, 0) : null;
}

/** "ALL", or column numbers separated by commas ("2", "1,3"). */
function columnsOf(raw: string, name: string): number[] | "all" {
  if (raw.trim().toUpperCase() === "ALL") return "all";
  const numbers = raw.split(",").map((part) => part.trim());
  if (numbers.some((part) => !/^\d+$/.test(part))) throw new SpecError(`Cannot parse column '${raw}' for --${name}`);
  return numbers.map(Number).filter((n) => n > 0);
}

function common(args: ParsedArgs, kind: DialogKind): Common {
  const noMarkup = args.flags.has("no-markup");
  const size = (name: "width" | "height"): number | null => {
    const value = optionalInteger(args, name);
    return value !== null && value > 0 ? value : null;
  };
  const timeout = optionalInteger(args, "timeout");
  return {
    title: args.values.get("title") ?? TITLES[kind],
    width: size("width"),
    height: size("height"),
    timeout: timeout !== null && timeout > 0 ? timeout : null,
    text: displayText(args.values.get("text") ?? TEXTS[kind], noMarkup),
    okLabel: args.values.get("ok-label") ?? (kind === "question" ? "Yes" : "OK"),
    cancelLabel: args.values.get("cancel-label") ?? (kind === "question" ? "No" : "Cancel"),
    extraButtons: args.repeats.get("extra-button") ?? [],
  };
}

function listSpec(args: ParsedArgs, base: ReturnType<typeof common>): DialogSpec {
  const flag = (name: Parameters<ParsedArgs["flags"]["has"]>[0]): boolean => args.flags.has(name);
  const columns = args.repeats.get("column") ?? [];
  if (columns.length === 0) throw new SpecError("No column titles specified for List dialog.");
  const mode = flag("checklist") ? "checklist" : flag("radiolist") ? "radiolist" : "plain";
  const printRaw = args.values.get("print-column");
  return {
    ...base,
    kind: "list",
    columns,
    cells: args.positional,
    mode,
    multiple: flag("multiple"),
    // Zenity expands escapes in it ("\n" puts each choice on its own line).
    separator: compressEscapes(args.values.get("separator") ?? "|"),
    printColumns: printRaw === undefined ? [mode === "plain" ? 1 : 2] : columnsOf(printRaw, "print-column"),
    hiddenColumns: (() => {
      const raw = args.values.get("hide-column");
      const hidden = raw === undefined ? [] : columnsOf(raw, "hide-column");
      return hidden === "all" ? [] : hidden;
    })(),
    hideHeader: flag("hide-header"),
  };
}

function buildSpec(args: ParsedArgs, kind: Exclude<DialogKind, "forms" | "color-selection" | "notification">, now: Date): DialogSpec {
  const base = common(args, kind);
  const flag = (name: Parameters<ParsedArgs["flags"]["has"]>[0]): boolean => args.flags.has(name);
  switch (kind) {
    case "info":
    case "warning":
    case "error":
    case "question":
      return { ...base, kind, noWrap: flag("no-wrap"), defaultCancel: kind === "question" && flag("default-cancel"), noButtons: flag("switch") };
    case "progress": {
      const raw = args.values.get("percentage") ?? "0";
      const percentage = Number.parseFloat(raw);
      if (!Number.isFinite(percentage)) throw new SpecError(`Cannot parse value '${raw}' for --percentage`);
      return {
        ...base,
        kind,
        percentage: Math.min(Math.max(percentage, 0), 100),
        pulsate: flag("pulsate"),
        autoClose: flag("auto-close"),
        autoKill: flag("auto-kill"),
        noCancel: flag("no-cancel"),
        timeRemaining: flag("time-remaining"),
        noMarkup: flag("no-markup"),
      };
    }
    case "entry":
      return { ...base, kind, entryText: args.values.get("entry-text") ?? "", hideText: flag("hide-text") };
    case "password":
      return { ...base, kind, username: flag("username") };
    case "list":
      return listSpec(args, base);
    case "text-info":
      return { ...base, kind, filename: args.values.get("filename") ?? null, editable: flag("editable"), checkbox: args.values.get("checkbox") ?? null };
    case "scale": {
      const min = integer(args, "min-value", 0);
      const max = integer(args, "max-value", 100);
      const step = integer(args, "step", 1);
      const value = integer(args, "value", min);
      if (max <= min) throw new SpecError("Maximum value must be greater than minimum value.");
      if (value < min || value > max) throw new SpecError("Value out of range.");
      return { ...base, kind, min, max, value, step: step > 0 ? step : 1, printPartial: flag("print-partial"), hideValue: flag("hide-value") };
    }
    case "file-selection":
      return {
        ...base,
        // A save or a folder isn't "Select a file": the title says what is chosen, unless the caller named one.
        title: args.values.get("title") ?? (flag("directory") ? "Choose a folder" : flag("save") ? "Save a file" : base.title),
        kind,
        filename: args.values.get("filename") ?? null,
        multiple: flag("multiple"),
        directory: flag("directory"),
        save: flag("save"),
        separator: compressEscapes(args.values.get("separator") ?? "|"),
        filters: (args.repeats.get("file-filter") ?? []).flatMap((raw) => parseFileFilter(raw) ?? []),
      };
    case "calendar": {
      const year = integer(args, "year", now.getFullYear());
      const month = integer(args, "month", now.getMonth() + 1);
      const day = integer(args, "day", now.getDate());
      if (month < 1 || month > 12) throw new SpecError(`Invalid value for --month: ${month}`);
      if (day < 1 || day > 31) throw new SpecError(`Invalid value for --day: ${day}`);
      return { ...base, kind, year, month, day, dateFormat: args.values.get("date-format") ?? null };
    }
  }
}

export type SpecResult = { spec: DialogSpec } | { unsupported: DialogKind } | { error: string };

/** The dialog the command line asks for, or why there is none. */
export function specFrom(args: ParsedArgs, now: Date = new Date()): SpecResult {
  if (args.error) return { error: args.error };
  const [kind, second] = args.kinds;
  if (!kind) return { error: "You must specify a dialog type. See 'zenity --help' for details" };
  if (second && second !== kind) return { error: "Two or more dialog options specified" };
  if (UNSUPPORTED.has(kind)) return { unsupported: kind };
  try {
    return { spec: buildSpec(args, kind as Parameters<typeof buildSpec>[1], now) };
  } catch (error) {
    if (error instanceof SpecError) return { error: error.message };
    throw error;
  }
}
