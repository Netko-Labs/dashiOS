/**
 * Zenity's options, by name: the dialog types, and for every other option
 * whether it is a switch, takes a value, or takes one each time it is given
 * (`--column`, `--extra-button`). Options Dashi does not act on (`--modal`,
 * `--window-icon`, `--font`) are listed too, so their values are taken off
 * the command line instead of being read as list rows.
 */

export const DIALOG_KINDS = [
  "info",
  "warning",
  "error",
  "question",
  "progress",
  "entry",
  "password",
  "list",
  "text-info",
  "scale",
  "calendar",
  "file-selection",
  "forms",
  "color-selection",
  "notification",
] as const;

export type DialogKind = (typeof DIALOG_KINDS)[number];

export type Arity = "flag" | "value" | "repeat";

const FLAGS = [
  // General.
  "modal",
  // Messages.
  "no-wrap",
  "no-markup",
  "ellipsize",
  "default-cancel",
  "switch",
  // Progress.
  "pulsate",
  "auto-close",
  "auto-kill",
  "no-cancel",
  "time-remaining",
  // Entry and password.
  "hide-text",
  "username",
  // List.
  "checklist",
  "radiolist",
  "imagelist",
  "multiple",
  "editable",
  "hide-header",
  "mid-search",
  // Text info.
  "html",
  "auto-scroll",
  // Scale.
  "print-partial",
  "hide-value",
  // File selection.
  "directory",
  "save",
  "confirm-overwrite",
  // Notification.
  "listen",
  // Color selection.
  "show-palette",
  // Forms.
  "add-password",
  "show-header",
] as const;

const VALUES = [
  // General.
  "title",
  "window-icon",
  "width",
  "height",
  "timeout",
  "ok-label",
  "cancel-label",
  "attach",
  "display",
  "class",
  "name",
  // Messages and every dialog's prompt.
  "text",
  "icon",
  "icon-name",
  // Progress.
  "percentage",
  // Entry.
  "entry-text",
  // List.
  "separator",
  "print-column",
  "hide-column",
  // Text info.
  "filename",
  "font",
  "checkbox",
  "url",
  // Scale.
  "value",
  "min-value",
  "max-value",
  "step",
  // Calendar.
  "day",
  "month",
  "year",
  "date-format",
  // Notification.
  "hint",
  // Color selection.
  "color",
  // Forms.
  "forms-date-format",
  "list-values",
  "column-values",
  "combo-values",
] as const;

const REPEATS = ["extra-button", "column", "file-filter", "add-entry", "add-calendar", "add-list", "add-combo"] as const;

export type FlagName = (typeof FLAGS)[number];
export type ValueName = (typeof VALUES)[number];
export type RepeatName = (typeof REPEATS)[number];

const ARITY = new Map<string, Arity>([
  ...FLAGS.map((name): [string, Arity] => [name, "flag"]),
  ...VALUES.map((name): [string, Arity] => [name, "value"]),
  ...REPEATS.map((name): [string, Arity] => [name, "repeat"]),
]);

const KINDS: ReadonlySet<string> = new Set(DIALOG_KINDS);

export function isDialogKind(name: string): name is DialogKind {
  return KINDS.has(name);
}

/** How an option is given, or null for one Zenity does not have. */
export function arityOf(name: string): Arity | null {
  return ARITY.get(name) ?? null;
}
