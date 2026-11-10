import { expect, test } from "bun:test";
import { parseIcs, writeIcs } from "../src/shared/calendar/ics.ts";
import { occurrencesOf } from "../src/shared/calendar/recurrence.ts";
import { formatRule, parseRule } from "../src/shared/calendar/rules.ts";
import type { CalEvent } from "../src/shared/calendar/types.ts";

const LISBON = "Europe/Lisbon";
const ics = (...lines: string[]): string => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n");

const GOOGLE = ics(
  "X-WR-CALNAME:Work",
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTAMP:20261101T120000Z",
  "DTSTART;TZID=America/New_York:20261102T090000",
  "DTEND;TZID=America/New_York:20261102T091500",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
  "EXDATE;TZID=America/New_York:20261109T090000",
  "SUMMARY:Standup",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTAMP:20261101T120000Z",
  "RECURRENCE-ID:20261105T140000Z",
  "DTSTART;TZID=America/New_York:20261105T110000",
  "DTEND;TZID=America/New_York:20261105T113000",
  "SUMMARY:Standup (moved)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTAMP:20261101T120000Z",
  "RECURRENCE-ID;TZID=America/New_York:20261112T090000",
  "DTSTART;TZID=America/New_York:20261112T090000",
  "DTEND;TZID=America/New_York:20261112T091500",
  "STATUS:CANCELLED",
  "SUMMARY:Standup",
  "END:VEVENT",
);

test("a time keeps its zone, and a moved occurrence of a repeat is shown where it went", () => {
  const file = parseIcs(GOOGLE);
  expect(file.problems).toEqual([]);
  const [event] = file.events as [CalEvent];
  expect(event.zone).toBe("America/New_York");
  expect(event.start).toBe("2026-11-02T09:00");
  expect(event.exdates).toEqual(["2026-11-09T09:00"]);
  // The override's RECURRENCE-ID was written in UTC: it is the 9:00 in New York.
  expect(event.overrides.map((each) => each.recurrenceId)).toEqual(["2026-11-05T09:00", "2026-11-12T09:00"]);
  const shown = occurrencesOf(event, "Work", "2026-11-02T00:00", "2026-11-14T00:00", 100, LISBON);
  expect(shown.map((each) => [each.start, each.event.title])).toEqual([
    ["2026-11-02T14:00", "Standup"],
    ["2026-11-05T16:00", "Standup (moved)"],
    // The 9th was deleted and the 12th cancelled.
  ]);
  expect(shown[1]?.recurrenceId).toBe("2026-11-05T09:00");
});

test("written back, the zones, the VTIMEZONE, and the changed occurrences stay", () => {
  const file = parseIcs(GOOGLE);
  const text = writeIcs({ ...file, name: "Work", color: "#2f6f5a" });
  expect(text).toContain("DTSTART;TZID=America/New_York:20261102T090000");
  expect(text).toContain("BEGIN:VTIMEZONE");
  expect(text).toContain("RECURRENCE-ID;TZID=America/New_York:20261105T090000");
  expect(text).toContain("STATUS:CANCELLED");
  const again = parseIcs(text);
  expect(again.events).toEqual(file.events.map((event) => ({ ...event })));
  expect(again.timezones).toEqual(file.timezones);
});

test("a UTC time stays UTC; a floating one stays floating", () => {
  const file = parseIcs(
    ics(
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART:20261105T140000Z",
      "DTEND:20261105T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "DTSTART:20261105T090000",
      "END:VEVENT",
    ),
  );
  expect(file.events.map((event) => [event.zone, event.start])).toEqual([
    ["UTC", "2026-11-05T14:00"],
    [null, "2026-11-05T09:00"],
  ]);
  const text = writeIcs({ ...file, name: "X", color: "#2f6f5a" });
  expect(text).toContain("DTSTART:20261105T140000Z");
  expect(text).toContain("DTSTART:20261105T090000\r\n");
});

test("a changed occurrence whose repeat is not in the file is kept, not shown", () => {
  const file = parseIcs(ics("BEGIN:VEVENT", "UID:x", "RECURRENCE-ID:20261105T090000", "DTSTART:20261105T100000", "SUMMARY:Lost", "END:VEVENT"));
  expect(file.events).toEqual([]);
  expect(file.problems[0]).toContain("Lost");
  expect(file.preserved).toContain("RECURRENCE-ID:20261105T090000");
});

test("rules Calendar reads now: nth weekdays, days of the month, months, set positions", () => {
  expect(parseRule("FREQ=MONTHLY;BYDAY=1MO")).toEqual({ freq: "monthly", interval: 1, byNth: [{ n: 1, day: 1 }] });
  expect(parseRule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1")).toEqual({ freq: "monthly", interval: 1, byDay: [1, 2, 3, 4, 5], bySetPos: [-1] });
  expect(parseRule("FREQ=YEARLY;BYMONTH=11;BYDAY=4TH")).toEqual({ freq: "yearly", interval: 1, byMonth: [11], byNth: [{ n: 4, day: 4 }] });
  expect(parseRule("FREQ=MONTHLY;BYMONTHDAY=-1")).toEqual({ freq: "monthly", interval: 1, byMonthDay: [-1] });
  expect(parseRule("FREQ=DAILY;BYDAY=MO,TU")).toEqual({ freq: "weekly", interval: 1, byDay: [1, 2] });
  expect(parseRule("FREQ=YEARLY;BYWEEKNO=20")).toBeNull();
  expect(parseRule("FREQ=YEARLY;BYDAY=1MO")).toBeNull();
  for (const rule of ["FREQ=MONTHLY;BYDAY=-1FR", "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3"]) {
    const parsed = parseRule(rule);
    expect(parsed && parseRule(formatRule(parsed, false))).toEqual(parsed);
  }
});

test("a zoned repeat's UNTIL is written in UTC and read back as its day there", () => {
  const rule = formatRule({ freq: "daily", interval: 1, until: "2026-12-31" }, false, "America/New_York");
  expect(rule).toBe("FREQ=DAILY;UNTIL=20270101T045959Z");
  expect(parseRule(rule, "America/New_York")?.until).toBe("2026-12-31");
});
