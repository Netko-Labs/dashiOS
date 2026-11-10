/**
 * What names a calendar: its id (a calendar is the file `<id>.ics`, so an id
 * is a name a file can take; store.ts checks one before it is joined to a
 * path, whoever sent it) and the color it takes.
 */

import { TINT_VALUES } from "@dashi/ui";
import { cleanName } from "./ics.ts";

export const EXTENSION = ".ics";

/** A calendar's id is its file name without ".ics": letters, digits, and `space . _ -` after a first letter or digit. */
export const isCalendarId = (value: unknown): value is string =>
  typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(value) && !value.includes("..") && !/[ .]$/.test(value);

/** A file-name-safe id for a calendar called `name`. */
export function idFor(name: string): string {
  const base = cleanName(name)
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[ .]+$/, "")
    .slice(0, 60)
    .replace(/[ .]+$/, "");
  return base === "" ? "Calendar" : base;
}

/**
 * The colors new calendars take in turn, and the ones the calendar sheet
 * offers: Dashi's tints (@dashi/ui), lowercase as the files keep them. No
 * red among them, since red is for deleting; a color a file brings stays.
 */
export const PALETTE: readonly string[] = TINT_VALUES.map((value) => value.toLowerCase());

/** The color the `count`-th new calendar takes. */
export const paletteColor = (count: number): string => PALETTE[count % PALETTE.length] ?? (PALETTE[0] as string);
