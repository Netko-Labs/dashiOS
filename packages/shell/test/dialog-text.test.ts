import { describe, expect, test } from "bun:test";
import { addDays, daysIn, formatDate, monthCells } from "../apps/dialog/date-format.ts";
import { compressEscapes, decodeEntities, displayText, splitMessage, stripMarkup } from "../apps/dialog/markup.ts";
import { LineSplitter } from "../apps/dialog/stdin.ts";

describe("markup", () => {
  test("C escapes, as g_strcompress reads them", () => {
    expect(compressEscapes("a\\nb\\tc")).toBe("a\nb\tc");
    expect(compressEscapes('\\\\ \\" \\q')).toBe('\\ " q');
    expect(compressEscapes("\\101\\0")).toBe("A\0");
    expect(compressEscapes("trailing\\")).toBe("trailing");
  });

  test("entities", () => {
    expect(decodeEntities("&lt;b&gt; &amp; &quot;x&quot; &#65;&#x42; &bogus;")).toBe('<b> & "x" AB &bogus;');
  });

  test("tags come out, a lone < stays", () => {
    expect(stripMarkup('<b>Bold</b> <span foreground="red">red</span><br/>')).toBe("Bold red");
    expect(stripMarkup("1 < 2 and 3 > 2")).toBe("1 < 2 and 3 > 2");
    expect(stripMarkup("&lt;b&gt;")).toBe("<b>");
  });

  test("displayText", () => {
    expect(displayText("<i>Hi</i>\\nthere", false)).toBe("Hi\nthere");
    expect(displayText("<i>Hi</i>\\nthere", true)).toBe("<i>Hi</i>\\nthere");
  });

  test("an alert's headline and body", () => {
    expect(splitMessage("Delete the file?")).toEqual({ headline: "Delete the file?", body: "" });
    expect(splitMessage("Update failed\n\nThe disk is full.")).toEqual({ headline: "Update failed", body: "The disk is full." });
    const long = "word ".repeat(40).trim();
    expect(splitMessage(long)).toEqual({ headline: "", body: long });
  });
});

describe("date format", () => {
  test("strftime's conversions", () => {
    expect(formatDate(null, 2026, 11, 3)).toBe("11/03/2026");
    expect(formatDate("%Y-%m-%d", 2026, 1, 9)).toBe("2026-01-09");
    expect(formatDate("%A %e %B %y, day %j %%", 2024, 3, 1)).toBe("Friday  1 March 24, day 061 %");
    expect(formatDate("%a %b %d %Q", 2026, 11, 3)).toBe("Tue Nov 03 %Q");
  });

  test("months", () => {
    expect(daysIn(2024, 2)).toBe(29);
    expect(daysIn(2026, 2)).toBe(28);
    expect(daysIn(2026, 12)).toBe(31);
    const november = monthCells(2026, 11);
    expect(november).toHaveLength(42);
    // November 1st 2026 is a Sunday.
    expect(november[0]).toBe(1);
    expect(november[29]).toBe(30);
    expect(november[30]).toBeNull();
    expect(monthCells(2026, 10).slice(0, 5)).toEqual([null, null, null, null, 1]);
    expect(addDays(2026, 12, 28, 7)).toEqual({ year: 2027, month: 1, day: 4 });
  });
});

describe("stdin lines", () => {
  test("lines across pieces, and a last line without a newline", () => {
    const lines = new LineSplitter();
    expect(lines.push("10\n# Down")).toEqual(["10"]);
    expect(lines.push("loading\n50")).toEqual(["# Downloading"]);
    expect(lines.end()).toEqual(["50"]);
    expect(lines.end()).toEqual([]);
  });
});
