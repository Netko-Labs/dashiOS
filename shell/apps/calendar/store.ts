/**
 * The calendars folder, `~/.local/share/dashi/calendars/` (`DASHI_CALENDAR_DIR`
 * moves it): one `.ics` file per calendar, the person's own. Every change
 * reads the file again, edits it, and writes it whole and atomically, so an
 * edit made by another program a moment earlier is not lost and no reader
 * sees half a file. Nothing is followed out of the folder: only regular files
 * named `<name>.ics` are calendars, never a symlink, and a name that came from
 * outside (an agent, the app) is checked before it is joined to a path.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRegularFile, writeAtomic, writeNew } from "../notes/files.ts";
import { type EventInput, makeEvent } from "./event.ts";
import { cleanName, isColor, MAX_ICS_BYTES, parseIcs, writeIcs } from "./ics.ts";
import { type CalEvent, type Calendar, CalendarError, type IcsFile } from "./types.ts";

export const EXTENSION = ".ics";
/** The colors new calendars take in turn: the Mac's calendar colors. */
export const PALETTE = ["#0a84ff", "#34c759", "#ff9500", "#af52de", "#ff3b30", "#a2845e", "#ffcc00"] as const;
export const DEFAULT_CALENDAR_NAME = "Home";
/** The most calendars one folder lists, and the most events one file may grow to by adding. */
export const MAX_CALENDARS = 100;
export const MAX_EVENTS_PER_CALENDAR = 20_000;

export function defaultRoot(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  if (env.DASHI_CALENDAR_DIR) return env.DASHI_CALENDAR_DIR;
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "dashi", "calendars");
}

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

export interface Scan {
  calendars: Calendar[];
  /** One sentence per file that could not be read, or per event that was kept but not shown. */
  problems: string[];
}

export class CalendarStore {
  constructor(readonly root: string) {}

  pathOf(id: string): string {
    if (!isCalendarId(id)) throw new CalendarError("That is not a calendar name.");
    return join(this.root, `${id}${EXTENSION}`);
  }

  private ids(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.root);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(EXTENSION) && isCalendarId(name.slice(0, -EXTENSION.length)) && isRegularFile(join(this.root, name)))
      .map((name) => name.slice(0, -EXTENSION.length))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_CALENDARS);
  }

  /** Every calendar in the folder, by name. A file that is not a calendar is left out and named in `problems`. */
  scan(): Scan {
    const calendars: Calendar[] = [];
    const problems: string[] = [];
    this.ids().forEach((id, index) => {
      try {
        const calendar = this.read(id, index);
        calendars.push(calendar);
        for (const problem of calendar.problems) problems.push(`${id}: ${problem}`);
      } catch (error) {
        problems.push(`${id}${EXTENSION} was not read: ${error instanceof CalendarError ? error.message : "it could not be opened."}`);
      }
    });
    return { calendars: calendars.sort((a, b) => a.name.localeCompare(b.name)), problems };
  }

  /** One calendar. `index` picks a color when the file names none. */
  read(id: string, index = 0): Calendar {
    const path = this.pathOf(id);
    if (!isRegularFile(path)) throw new CalendarError(`There is no calendar called “${id}”.`);
    if (lstatSync(path).size > MAX_ICS_BYTES) throw new CalendarError("That file is too large to be a calendar.");
    const file = parseIcs(readFileSync(path, "utf8"));
    return { ...file, id, name: file.name ?? id, color: file.color ?? (PALETTE[index % PALETTE.length] as string) };
  }

  private write(calendar: Calendar, create = false): void {
    const text = writeIcs(calendar);
    if (Buffer.byteLength(text) > MAX_ICS_BYTES) throw new CalendarError("That calendar is too large to save.");
    mkdirSync(this.root, { recursive: true });
    if (create) {
      try {
        writeNew(this.pathOf(calendar.id), text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CalendarError(`There is already a calendar called “${calendar.id}”.`);
        throw error;
      }
    } else writeAtomic(this.pathOf(calendar.id), text);
  }

  /** Reads `id` afresh, lets `change` edit it, and writes it back. */
  private mutate<T>(id: string, change: (calendar: Calendar) => T): T {
    const calendar = this.read(id, this.ids().indexOf(id));
    const result = change(calendar);
    this.write(calendar);
    return result;
  }

  // ---- Calendars ----------------------------------------------------------------

  /** Makes a calendar; a name already taken gets a number ("Work 2"). */
  create(name: string, color?: string): Calendar {
    const clean = cleanName(name);
    if (clean === "") throw new CalendarError("A calendar needs a name.");
    const taken = new Set(this.ids().map((id) => id.toLowerCase()));
    if (taken.size >= MAX_CALENDARS) throw new CalendarError(`There can be at most ${MAX_CALENDARS} calendars.`);
    const base = idFor(clean);
    let id = base;
    for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${base.slice(0, 70)} ${n}`;
    const calendar: Calendar = { id, name: clean, color: color !== undefined && isColor(color) ? color.toLowerCase() : (PALETTE[taken.size % PALETTE.length] as string), events: [], headerExtra: [], preserved: [], problems: [] };
    this.write(calendar, true);
    return calendar;
  }

  /** The calendars, making "Home" first when there are none. */
  ensureDefault(): Scan {
    if (this.ids().length === 0) this.create(DEFAULT_CALENDAR_NAME);
    return this.scan();
  }

  rename(id: string, name: string): void {
    const clean = cleanName(name);
    if (clean === "") throw new CalendarError("A calendar needs a name.");
    this.mutate(id, (calendar) => {
      calendar.name = clean;
    });
  }

  recolor(id: string, color: string): void {
    if (!isColor(color)) throw new CalendarError("A color is written like #0a84ff.");
    this.mutate(id, (calendar) => {
      calendar.color = color.toLowerCase();
    });
  }

  /** Deletes the calendar's file and every event in it. */
  remove(id: string): void {
    const path = this.pathOf(id);
    if (!isRegularFile(path)) throw new CalendarError(`There is no calendar called “${id}”.`);
    unlinkSync(path);
  }

  // ---- Events -------------------------------------------------------------------

  add(id: string, input: EventInput): CalEvent {
    return this.mutate(id, (calendar) => {
      if (calendar.events.length >= MAX_EVENTS_PER_CALENDAR) throw new CalendarError("That calendar has too many events.");
      const event = makeEvent(input);
      calendar.events.push(event);
      return event;
    });
  }

  /** Edits an event; with `moveTo` it also moves to that calendar. */
  update(id: string, uid: string, input: EventInput, moveTo?: string): CalEvent {
    if (moveTo !== undefined && moveTo !== id) {
      const existing = this.read(id).events.find((event) => event.uid === uid);
      if (!existing) throw new CalendarError("That event is not in the calendar any more.");
      // Added to the target first, so a failure never loses the event.
      const target = this.mutate(moveTo, (calendar) => {
        if (calendar.events.some((event) => event.uid === uid)) throw new CalendarError("That calendar already has this event.");
        const event = makeEvent(input, existing);
        calendar.events.push(event);
        return event;
      });
      this.mutate(id, (calendar) => {
        calendar.events = calendar.events.filter((event) => event.uid !== uid);
      });
      return target;
    }
    return this.mutate(id, (calendar) => {
      const at = calendar.events.findIndex((event) => event.uid === uid);
      if (at < 0) throw new CalendarError("That event is not in the calendar any more.");
      const event = makeEvent(input, calendar.events[at]);
      calendar.events[at] = event;
      return event;
    });
  }

  /** Deletes one occurrence of a repeating event (named by its start), leaving the others. */
  skip(id: string, uid: string, start: string): void {
    this.mutate(id, (calendar) => {
      const event = calendar.events.find((each) => each.uid === uid);
      if (!event) throw new CalendarError("That event is not in the calendar any more.");
      if (!event.repeat) throw new CalendarError("That event does not repeat.");
      if (!event.exdates.includes(start)) event.exdates.push(start);
      event.exdates.sort();
    });
  }

  delete(id: string, uid: string): void {
    this.mutate(id, (calendar) => {
      const before = calendar.events.length;
      calendar.events = calendar.events.filter((event) => event.uid !== uid);
      if (calendar.events.length === before) throw new CalendarError("That event is not in the calendar any more.");
    });
  }

  // ---- Import ---------------------------------------------------------------------

  /**
   * Adds an .ics file's events as a calendar of their own, named after the
   * file's X-WR-CALNAME, else `fallbackName`. The text is parsed strictly: a
   * file that is not iCalendar is refused, and events that cannot be read are
   * kept in the new file as written, not dropped.
   */
  importText(text: string, fallbackName: string): { calendar: Calendar; imported: number; skipped: number } {
    const file: IcsFile = parseIcs(text);
    const created = this.create(file.name ?? (cleanName(fallbackName) || "Imported"), file.color ?? undefined);
    const calendar: Calendar = { ...created, events: file.events, headerExtra: file.headerExtra, preserved: file.preserved, problems: file.problems };
    this.write(calendar);
    return { calendar, imported: file.events.length, skipped: file.problems.length };
  }

  exists(): boolean {
    return existsSync(this.root);
  }
}
