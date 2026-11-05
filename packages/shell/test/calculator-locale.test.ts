import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CalcKey, INITIAL, pressAll } from "../apps/calculator/engine.ts";
import { copyText, displayText, formatNumber, formatTyped, parsePasted } from "../apps/calculator/format.ts";
import { calcKeysFor, keyForChar } from "../apps/calculator/keyboard.ts";
import { CALCULATOR_SIZE, DISPLAY, displayInsets, GAP, KEY, PAD } from "../apps/calculator/layout.ts";
import { EN_US, groupDigits, numberLocale, numberLocaleTag, readNumberLocale } from "../apps/calculator/locale.ts";

const DE = numberLocale("de-DE");
const FR = numberLocale("fr-FR");
const CH = numberLocale("de-CH");
const IN = numberLocale("en-IN");

/** Types `text` on the keyboard, one key at a time, in `locale`. */
const typed = (text: string, locale = EN_US) => {
  const keys = [...text].flatMap((char) => calcKeysFor({ kind: "text", text: char }, locale));
  return pressAll(INITIAL, keys);
};

describe("number locale", () => {
  test("separators come from the locale", () => {
    expect(EN_US).toMatchObject({ decimal: ".", group: "," });
    expect(DE).toMatchObject({ decimal: ",", group: "." });
    expect(FR.decimal).toBe(",");
    expect(FR.group).toMatch(/^\s$/u);
    expect(CH.decimal).toBe(".");
  });

  test("an unknown locale falls back to en-US", () => {
    expect(numberLocale("zz-not-a-locale")).toMatchObject({ decimal: ".", group: "," });
  });

  test("the region's formats win over the environment, which follows glibc's order", () => {
    expect(numberLocaleTag("de_DE.UTF-8", { LANG: "en_US.UTF-8" })).toBe("de-DE");
    expect(numberLocaleTag(undefined, { LANG: "en_US.UTF-8", LC_NUMERIC: "fr_FR.UTF-8" })).toBe("fr-FR");
    expect(numberLocaleTag(undefined, { LANG: "fr_FR.UTF-8", LC_ALL: "de_DE.UTF-8" })).toBe("de-DE");
    expect(numberLocaleTag(undefined, { LANG: "C" })).toBe("en-US");
    expect(numberLocaleTag(undefined, {})).toBe("en-US");
  });

  test("the settings file names the region; a missing or broken file falls back to the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "calc-locale-"));
    try {
      const path = join(dir, "settings.json");
      writeFileSync(path, JSON.stringify({ region: { formats: "de_DE.UTF-8" } }));
      expect(readNumberLocale(path, { LANG: "en_US.UTF-8" }).decimal).toBe(",");
      writeFileSync(path, "{ not json");
      expect(readNumberLocale(path, { LANG: "fr_FR.UTF-8" }).decimal).toBe(",");
      expect(readNumberLocale(join(dir, "missing.json"), { LANG: "en_US.UTF-8" }).decimal).toBe(".");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("grouping follows the locale, Indian lakhs included", () => {
    expect(groupDigits("1234567", EN_US)).toBe("1,234,567");
    expect(groupDigits("1234567", DE)).toBe("1.234.567");
    expect(groupDigits("1234567", IN)).toBe("12,34,567");
    expect(groupDigits("12", DE)).toBe("12");
  });
});

describe("display", () => {
  test("a typed entry keeps what was typed, in the locale's marks", () => {
    expect(formatTyped("-1234.50")).toBe("-1,234.50");
    expect(formatTyped("-1234.50", DE)).toBe("-1.234,50");
    expect(formatTyped("0.", DE)).toBe("0,");
  });

  test("results are rounded to the display and written the locale's way", () => {
    expect(formatNumber(1234567.891)).toBe("1,234,567.89");
    expect(formatNumber(1234567.891, DE)).toBe("1.234.567,89");
    expect(formatNumber(1 / 3, DE)).toBe("0,33333333");
    expect(formatNumber(1.2345678e15, DE)).toBe("1,234568e15");
    expect(formatNumber(Number.NaN, DE)).toBe("Error");
  });

  test("copy writes no grouping, the locale's decimal mark, and pastes back to the same number", () => {
    const state = pressAll(INITIAL, [{ kind: "number", value: 1234.5 }]);
    expect(copyText(state)).toBe("1234.5");
    expect(copyText(state, DE)).toBe("1234,5");
    for (const locale of [EN_US, DE, FR, CH, IN]) expect(parsePasted(copyText(state, locale), locale)).toBe(1234.5);
  });
});

describe("keyboard", () => {
  test("typing 1,000 in English is a thousand, not 1.000", () => {
    const state = typed("1,000");
    expect(displayText(state)).toBe("1,000");
    expect(state.typed).toBe("1000");
  });

  test("in German the comma is the point and the period groups", () => {
    expect(displayText(typed("1,5", DE), DE)).toBe("1,5");
    expect(typed("1.000", DE).typed).toBe("1000");
  });

  test("where neither mark groups (French), both are the point", () => {
    expect(keyForChar(".", FR)).toEqual({ kind: "decimal" });
    expect(keyForChar(",", FR)).toEqual({ kind: "decimal" });
    expect(keyForChar(",", EN_US)).toBeNull();
    expect(keyForChar(".", DE)).toBeNull();
  });

  test("the decimal key shows the locale's mark", () => {
    expect(displayText(pressAll(INITIAL, [{ kind: "digit", digit: "2" }, { kind: "decimal" }, { kind: "digit", digit: "5" }]), DE)).toBe("2,5");
  });
});

describe("paste", () => {
  test("the number inside some text is read the locale's way", () => {
    expect(parsePasted("Total: 1,234.50")).toBe(1234.5);
    expect(parsePasted("1.234,50 €", DE)).toBe(1234.5);
    expect(parsePasted("$ 12")).toBe(12);
    expect(parsePasted("1 234,5", FR)).toBe(1234.5);
    expect(parsePasted("1'234.5", CH)).toBe(1234.5);
    expect(parsePasted("12,34,567.5", IN)).toBe(1234567.5);
    expect(parsePasted("−42")).toBe(-42);
    expect(parsePasted(".5")).toBe(0.5);
    expect(parsePasted("1.2e+21")).toBe(1.2e21);
    expect(parsePasted("  7\n")).toBe(7);
  });

  test("ambiguous or foreign marks are refused, not guessed", () => {
    // "1,5" is a European 1.5, which en-US would group into 15.
    expect(parsePasted("1,5")).toBeNull();
    expect(parsePasted("1.234,50")).toBeNull();
    expect(parsePasted("1234.5", DE)).toBeNull();
    expect(parsePasted("1,23,456")).toBeNull();
    expect(parsePasted("0,123")).toBeNull();
  });

  test("text that is not one number is nothing", () => {
    expect(parsePasted("")).toBeNull();
    expect(parsePasted("cat")).toBeNull();
    expect(parsePasted("12 + 3")).toBeNull();
    expect(parsePasted("2026-11-05")).toBeNull();
    expect(parsePasted("1e999")).toBeNull();
  });

  test("Ctrl+V (text in one change) is read as one number, never typed key by key", () => {
    const keys = (text: string, locale = EN_US): CalcKey[] => calcKeysFor({ kind: "text", text }, locale);
    expect(keys("Total: 1,234.50")).toEqual([{ kind: "number", value: 1234.5 }]);
    // Letters are not keys in a paste: "c" would have cleared, "x" multiplied.
    expect(keys("calc 3x4")).toEqual([]);
    expect(keys("12×3=")).toEqual([]);
    expect(keys("1,5", DE)).toEqual([{ kind: "number", value: 1.5 }]);
  });
});

describe("layout", () => {
  test("the keypad's grid sets the window", () => {
    expect(CALCULATOR_SIZE.width).toBe(PAD * 2 + KEY * 4 + GAP * 3);
    expect(CALCULATOR_SIZE.height).toBe(DISPLAY + KEY * 5 + GAP * 4 + PAD);
  });

  test("the number's digits end on the keypad's edge and stand one gap above the keys", () => {
    // At the largest size the "0" ink is 4 px inside its box and 1 px above its foot.
    expect(displayInsets(52)).toEqual({ right: PAD - 4, bottom: GAP - 1 });
    expect(displayInsets(22)).toEqual({ right: PAD - 2, bottom: GAP });
  });
});
