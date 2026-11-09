import { describe, expect, test } from "bun:test";
import { TAB_LABEL, tabLabel } from "../apps/terminal/menus.ts";
import { fitTabs, MORE_WIDTH, TAB_GAP, TAB_MIN } from "../apps/terminal/strip-fit.ts";

describe("the tab strip's fit", () => {
  test("every tab shows while each keeps its least width, and before the strip is measured", () => {
    expect(fitTabs(6, 5, 6 * TAB_MIN + 5 * TAB_GAP)).toEqual({ start: 0, end: 6, hidden: 0 });
    // The default window's strip (760 wide) holds six.
    expect(fitTabs(6, 0, 630)).toEqual({ start: 0, end: 6, hidden: 0 });
    expect(fitTabs(6, 3, null)).toEqual({ start: 0, end: 6, hidden: 0 });
    expect(fitTabs(0, -1, 400)).toEqual({ start: 0, end: 0, hidden: 0 });
  });

  test("a small window shows what fits and counts the rest; the tab in front is always among them", () => {
    // 520 wide: about 390 for the strip, three tabs and "+3".
    expect(fitTabs(6, 0, 390)).toEqual({ start: 0, end: 3, hidden: 3 });
    expect(fitTabs(6, 2, 390)).toEqual({ start: 0, end: 3, hidden: 3 });
    // The fifth in front ends the run.
    expect(fitTabs(6, 4, 390)).toEqual({ start: 2, end: 5, hidden: 3 });
    expect(fitTabs(6, 5, 390)).toEqual({ start: 3, end: 6, hidden: 3 });
    // The count and the shown tabs fit the strip.
    const shown = 3;
    expect(shown * (TAB_MIN + TAB_GAP) + MORE_WIDTH).toBeLessThanOrEqual(390);
  });

  test("a narrow window keeps the tab in front, named, and counts the others: never a lone ×", () => {
    // 340 wide: about 210 for the strip.
    expect(fitTabs(6, 0, 210)).toEqual({ start: 0, end: 1, hidden: 5 });
    expect(fitTabs(6, 3, 210)).toEqual({ start: 3, end: 4, hidden: 5 });
    // Narrower than one tab: still the one in front.
    expect(fitTabs(6, 5, 40)).toEqual({ start: 5, end: 6, hidden: 5 });
    // Two tabs where one fits: the front one and "+1".
    expect(fitTabs(2, 1, 150)).toEqual({ start: 1, end: 2, hidden: 1 });
  });
});

describe("a tab's row in the View menu", () => {
  test("a short name stays whole", () => {
    expect(tabLabel("src")).toBe("src");
    expect(tabLabel("x".repeat(TAB_LABEL))).toBe("x".repeat(TAB_LABEL));
  });

  test("a long one is cut in the middle to 36 characters, its start and its end kept", () => {
    const label = tabLabel("community-garden-volunteer-schedule-and-watering-rota-2027");
    expect(Array.from(label).length).toBeLessThanOrEqual(TAB_LABEL);
    expect(label.startsWith("community-garden-volun")).toBe(true);
    expect(label.endsWith("watering-rota-2027")).toBe(false);
    expect(label.endsWith("rota-2027")).toBe(true);
    expect(label).toContain("…");
    // A wide character is one character, never half of one.
    expect(Array.from(tabLabel("界".repeat(50))).length).toBe(TAB_LABEL);
  });
});
