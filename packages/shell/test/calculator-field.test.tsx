import { describe, expect, test } from "bun:test";
import { mount, ownRuntimeDir } from "./support/calculator-field.tsx";
import { fakeClock, settle } from "./support/time.ts";

ownRuntimeDir();

describe("the line as the field types it", () => {
  test("one key at a time, the caret stays after what was typed as the line regroups", async () => {
    const calc = await mount();
    for (const char of "1250*12+340") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("1,250 × 12 + 340");
    // A caret at the end is not said (the field puts it there itself: display.tsx).
    expect(calc.line().selection).toBeUndefined();
    // The field draws what the app has: the same text, its caret at the end.
    expect(calc.field.buffer).toBe("1,250 × 12 + 340");
    expect([calc.field.anchor, calc.field.caret]).toEqual([16, 16]);
    // Typed inside the line, the caret is said, and stays after the same digit as the grouping moves.
    calc.field.select(1, 1);
    calc.field.type("9");
    calc.roundTrips();
    expect(calc.line().value).toBe("19,250 × 12 + 340");
    expect(calc.line().selection).toEqual({ start: 2, end: 2 });
    expect([calc.field.anchor, calc.field.caret]).toEqual([2, 2]);
    calc.root.unmount();
  });

  test("typed faster than a round trip, no key is lost or misplaced", async () => {
    const typings: [string, string][] = [
      ["2+3", "2 + 3"],
      ["1/0", "1 ÷ 0"],
      ["1250*12+340", "1,250 × 12 + 340"],
    ];
    for (const [keys, want] of typings) {
      const calc = await mount();
      // Every key reaches the field before the app has answered the first.
      for (const char of keys) calc.field.type(char);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      expect(calc.field.caret).toBe(want.length);
      calc.root.unmount();
    }
  });

  test("a key the line refuses never stays in the field", async () => {
    const clock = fakeClock();
    const calc = await mount();
    for (const char of "12a") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("12");
    // The field keeps it for a moment (more keys may be on their way), then takes the line's text back.
    expect(calc.field.buffer).toBe("12a");
    await settle(30);
    calc.roundTrips();
    expect(calc.field.buffer).toBe("12");
    calc.root.unmount();
    clock.restore();
  });

  // An agent's "12 + 3" typed at once: the space is refused, and the keys after it are typed on the
  // field's own text. A reset at once would drop them (mirin resets on a new revision, whatever was typed).
  test("keys typed right after one the line refuses are not lost", async () => {
    const clock = fakeClock();
    for (const [keys, want] of [
      ["12 + 3", "12 + 3"],
      ["12a3", "123"],
      ["2 * 3=", "6"],
    ] as const) {
      const calc = await mount();
      for (const char of keys) calc.field.type(char);
      calc.roundTrips();
      await settle(30);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      calc.root.unmount();
    }
    clock.restore();
  });
});
