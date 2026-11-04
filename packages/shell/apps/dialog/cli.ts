/**
 * The command line's answer before any window: the dialog to show, or what
 * to print and the exit status for `--help`, `--version`, a bad command line
 * (255, Zenity's -1), and a type not drawn yet. Warnings for ignored options
 * go to stderr either way.
 */

import { parseArgs } from "./args.ts";
import { type DialogSpec, specFrom } from "./spec.ts";

/** The Zenity release whose command line this follows; `--version` prints it, for scripts that check. */
export const ZENITY_VERSION = "4.0.0";

export const USAGE = `Usage: dashi-dialog [OPTION…]  (Zenity's command line)

Dialogs:
  --info, --warning, --error, --question   a message (--text, --no-wrap, --no-markup,
                                           --default-cancel, --switch, --icon)
  --progress      stdin: a number sets the bar, "#text" its text (--percentage,
                  --pulsate, --auto-close, --auto-kill, --no-cancel, --time-remaining)
  --entry         a line of text (--entry-text, --hide-text)
  --password      a password (--username)
  --list          rows of --column's (--checklist, --radiolist, --multiple,
                  --separator, --print-column, --hide-column, --hide-header)
  --text-info     a file or stdin (--filename, --editable, --checkbox)
  --scale         a number (--value, --min-value, --max-value, --step,
                  --print-partial, --hide-value)
  --calendar      a day (--day, --month, --year, --date-format)

Every dialog: --title, --width, --height, --timeout, --ok-label, --cancel-label,
--extra-button. Exit status: 0 OK or Yes, 1 Cancel, No, or closed, 5 timed out,
255 an error.
`;

export type Prepared =
  | { spec: DialogSpec; stderr: string[] }
  | {
      /** No window: print these and exit. */
      exit: number;
      stdout: string;
      stderr: string[];
    };

export function prepare(argv: readonly string[], now: Date = new Date()): Prepared {
  const parsed = parseArgs(argv);
  const stderr = parsed.warnings.map((warning) => `dashi-dialog: ${warning}`);
  if (parsed.info === "help") return { exit: 0, stdout: USAGE, stderr };
  if (parsed.info === "version") return { exit: 0, stdout: `${ZENITY_VERSION}\n`, stderr };
  const result = specFrom(parsed, now);
  if ("error" in result) return { exit: 255, stdout: "", stderr: [...stderr, `dashi-dialog: ${result.error}`] };
  if ("unsupported" in result) {
    return { exit: 255, stdout: "", stderr: [...stderr, `dashi-dialog: --${result.unsupported} is not supported yet`] };
  }
  return { spec: result.spec, stderr };
}
