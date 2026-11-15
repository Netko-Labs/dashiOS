import { describe, expect, test } from "bun:test";
import { mirinHash, mount, ownRuntimeDir } from "./support/calculator-field.tsx";

ownRuntimeDir();

describe("the line as the field types it", () => {
  test("one key at a time, the caret stays after what was typed as the line regroups", async () => {
    const calc = await mount();
    for (const char of "1250*12+340") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("1,250 × 12 + 340");
    expect(calc.line().selection).toEqual({ start: 16, end: 16 });
    // The field draws what the app has: the same text, its caret at the end.
    expect(calc.field.buffer).toBe("1,250 × 12 + 340");
    expect([calc.field.anchor, calc.field.caret]).toEqual([16, 16]);
    calc.root.unmount();
  });

  test.if(mirinHash !== undefined)("typed faster than a round trip, no key is lost or misplaced", async () => {
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
    const calc = await mount();
    for (const char of "12a") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("12");
    expect(calc.field.buffer).toBe("12");
    calc.root.unmount();
  });
});
