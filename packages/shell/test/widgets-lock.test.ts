import { describe, expect, test } from "bun:test";
import { unlockHint } from "../src/lock/lib/rest.ts";
import { glanceNudge, lockSide, type Placement } from "../src/widgets/index.ts";
import { noticeCounts } from "../src/widgets/lib/counts.ts";

describe("the lock screen's widgets", () => {
  test("the side column takes up to four that come in small, never the Rundown or the row's own, drawn small", () => {
    const placements: Placement[] = [
      { id: "1", kind: "rundown", size: "large" },
      { id: "2", kind: "weather", size: "small" },
      { id: "3", kind: "media", size: "wide" },
      { id: "4", kind: "notes", size: "wide" },
      { id: "5", kind: "system", size: "small" },
      { id: "6", kind: "timer", size: "small" },
      { id: "7", kind: "clock", size: "mini" },
    ];
    expect(lockSide(placements).map((each) => `${each.kind}:${each.size}`)).toEqual(["media:small", "notes:small", "system:small", "timer:small"]);
  });

  test("notifications show as counts by app only, newest app first", () => {
    const history = [
      { appName: "Messages", desktopEntry: "" },
      { appName: "Calendar", desktopEntry: "" },
      { appName: "Messages", desktopEntry: "" },
    ];
    expect(noticeCounts(history)).toEqual([
      { app: "Messages", count: 2 },
      { app: "Calendar", count: 1 },
    ]);
  });

  test("a press while locked says what unlocking will open", () => {
    expect(unlockHint({ label: "Notes" }, "Enter your password")).toBe("Unlock to open Notes");
    expect(unlockHint(null, "Enter your password")).toBe("Enter your password");
  });

  test("Glance moves a few points each minute and comes back round", () => {
    const at = (minute: number) => glanceNudge(minute * 60_000);
    expect(at(0)).toEqual({ x: 0, y: 0 });
    expect(at(1)).not.toEqual(at(0));
    expect(at(8)).toEqual(at(0));
    for (let m = 0; m < 8; m++) expect(Math.max(Math.abs(at(m).x), Math.abs(at(m).y))).toBeLessThanOrEqual(8);
  });
});
