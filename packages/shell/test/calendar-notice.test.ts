import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarModel } from "../apps/calendar/model.ts";
import { CalendarStore } from "../apps/calendar/store.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-calendar-notice-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:yoga-1",
  "SUMMARY:Yoga",
  "DTSTART:20261109T180000",
  "DTEND:20261109T190000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("the Imported notice goes after a while; an error stays", async () => {
  const model = new CalendarModel(new CalendarStore(root), () => new Date("2026-11-05T10:00:00"), undefined, 30);
  model.importText(ICS, "google");
  expect(model.getSnapshot().notice).toStartWith("Imported 1 event into");
  await settle(60);
  expect(model.getSnapshot().notice).toBeNull();
  model.fail("Saving failed.");
  await settle(60);
  expect(model.getSnapshot().error).toBe("Saving failed.");
});

test("a newer notice keeps its own time", async () => {
  const model = new CalendarModel(new CalendarStore(root), () => new Date("2026-11-05T10:00:00"), undefined, 40);
  model.say("Exported “Home”.");
  await settle(25);
  model.say("Duplicated “Lunch”.");
  await settle(25);
  expect(model.getSnapshot().notice).toBe("Duplicated “Lunch”.");
  await settle(40);
  expect(model.getSnapshot().notice).toBeNull();
});
