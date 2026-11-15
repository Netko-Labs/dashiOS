import { describe, expect, test } from "bun:test";
import { mount, ownRuntimeDir } from "./support/calculator-field.tsx";

ownRuntimeDir();

describe("the line as the field types it", () => {
  test("one key at a time, the caret stays after what was typed as the line regroups", async () => {
    const calc = await mount();
    for (const char of "1250*12+340") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("1,250 × 12 + 340");
    // The caret at the end is said like any other, in the text it was made in (D144).
    expect(calc.line().selection).toMatchObject({ start: 16, end: 16 });
    // The field draws what the app has: the same text, its caret at the end.
    expect(calc.field.buffer).toBe("1,250 × 12 + 340");
    expect([calc.field.anchor, calc.field.caret]).toEqual([16, 16]);
    // Typed inside the line, the caret is said, and stays after the same digit as the grouping moves.
    calc.field.select(1, 1);
    calc.field.type("9");
    calc.roundTrips();
    expect(calc.line().value).toBe("19,250 × 12 + 340");
    expect(calc.line().selection).toMatchObject({ start: 2, end: 2 });
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

  test("a key the line refuses is taken out of the field at once", async () => {
    const calc = await mount();
    for (const char of "12a") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("12");
    expect(calc.field.buffer).toBe("12");
    expect(calc.field.caret).toBe(2);
    // Refused inside the line: the caret goes back where the line has it.
    calc.field.select(1, 1);
    calc.field.type("a");
    calc.roundTrips();
    expect(calc.field.buffer).toBe("12");
    expect([calc.field.anchor, calc.field.caret]).toEqual([1, 1]);
    calc.field.type("5");
    calc.roundTrips();
    expect(calc.line().value).toBe("152");
    calc.root.unmount();
  });

  // An agent's "12 + 3" typed at once: the space is refused and taken out by a new revision, and the
  // host types the keys after it again on the line's text (mirin PR 46; decisions.md D144).
  test("keys typed right after one the line refuses are not lost", async () => {
    for (const [keys, want] of [
      ["12 + 3", "12 + 3"],
      ["12a3", "123"],
      ["2 * 3=", "6"],
      ["a1b2c", "12"],
    ] as const) {
      const calc = await mount();
      for (const char of keys) calc.field.type(char);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      expect(calc.field.caret).toBe(want.length);
      calc.root.unmount();
    }
  });

  // The same with the field's reports and the app's trees crossing in any order.
  test("whatever crosses, a refused key goes and the keys around it stay, in order", async () => {
    let seed = 11;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (const [keys, want] of [
      ["12 + 3", "12 + 3|12 + 3"],
      ["1a2b3 *x4=", "492|492"],
    ] as const) {
      const outcomes = new Map<string, number>();
      for (let run = 0; run < 150; run += 1) {
        const calc = await mount();
        for (const char of keys) {
          for (let turns = Math.floor(random() * 4); turns > 0; turns -= 1) {
            if (random() < 0.5) calc.hear(1);
            else calc.takeTrees();
          }
          calc.field.type(char);
        }
        let got: string;
        try {
          calc.roundTrips();
          got = `${calc.line().value}|${calc.field.buffer}`;
        } catch {
          got = "never settled";
        }
        outcomes.set(got, (outcomes.get(got) ?? 0) + 1);
        calc.root.unmount();
      }
      expect(Object.fromEntries(outcomes)).toEqual({ [want]: 150 });
    }
  });
});
