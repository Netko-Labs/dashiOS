import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ICS_BYTES } from "../src/shared/calendar/ics.ts";
import { CalendarStore } from "../src/shared/calendar/store.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-calendar-import-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ics = (events: string[]): string => ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Trips", ...events, "END:VCALENDAR", ""].join("\r\n");
const event = (n: number, note = ""): string =>
  [
    "BEGIN:VEVENT",
    `UID:trip-${n}@example`,
    "DTSTAMP:20261105T100000Z",
    "DTSTART:20261106T120000Z",
    "DTEND:20261106T130000Z",
    `SUMMARY:Trip ${n}`,
    `DESCRIPTION:${note}`,
    "END:VEVENT",
  ].join("\r\n");

test("an .ics file comes in as a calendar of its own", () => {
  const store = new CalendarStore(root);
  const result = store.importText(ics([event(1), event(2)]), "holiday");
  expect(result).toMatchObject({ imported: 2, duplicates: 0 });
  expect(result.calendar.name).toBe("Trips");
  expect(store.scan().calendars.map((calendar) => calendar.events.length)).toEqual([2]);
});

test("an import that can't be saved leaves no empty calendar behind", () => {
  const store = new CalendarStore(root);
  // Small enough to read, too large to save once written out.
  const note = "x".repeat(50_000);
  const many = Array.from({ length: Math.ceil((MAX_ICS_BYTES * 1.2) / note.length) }, (_, n) => event(n, note));
  expect(() => store.importText(ics(many), "holiday")).toThrow("too large");
  expect(readdirSync(root)).toEqual([]);
});
