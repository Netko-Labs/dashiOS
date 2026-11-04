/**
 * Zenity's command line, read the way GLib's option parser reads it: long
 * options as `--name=value` or `--name value` (the next argument, whatever
 * it starts with), `--` ending the options, and everything else positional
 * (a list's cells, an entry's choices). Where Zenity would stop at an
 * option it does not know, this warns and goes on, so a script written for
 * a newer Zenity still gets its dialog.
 */

import { arityOf, type DialogKind, type FlagName, isDialogKind, type RepeatName, type ValueName } from "./options.ts";

export interface ParsedArgs {
  /** Every dialog type given, in order (one is right; none or two is an error). */
  kinds: DialogKind[];
  flags: Set<FlagName>;
  /** The last value of each value option. */
  values: Map<ValueName, string>;
  /** Every value of each repeatable option, in order. */
  repeats: Map<RepeatName, string[]>;
  positional: string[];
  /** Ignored options, one line each for stderr. */
  warnings: string[];
  /** `--help`, `--version`, or `--about`: answered without a window. */
  info: "help" | "version" | null;
  /** The command line can't be read (a value missing): Zenity's exit 255. */
  error: string | null;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    kinds: [],
    flags: new Set(),
    values: new Map(),
    repeats: new Map(),
    positional: [],
    warnings: [],
    info: null,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      parsed.positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "-?" || arg === "--help" || arg.startsWith("--help-")) {
      parsed.info ??= "help";
      continue;
    }
    if (!arg.startsWith("--") || arg === "-") {
      if (arg.startsWith("-") && arg !== "-") parsed.warnings.push(`unknown option ${arg}, ignored`);
      else parsed.positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
    const inline = equals < 0 ? null : arg.slice(equals + 1);
    if (name === "version" || name === "about") {
      parsed.info ??= "version";
      continue;
    }
    if (isDialogKind(name)) {
      parsed.kinds.push(name);
      if (inline !== null) parsed.warnings.push(`--${name} takes no value, "${inline}" ignored`);
      continue;
    }
    const arity = arityOf(name);
    if (arity === null) {
      parsed.warnings.push(`unknown option --${name}, ignored`);
      continue;
    }
    if (arity === "flag") {
      parsed.flags.add(name as FlagName);
      if (inline !== null) parsed.warnings.push(`--${name} takes no value, "${inline}" ignored`);
      continue;
    }
    let value = inline;
    if (value === null) {
      if (i + 1 >= argv.length) {
        parsed.error = `Missing argument for --${name}`;
        return parsed;
      }
      value = argv[++i] as string;
    }
    if (arity === "value") {
      parsed.values.set(name as ValueName, value);
    } else {
      const list = parsed.repeats.get(name as RepeatName) ?? [];
      list.push(value);
      parsed.repeats.set(name as RepeatName, list);
    }
  }
  return parsed;
}
