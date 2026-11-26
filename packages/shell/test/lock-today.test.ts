/** Today on the split lock (LK-1, NO-7, decisions.md D803): one note per app, its words never; the row of compacts. */

import { expect, test } from "bun:test";
import { lockNotes, noteWords, todayRow } from "../src/widgets/index.ts";

test("notifications on the lock: one per app, newest app first, a count and the newest time, never what they say", () => {
  const history = [
    { appName: "Messages", desktopEntry: "messages", summary: "Mei: dinner?", time: 1000 },
    { appName: "Calendar", desktopEntry: "calendar", summary: "Design review", time: 2000 },
    { appName: "Messages", desktopEntry: "messages", summary: "Sam: ok", time: 3000 },
    { appName: "", desktopEntry: "org.example.app", time: 4000 },
  ];
  expect(lockNotes(history)).toEqual([
    { app: "org.example.app", count: 1, time: 4000 },
    { app: "Messages", count: 2, time: 3000 },
    { app: "Calendar", count: 1, time: 2000 },
  ]);
  expect(JSON.stringify(lockNotes(history))).not.toContain("dinner");
  expect(noteWords(1)).toBe("1 new notification");
  expect(noteWords(2)).toBe("2 new notifications");
});

test("Today's row: the weather, the battery, and the person's first widget that comes compact", () => {
  expect(todayRow([])).toEqual(["weather", "battery", "clock"]);
  const placement = (kind: "timer" | "calendar" | "notes") => ({ id: kind, kind, size: "small" as const });
  expect(todayRow([placement("calendar"), placement("notes"), placement("timer")])).toEqual(["weather", "battery", "timer"]);
});
