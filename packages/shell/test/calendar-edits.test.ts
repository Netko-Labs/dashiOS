import { expect, test } from "bun:test";
import { changeOccurrence, deleteOccurrence } from "../apps/calendar/edits.ts";
import { makeEvent } from "../apps/calendar/event.ts";
import { countBefore, isStartOf, monthDays, occurrencesOf } from "../apps/calendar/recurrence.ts";
import type { CalEvent, Repeat } from "../apps/calendar/types.ts";

const HERE = "Europe/Lisbon";
const starts = (event: CalEvent | null, from = "2026-11-01T00:00", to = "2026-12-01T00:00"): string[] =>
  event ? occurrencesOf(event, "Home", from, to, 100, HERE).map((each) => `${each.start} ${each.event.title}`) : [];

/** A weekly standup on Mondays and Thursdays at 9:00 from Monday Nov 2, in this computer's zone. */
const standup = (repeat: Partial<Repeat> = {}): CalEvent =>
  makeEvent({
    title: "Standup",
    allDay: false,
    start: "2026-11-02T09:00",
    end: "2026-11-02T09:15",
    zone: HERE,
    repeat: { freq: "weekly", interval: 1, byDay: [1, 4], ...repeat },
  });
const at = (start: string, end: string, title = "Standup") => ({ title, allDay: false, start, end });

test("monthly and yearly repeats land on the days their rule names", () => {
  // November 2026 starts on a Sunday.
  expect(monthDays(2026, 10, { freq: "monthly", interval: 1, byNth: [{ n: 1, day: 1 }] }, 2)).toEqual([2]);
  expect(monthDays(2026, 10, { freq: "monthly", interval: 1, byNth: [{ n: -1, day: 5 }] }, 2)).toEqual([27]);
  expect(monthDays(2026, 10, { freq: "monthly", interval: 1, byMonthDay: [-1] }, 2)).toEqual([30]);
  expect(monthDays(2026, 1, { freq: "monthly", interval: 1 }, 31)).toEqual([]);
  const thanksgiving = makeEvent({
    allDay: true,
    start: "2026-11-26T00:00",
    end: "2026-11-27T00:00",
    repeat: { freq: "yearly", interval: 1, byMonth: [11], byNth: [{ n: 4, day: 4 }] },
  });
  expect(occurrencesOf(thanksgiving, "Home", "2027-01-01T00:00", "2029-01-01T00:00", 10, HERE).map((each) => each.start)).toEqual([
    "2027-11-25T00:00",
    "2028-11-23T00:00",
  ]);
  const lastWorkday = makeEvent({
    title: "Pay",
    allDay: true,
    start: "2026-10-30T00:00",
    end: "2026-10-31T00:00",
    repeat: { freq: "monthly", interval: 1, byDay: [1, 2, 3, 4, 5], bySetPos: [-1] },
  });
  expect(occurrencesOf(lastWorkday, "Home", "2026-10-01T00:00", "2027-01-01T00:00", 10, HERE).map((each) => each.start)).toEqual([
    "2026-10-30T00:00",
    "2026-11-30T00:00",
    "2026-12-31T00:00",
  ]);
});

test("counting a repeat's starts, and knowing one", () => {
  const event = standup({ count: 6 });
  expect(countBefore(event, "2026-11-09T09:00")).toBe(2);
  expect(isStartOf(event, "2026-11-12T09:00")).toBe(true);
  expect(isStartOf(event, "2026-11-11T09:00")).toBe(false);
  expect(isStartOf(event, "2026-11-23T09:00")).toBe(false);
});

test("this event: Thursday's standup moves alone, and the rest stay", () => {
  const { event, added } = changeOccurrence(standup(), "2026-11-05T09:00", at("2026-11-05T10:00", "2026-11-05T10:30"), "this");
  expect(added).toBeNull();
  expect(starts(event, "2026-11-02T00:00", "2026-11-10T00:00")).toEqual(["2026-11-02T09:00 Standup", "2026-11-05T10:00 Standup", "2026-11-09T09:00 Standup"]);
  // Changed again, the same occurrence is changed, not a second one.
  const again = changeOccurrence(event as CalEvent, "2026-11-05T09:00", at("2026-11-05T11:00", "2026-11-05T11:30", "Late standup"), "this");
  expect(again.event?.overrides).toHaveLength(1);
  expect(starts(again.event, "2026-11-05T00:00", "2026-11-06T00:00")).toEqual(["2026-11-05T11:00 Late standup"]);
});

test("all events: moving the clicked Thursday an hour moves every one an hour, from where the repeat began", () => {
  const changed = changeOccurrence(standup(), "2026-11-02T09:00", at("2026-11-02T09:00", "2026-11-02T09:15"), "this").event as CalEvent;
  const withSkip = { ...changed, exdates: ["2026-11-09T09:00"] };
  const { event } = changeOccurrence(withSkip, "2026-11-12T09:00", at("2026-11-12T10:00", "2026-11-12T10:15"), "all");
  expect(event?.start).toBe("2026-11-02T10:00");
  // The deleted Monday and the changed one moved along.
  expect(event?.exdates).toEqual(["2026-11-09T10:00"]);
  expect(event?.overrides.map((each) => each.recurrenceId)).toEqual(["2026-11-02T10:00"]);
  expect(starts(event, "2026-11-09T00:00", "2026-11-13T00:00")).toEqual(["2026-11-12T10:00 Standup"]);
});

test("this and following: the repeat stops before it and a new one starts there", () => {
  const { event, added } = changeOccurrence(standup(), "2026-11-12T09:00", at("2026-11-12T09:30", "2026-11-12T09:45", "Standup v2"), "following");
  expect(event?.repeat?.until).toBe("2026-11-11");
  expect(added?.uid).not.toBe(event?.uid);
  expect(added?.start).toBe("2026-11-12T09:30");
  expect([...starts(event, "2026-11-09T00:00", "2026-11-20T00:00"), ...starts(added ?? null, "2026-11-09T00:00", "2026-11-20T00:00")]).toEqual([
    "2026-11-09T09:00 Standup",
    "2026-11-12T09:30 Standup v2",
    "2026-11-16T09:30 Standup v2",
    "2026-11-19T09:30 Standup v2",
  ]);
  // A COUNT is shared out: two before, four after.
  const counted = changeOccurrence(standup({ count: 6 }), "2026-11-09T09:00", at("2026-11-09T09:00", "2026-11-09T09:15"), "following");
  expect(counted.event?.repeat?.count).toBe(2);
  expect(counted.added?.repeat?.count).toBe(4);
  // From the first occurrence, "following" is every one.
  expect(changeOccurrence(standup(), "2026-11-02T09:00", at("2026-11-02T08:00", "2026-11-02T08:15"), "following").added).toBeNull();
});

test("deleting one, the following, or all", () => {
  const one = deleteOccurrence(standup(), "2026-11-05T09:00", "this").event;
  expect(one?.exdates).toEqual(["2026-11-05T09:00"]);
  const following = deleteOccurrence(standup(), "2026-11-09T09:00", "following").event;
  expect(starts(following)).toEqual(["2026-11-02T09:00 Standup", "2026-11-05T09:00 Standup"]);
  expect(deleteOccurrence(standup(), "2026-11-02T09:00", "following").event).toBeNull();
  expect(deleteOccurrence(standup(), "2026-11-09T09:00", "all").event).toBeNull();
});
