import { describe, expect, test } from "bun:test";
import { unlockHint } from "../src/lock/lib/rest.ts";
import { glanceNudge } from "../src/widgets/index.ts";

describe("the lock screen's widgets", () => {
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
