import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyNumber, formatResult, parsePasted } from "../apps/calculator/format.ts";
import { EMPTY_LINE, equals, type Line, paste, relocalized, typeChar } from "../apps/calculator/line.ts";
import { EN_US, groupDigits, type NumberLocale, numberLocale, numberLocaleTag, readNumberLocale } from "../apps/calculator/locale.ts";

const DE = numberLocale("de-DE");
const FR = numberLocale("fr-FR");
const CH = numberLocale("de-CH");
const IN = numberLocale("en-IN");

/** Types `text` into an empty line, one key at a time, in `locale`. */
const typed = (text: string, locale: NumberLocale = EN_US): Line => [...text].reduce((line, char) => typeChar(line, char, locale), EMPTY_LINE);

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

describe("results", () => {
  test("written the locale's way, to 15 digits, without a double's noise", () => {
    expect(formatResult(1234567.891)).toBe("1,234,567.891");
    expect(formatResult(1234567.891, DE)).toBe("1.234.567,891");
    expect(formatResult(1 / 3)).toBe("0.333333333333333");
    expect(formatResult(0.1 + 0.2)).toBe("0.3");
    expect(formatResult(-5)).toBe("−5");
    expect(formatResult(0)).toBe("0");
  });

  test("past what 15 digits hold, in scientific notation", () => {
    expect(formatResult(1.2345678e21)).toBe("1.2345678e21");
    expect(formatResult(1.5e21, DE)).toBe("1,5e21");
    expect(formatResult(2.5e-9)).toBe("2.5e-9");
  });

  test("copy is what is shown, ungrouped, with a plain minus, and pastes back to the same number", () => {
    expect(copyNumber(1234.5)).toBe("1234.5");
    expect(copyNumber(1234.5, DE)).toBe("1234,5");
    expect(copyNumber(-2)).toBe("-2");
    expect(copyNumber(1 / 3)).toBe("0.333333333333333");
    for (const locale of [EN_US, DE, FR, CH, IN]) expect(parsePasted(copyNumber(1234.5, locale), locale)).toBe(1234.5);
  });
});

describe("keyboard", () => {
  test("typing 1,000 in English is a thousand, not 1.000", () => {
    expect(typed("1,000").text).toBe("1,000");
    expect(typed("1000").text).toBe("1,000");
  });

  test("in German the comma is the point and the period groups", () => {
    expect(typed("1,5", DE).text).toBe("1,5");
    expect(typed("1.000", DE).text).toBe("1.000");
    expect(typed("12345,5", DE).text).toBe("12.345,5");
  });

  test("where neither mark groups (French), both are the point", () => {
    expect(typed("2.5", FR).text).toBe("2,5");
    expect(typed("2,5", FR).text).toBe("2,5");
  });
});

describe("paste", () => {
  test("the number inside some text is read the locale's way", () => {
    expect(parsePasted("Total: 1,234.50")).toBe(1234.5);
    expect(parsePasted("1.234,50 €", DE)).toBe(1234.5);
    expect(parsePasted("$ 12")).toBe(12);
    expect(parsePasted("1\u202f234,5", FR)).toBe(1234.5);
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

  test("text that is not one number is nothing to parsePasted", () => {
    expect(parsePasted("")).toBeNull();
    expect(parsePasted("cat")).toBeNull();
    expect(parsePasted("12 + 3")).toBeNull();
    expect(parsePasted("2026-11-05")).toBeNull();
    expect(parsePasted("1e999")).toBeNull();
  });

  test("a paste is a number or a sum, never keys: letters are refused, not typed", () => {
    expect(paste(EMPTY_LINE, "Total: 1,234.50", EN_US).line.text).toBe("1,234.5");
    expect(paste(EMPTY_LINE, "12×3+4", EN_US).line.text).toBe("12 × 3 + 4");
    expect(paste(EMPTY_LINE, "1.250 * 12", DE).line.text).toBe("1.250 × 12");
    expect(paste(EMPTY_LINE, "1,5", DE).line.text).toBe("1,5");
    // "c" would have cleared and "x" multiplied: a paste with letters is refused whole.
    expect(paste(EMPTY_LINE, "calc 3x4", EN_US)).toEqual({ line: EMPTY_LINE, note: "refused-paste" });
    expect(paste(EMPTY_LINE, "1,5 + 2", EN_US).note).toBe("refused-paste");
    expect(paste(EMPTY_LINE, "2026-11-05", EN_US).line.text).toBe("2,026 − 11 − 5");
  });
});

describe("the region changing under the line", () => {
  test("the line is written in the new marks, the caret after the same digit", () => {
    const german = typed("1250,5*12", DE);
    expect(german.text).toBe("1.250,5 × 12");
    const english = relocalized(german, DE, EN_US);
    expect(english.text).toBe("1,250.5 × 12");
    expect(english.selection).toEqual({ start: 12, end: 12 });
    expect(relocalized({ ...german, selection: { start: 1, end: 1 } }, DE, EN_US).selection).toEqual({ start: 1, end: 1 });
  });

  test("a result standing in the line is written anew, still selected", () => {
    const worked = equals(typed("1000,5+1", DE), DE).line;
    expect(worked.text).toBe("1.001,5");
    const english = relocalized(worked, DE, EN_US);
    expect(english).toMatchObject({ text: "1,001.5", selection: { start: 0, end: 7 } });
    expect(english.carry).toMatchObject({ text: "1,001.5", value: 1001.5 });
  });
});
