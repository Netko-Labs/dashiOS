/**
 * File › Import…: the desktop's own file chooser through xdg-desktop-portal
 * (`org.freedesktop.portal.FileChooser.OpenFile` on the session bus, as the
 * Wallpaper pane's Add Photo… does), then the chosen .ics file is read. Where
 * there is no portal (a development run) `choose` rejects and the app asks
 * for the path to type instead.
 */

import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute } from "node:path";
import { MAX_ICS_BYTES } from "../../../src/shared/calendar/ics.ts";
import { CalendarError } from "../../../src/shared/calendar/types.ts";
import type { DBusConnection } from "../../../src/shared/dbus/index.ts";
import { isRealDirectory, writeNew } from "../../../src/shared/fs/index.ts";
import { chooseFile } from "../../../src/shared/portal/index.ts";

const EXTENSIONS = new Set([".ics", ".ical", ".ifb", ".icalendar"]);

/** Whether a path names a file Calendar imports (by its extension). */
export const isIcsPath = (path: string): boolean => EXTENSIONS.has(extname(path).toLowerCase());

/** Picks an iCalendar file; null when the person cancelled. */
export interface IcsChooser {
  choose(): Promise<string | null>;
}

export function portalIcsChooser(connect?: () => Promise<DBusConnection>): IcsChooser {
  return { choose: () => chooseFile({ title: "Import Calendar", filter: { name: "Calendars", types: ["text/calendar"] }, accept: isIcsPath }, connect) };
}

/** A typed path: `~/` is the home folder; it must then be absolute. */
function fullPath(path: string): string {
  const trimmed = path.trim().replace(/^~(?=\/)/, process.env.HOME ?? "~");
  if (!isAbsolute(trimmed)) throw new CalendarError("Give the full path of the file, starting with /.");
  return trimmed;
}

/** File › Export…: a calendar's text written as a new .ics file; a file that is there already is left alone. */
export function writeIcsFile(path: string, text: string): string {
  const target = fullPath(path);
  if (!isIcsPath(target)) throw new CalendarError("The file's name must end in .ics.");
  if (!isRealDirectory(dirname(target))) throw new CalendarError("That folder isn't there.");
  try {
    writeNew(target, text);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new CalendarError("A file of that name is there already.");
    throw new CalendarError("The file couldn't be written there.");
  }
  return target;
}

/** What a typed path or a chosen one comes to: an iCalendar file's text and a name to call the calendar by if the file names none. */
export function readIcsFile(path: string): { text: string; name: string } {
  const trimmed = fullPath(path);
  if (!isIcsPath(trimmed)) throw new CalendarError("That is not an .ics file.");
  let size: number;
  try {
    const stat = statSync(trimmed);
    if (!stat.isFile()) throw new CalendarError("That is not a file.");
    size = stat.size;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError("That file could not be opened.");
  }
  if (size > MAX_ICS_BYTES) throw new CalendarError("That file is too large to be a calendar.");
  try {
    return { text: readFileSync(trimmed, "utf8"), name: basename(trimmed, extname(trimmed)) };
  } catch {
    throw new CalendarError("That file could not be read.");
  }
}
