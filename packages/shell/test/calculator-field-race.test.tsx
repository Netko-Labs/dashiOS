import { describe, expect, test } from "bun:test";
import { mount, ownRuntimeDir } from "./support/calculator-field.tsx";

// The field types on a text the line has since changed another way: a keypad key pressed, and keys
// typed before the field took what the key made. The host types them again on the line's text and
// reports them in one edit (mirin's rebase; decisions.md D129, which replaced D124).

ownRuntimeDir();

describe("the line as the field types it, behind the line", () => {
  // An agent's click on a key and its typing 5 ms later (dashi-0.9.0-review/13-final-fixes): the
  // field types on the text it had before the key, and the line had "76" and no sum.
  test("typed before the field took a keypad key, the keys land after it", async () => {
    for (const [before, key, typed, want] of [
      ["", "key:7", "*6=", "42"],
      ["", "key:7", "+", "7 +"],
      ["12", "key:3", "+4", "123 + 4"],
      ["9", "key:plus", "1", "9 + 1"],
      ["", "key:7", "7", "77"],
    ] as const) {
      const calc = await mount();
      for (const char of before) calc.field.type(char);
      calc.roundTrips();
      calc.press(key);
      for (const char of typed) calc.field.type(char);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      calc.root.unmount();
    }
  });

  test("once the field took a keypad key, what replaces it replaces it", async () => {
    const calc = await mount();
    calc.press("key:7");
    calc.roundTrips();
    expect(calc.field.buffer).toBe("7");
    calc.field.select(0, 1);
    calc.field.type("8");
    calc.roundTrips();
    expect(calc.line().value).toBe("8");
    calc.field.type("5");
    calc.roundTrips();
    expect(calc.line().value).toBe("85");
    calc.root.unmount();
  });

  // The same with several calls 2 ms apart (click 7, "+2", ⇧8, "3="): the field types while trees
  // it has not taken yet are on their way, and takes them between its keys, in any order of the two.
  test("whatever the order of the field's reports and the trees it takes, every key lands once, in order", async () => {
    let seed = 7;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (const [before, key, typed, want] of [
      ["", "key:7", "+2*3=", "13|13"],
      ["12", "key:plus", "3*4-5=", "19|19"],
    ] as const) {
      const outcomes = new Map<string, number>();
      for (let run = 0; run < 150; run += 1) {
        const calc = await mount();
        const crossings = (): void => {
          for (let turns = Math.floor(random() * 4); turns > 0; turns -= 1) {
            if (random() < 0.5) calc.hear(1);
            else calc.takeTrees();
          }
        };
        for (const char of before) calc.field.type(char);
        calc.roundTrips();
        calc.press(key);
        for (const char of typed) {
          crossings();
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
