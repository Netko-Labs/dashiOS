import { expect, test } from "bun:test";
import { makeEvent } from "../src/shared/calendar/event.ts";
import { occurrencesOf } from "../src/shared/calendar/recurrence.ts";
import { convertWall, fromHere, instantIn, isZone, parseZone, toHere, wallAt, zoneCity } from "../src/shared/calendar/zones.ts";

const NY = "America/New_York";
const LISBON = "Europe/Lisbon";

test("a wall clock in one zone is the instant it is there", () => {
  expect(instantIn("2026-11-05T09:00", NY)).toBe(Date.UTC(2026, 10, 5, 14, 0));
  expect(instantIn("2026-07-05T09:00", NY)).toBe(Date.UTC(2026, 6, 5, 13, 0));
  expect(wallAt(Date.UTC(2026, 10, 5, 14, 0), LISBON)).toBe("2026-11-05T14:00");
  expect(instantIn("2026-11-05T09:00", "Not/AZone")).toBeNull();
  expect(isZone("UTC")).toBe(true);
  expect(isZone("Europe/Lisbon")).toBe(true);
  expect(isZone("../etc/passwd")).toBe(false);
});

test("a skipped time moves forward; a time that happens twice is the first", () => {
  // New York springs forward at 2:00 on 2026-03-08.
  expect(wallAt(instantIn("2026-03-08T02:30", NY) as number, NY)).toBe("2026-03-08T03:30");
  // Lisbon springs forward at 1:00 on 2026-03-29.
  expect(wallAt(instantIn("2026-03-29T01:30", LISBON) as number, LISBON)).toBe("2026-03-29T02:30");
  // New York falls back at 2:00 on 2026-11-01: 1:30 is first in daylight time (UTC-4).
  expect(instantIn("2026-11-01T01:30", NY)).toBe(Date.UTC(2026, 10, 1, 5, 30));
});

test("the 9:00 New York call is at 14:00 in Lisbon; floating time stays as written", () => {
  expect(convertWall("2026-11-05T09:00", NY, LISBON)).toBe("2026-11-05T14:00");
  expect(toHere("2026-11-05T09:00", NY, LISBON)).toBe("2026-11-05T14:00");
  expect(fromHere("2026-11-05T14:00", NY, LISBON)).toBe("2026-11-05T09:00");
  expect(toHere("2026-11-05T09:00", null, LISBON)).toBe("2026-11-05T09:00");
  expect(toHere("2026-11-05T09:00", "Somewhere/Unknown", LISBON)).toBe("2026-11-05T09:00");
});

test("a repeat in New York keeps its clock there, and shows on this one's", () => {
  const event = makeEvent({
    title: "Call",
    allDay: false,
    start: "2026-10-26T09:00",
    end: "2026-10-26T09:30",
    zone: NY,
    repeat: { freq: "daily", interval: 1 },
  });
  // Lisbon leaves summer time on Oct 25, New York on Nov 1: for that week the gap is 4 hours, not 5.
  const shown = occurrencesOf(event, "Home", "2026-10-30T00:00", "2026-11-03T00:00", 100, LISBON);
  expect(shown.map((each) => each.start)).toEqual(["2026-10-30T13:00", "2026-10-31T13:00", "2026-11-01T14:00", "2026-11-02T14:00"]);
  // The occurrence is named by its start in New York.
  expect(shown.map((each) => each.recurrenceId)).toEqual(["2026-10-30T09:00", "2026-10-31T09:00", "2026-11-01T09:00", "2026-11-02T09:00"]);
});

test("a zone is typed as its name or its city", () => {
  const zones = ["UTC", NY, LISBON, "America/Los_Angeles"];
  expect(parseZone("europe/lisbon", zones)).toBe(LISBON);
  expect(parseZone("Los Angeles", zones)).toBe("America/Los_Angeles");
  expect(parseZone("new york", zones)).toBe(NY);
  expect(parseZone("Atlantis", zones)).toBeNull();
  expect(zoneCity(NY)).toBe("New York");
});
