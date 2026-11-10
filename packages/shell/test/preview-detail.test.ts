import { describe, expect, test } from "bun:test";
import { detailChoices, fitDetail, textWidth } from "../apps/preview/lib/detail.ts";

const image = { size: { width: 3200, height: 1800 }, folder: { index: 2, count: 12 }, pdf: null };

describe("Preview's toolbar words", () => {
  test("an image says its size and its place in the folder, then its size alone", () => {
    expect(detailChoices(image)).toEqual(["3200 × 1800 · 3 of 12", "3200 × 1800"]);
    expect(detailChoices({ ...image, folder: { index: 0, count: 1 } })).toEqual(["3200 × 1800"]);
    expect(detailChoices({ ...image, size: null })).toEqual(["3 of 12"]);
    expect(detailChoices({ size: null, folder: null, pdf: null })).toEqual([]);
  });

  test("a PDF says its pages and title, then its pages alone", () => {
    expect(detailChoices({ ...image, pdf: { pages: 12, title: "Lease" } })).toEqual(["12 pages · Lease", "12 pages"]);
    expect(detailChoices({ ...image, pdf: { pages: 1, title: null } })).toEqual(["1 page"]);
  });

  test("a narrow window drops the folder place before it would cut the size, and never shows half of it", () => {
    const choices = detailChoices(image);
    const full = choices[0] as string;
    const size = choices[1] as string;
    expect(fitDetail(choices, 400)).toBe(full);
    expect(fitDetail(choices, textWidth(full))).toBe(size);
    expect(fitDetail(choices, textWidth(size) + 4)).toBe(size);
    expect(fitDetail(choices, textWidth(size) - 1)).toBeNull();
    expect(fitDetail(choices, 0)).toBeNull();
  });

  test("the estimate grows with the words", () => {
    expect(textWidth("320 × 180")).toBeLessThan(textWidth("3200 × 1800"));
    expect(textWidth("")).toBe(0);
  });
});
