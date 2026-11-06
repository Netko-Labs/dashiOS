import { describe, expect, test } from "bun:test";
import { aheadOf } from "../src/launcher/answers/clock.ts";
import { type AnswerContext, answerFor, RATES } from "../src/launcher/answers/index.ts";
import { canonicalNumber, canonicalNumbers, numberStyle } from "../src/launcher/answers/numbers.ts";
import { convert, unitNamed } from "../src/launcher/answers/units.ts";
import { instantAt, offsetMinutes, zoneNamed } from "../src/launcher/answers/zones.ts";
import { buildSections, filesStateFor, type ListInput, selectable } from "../src/launcher/rows.ts";

// Thursday 5 November 2026, 12:41 in Lisbon (UTC+0 in winter).
const NOW = Date.UTC(2026, 10, 5, 12, 41);
const HERE: AnswerContext = { now: NOW, timeZone: "Europe/Lisbon", locale: "en-US", hour24: false };
const answer = (query: string, context: AnswerContext = HERE) => answerFor(query, context);

describe("answers: units", () => {
  test.each([
    ["5 km in mi", "= 3.11 mi", "3.11"],
    ["20 c in f", "= 68 °F", "68"],
    ["-40 c to f", "= -40 °F", "-40"],
    ["98.6 °F in celsius", "= 37 °C", "37"],
    ["0 k in c", "= -273.15 °C", "-273.15"],
    ["2 GB in MB", "= 2,000 MB", "2000"],
    ["1 GiB in MB", "= 1,073.74 MB", "1073.74"],
    ["8 bits in bytes", "= 1 B", "1"],
    ["5 in in cm", "= 12.7 cm", "12.7"],
    ["6 feet in m", "= 1.83 m", "1.83"],
    ["10 pounds in kg", "= 4.54 kg", "4.54"],
    ["1 gallon in liters", "= 3.79 L", "3.79"],
    ["100 km/h in mph", "= 62.14 mph", "62.14"],
    ["1 acre in m2", "= 4,046.86 m²", "4046.86"],
    ["90 min in h", "= 1.5 h", "1.5"],
    ["48 h in days", "= 2 days", "2"],
    ["24 h in days", "= 1 day", "1"],
    ["1 mm in km", "= 0.000001 km", "0.000001"],
  ])("%s is %s", (query, title, copy) => {
    expect(answer(query)).toMatchObject({ kind: "unit", title, detail: query, copy });
  });

  test("across dimensions, or with an unknown unit, there is no answer", () => {
    expect(answer("5 km in kg")).toBeNull();
    expect(answer("5 km in parsecs")).toBeNull();
    expect(answer("3d in blender")).toBeNull();
    expect(answer("4 in a row")).toBeNull();
  });

  test("names fold, plurals and degrees are read", () => {
    expect(unitNamed("Miles")?.symbol).toBe("mi");
    expect(unitNamed("degrees Celsius")?.symbol).toBe("°C");
    expect(unitNamed("sq ft")?.symbol).toBe("ft²");
    expect(unitNamed("parsec")).toBeNull();
    const c = unitNamed("c");
    const f = unitNamed("f");
    expect(c && f ? convert(100, c, f) : null).toBeCloseTo(212, 8);
  });
});

describe("answers: money", () => {
  test.each([
    ["100 usd to eur", "= €89.09", "89.09", "$100.00"],
    ["$20 in yen", "= ¥3,169", "3169", "$20.00"],
    ["50€ in gbp", "= £41.70", "41.70", "€50.00"],
    ["10 pounds in dollars", "= $13.46", "13.46", "£10.00"],
    ["1000 jpy in usd", "= $6.31", "6.31", "¥1,000"],
  ])("%s is %s, with the rates' date", (query, title, copy, from) => {
    expect(answer(query)).toMatchObject({ kind: "money", title, copy, detail: `${from} · rates from ${RATES.date}` });
  });

  test("a currency the rates don't know is no answer", () => {
    expect(answer("100 usd in xyz")).toBeNull();
  });

  test("the shipped rates name their day", () => {
    expect(RATES.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RATES.perBase[RATES.base]).toBe(1);
  });
});

describe("answers: sums and percentages", () => {
  test.each([
    ["2+2", "= 4", "4"],
    ["15% of 80", "= 12", "12"],
    ["80 + 15%", "= 92", "92"],
    ["80 - 15%", "= 68", "68"],
    ["2+3 + 10%", "= 5.5", "5.5"],
    ["20% off 80", "= 64", "64"],
    ["15 is what % of 60", "= 25%", "25%"],
    ["1,000 * 3", "= 3,000", "3000"],
  ])("%s is %s", (query, title, copy) => {
    expect(answer(query)).toMatchObject({ kind: "sum", title, detail: query, copy });
  });

  test("words and a lone number are searches", () => {
    expect(answer("firefox")).toBeNull();
    expect(answer("42")).toBeNull();
    expect(answer("2048")).toBeNull();
    expect(answer("")).toBeNull();
  });
});

describe("answers: the Region's numbers", () => {
  const german: AnswerContext = { ...HERE, locale: "de-DE" };

  test.each([
    ["2,5 km in mi", "= 1,55 mi", "1,55"],
    ["1.000 m in km", "= 1 km", "1"],
    ["2,5+1", "= 3,5", "3,5"],
    ["2.5+1", "= 3,5", "3,5"],
    ["2 GB in MB", "= 2.000 MB", "2000"],
    ["100 usd to eur", "= 89,09\u00a0€", "89,09"],
  ])("de-DE: %s is %s", (query, title, copy) => {
    expect(answer(query, german)).toMatchObject({ title, copy });
  });

  test("a decimal comma is accepted in English too, unless it groups thousands", () => {
    expect(answer("1,5 km in m")?.title).toBe("= 1,500 m");
    expect(answer("1,000 m in km")?.title).toBe("= 1 km");
  });

  test.each([
    ["1,234.5", ".", "1234.5"],
    ["1.234,5", ".", "1234.5"],
    ["1.234,5", ",", "1234.5"],
    ["1,000,000", ".", "1000000"],
    ["1.000.000", ",", "1000000"],
    ["2,5", ".", "2.5"],
    ["1.234", ".", "1.234"],
    ["1.234", ",", "1234"],
    ["1,2,3", ".", null],
    ["1.5.3", ".", null],
  ] as const)("%s with a %s decimal point reads %s", (written, decimal, read) => {
    expect(canonicalNumber(written, { decimal })).toBe(read);
  });

  test("a text with a number that can't be read is no answer", () => {
    expect(canonicalNumbers("1,2,3 + 1", { decimal: "." })).toBeNull();
    expect(answer("1,2,3 + 1")).toBeNull();
  });

  test("the decimal point comes from Intl, en-US for an unknown locale", () => {
    expect(numberStyle("de-DE").decimal).toBe(",");
    expect(numberStyle("en-GB").decimal).toBe(".");
    expect(numberStyle("not a locale").decimal).toBe(".");
  });
});

describe("answers: time zones", () => {
  test.each([
    ["time in lisbon", "12:41 PM in Lisbon", "same time as here"],
    ["time in tokyo", "9:41 PM in Tokyo", "9 h ahead"],
    ["what time is it in new york", "7:41 AM in New York", "5 h behind"],
    ["tokyo time", "9:41 PM in Tokyo", "9 h ahead"],
    ["now in kolkata", "6:11 PM in Kolkata", "5 h 30 min ahead"],
    ["time in sao paulo", "9:41 AM in Sao Paulo", "3 h behind"],
    ["time in san francisco", "4:41 AM in San Francisco", "8 h behind"],
  ])("%s is %s", (query, title, detail) => {
    expect(answer(query)).toMatchObject({ kind: "time", title, detail });
  });

  test.each([
    ["3pm tokyo", "6:00 AM here", "3:00 PM in Tokyo"],
    ["3pm in tokyo", "6:00 AM here", "3:00 PM in Tokyo"],
    ["15:00 new york", "8:00 PM here", "3:00 PM in New York"],
    ["noon pst", "8:00 PM here", "12:00 PM in PST"],
    ["3pm lisbon in tokyo", "12:00 AM in Tokyo", "3:00 PM in Lisbon, the next day"],
    ["9:30 am tokyo to new york", "7:30 PM in New York", "9:30 AM in Tokyo, the day before"],
  ])("%s is %s", (query, title, detail) => {
    expect(answer(query)).toMatchObject({ kind: "time", title, detail });
  });

  test("24-hour time, as the person chose", () => {
    expect(answer("3pm tokyo", { ...HERE, hour24: true })?.title).toBe("06:00 here");
  });

  test("a bare number, a bad clock, or an unknown place is not a time", () => {
    expect(answer("5 tokyo")).toBeNull();
    expect(answer("13pm tokyo")).toBeNull();
    expect(answer("25:00 tokyo")).toBeNull();
    expect(answer("3pm atlantis")).toBeNull();
    expect(answer("1pm constructor")).toBeNull();
    expect(answer("time machine")).toBeNull();
  });

  test("a wall-clock time across a clock change lands on the right instant", () => {
    // 29 March 2026: Lisbon goes from UTC+0 to UTC+1 at 01:00 UTC.
    const morning = Date.UTC(2026, 2, 29, 9);
    expect(offsetMinutes(morning, "Europe/Lisbon")).toBe(60);
    expect(instantAt(morning, "Europe/Lisbon", 15, 0)).toBe(Date.UTC(2026, 2, 29, 14));
    expect(instantAt(morning, "Europe/Lisbon", 0, 30)).toBe(Date.UTC(2026, 2, 29, 0, 30));
  });

  test("places by city, alias and abbreviation, accents folded", () => {
    expect(zoneNamed("São Paulo")?.zone).toBe("America/Sao_Paulo");
    expect(zoneNamed("NYC")).toEqual({ zone: "America/New_York", place: "NYC" });
    expect(zoneNamed("utc")?.zone).toBe("UTC");
    expect(zoneNamed("atlantis")).toBeNull();
    // A place named like an Object member is no alias.
    expect(zoneNamed("constructor")).toBeNull();
    expect(zoneNamed("toString")).toBeNull();
  });

  test("how far ahead a place is", () => {
    expect(aheadOf(0)).toBe("same time as here");
    expect(aheadOf(60)).toBe("1 h ahead");
    expect(aheadOf(-330)).toBe("5 h 30 min behind");
    expect(aheadOf(45)).toBe("45 min ahead");
  });
});

describe("answers in the launcher's rows", () => {
  const icons = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg" };
  const list = (query: string): ListInput => ({ query, entries: [], recent: [], files: { kind: "none" }, icons, answers: HERE });

  test("a conversion is the first row, and Enter copies the number", () => {
    expect(selectable(buildSections(list("5 km in mi")))[0]).toMatchObject({
      id: "answer",
      title: "= 3.11 mi",
      kind: "Answer",
      action: { kind: "copy", text: "3.11" },
    });
    expect(selectable(buildSections(list("3pm tokyo")))[0]).toMatchObject({ title: "6:00 AM here", action: { kind: "copy", text: "6:00 AM" } });
  });

  test("an answer never asks for files", () => {
    for (const query of ["5 km in mi", "100 usd to eur", "time in lisbon"]) {
      expect(filesStateFor({ query, offered: true, off: false, answer: null, lastCount: 3 })).toEqual({ kind: "none" });
    }
  });
});

describe("answers: the typing budget", () => {
  test("working out an answer, or that there is none, is far under the 2 ms for every instant source", () => {
    const queries = ["firefox", "5 km in mi", "3pm tokyo", "100 usd to eur", "2+2", "time in lisbon", "terminal"];
    for (const query of queries) answer(query);
    const started = performance.now();
    const rounds = 200;
    for (let round = 0; round < rounds; round++) for (const query of queries) answer(query);
    const perQuery = (performance.now() - started) / (rounds * queries.length);
    expect(perQuery).toBeLessThan(0.2);
  });
});
