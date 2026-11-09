import { describe, expect, test } from "bun:test";
import { COLUMNS, fitColumns, NAME_MIN } from "../apps/activity-monitor/columns.ts";
import { middleCut } from "../apps/activity-monitor/format.ts";
import { factsRoom, nameFor } from "../apps/activity-monitor/sheets.tsx";
import { graphWidth, SUMMARY_BRIEF_HEIGHT, SUMMARY_HEIGHT, summaryHeight } from "../apps/activity-monitor/summary.tsx";
import { briefFigures } from "../apps/activity-monitor/summary-figures.ts";
import { TOOLBAR_MIN_WIDTH, TOOLBAR_STEPS, type ToolbarFit, toolbarFit, toolbarRoom, toolbarWidth } from "../apps/activity-monitor/toolbar-fit.ts";
import { VIEW_LABELS, viewLabel } from "../apps/activity-monitor/view-menus.tsx";

// Review 54 (Activity Monitor): the layout in a small or narrow window.

/** The window controls' inset in the VM (the title started 90 pt in: 76 + 14). */
const LEADING = 76;

describe("toolbar", () => {
  test("at the default size everything shows: the title, Quit…'s words, the view's words, the tabs and the field", () => {
    expect(toolbarFit(toolbarRoom(940, LEADING))).toEqual(TOOLBAR_STEPS[0] as ToolbarFit);
  });

  test("each step is narrower than the one before, so the row gives way in order", () => {
    const widths = TOOLBAR_STEPS.map(toolbarWidth);
    for (let index = 1; index < widths.length; index++) expect(widths[index] as number).toBeLessThan(widths[index - 1] as number);
  });

  test("the title goes first, then Quit's words, then the field becomes a glyph", () => {
    const at = (width: number) => toolbarFit(toolbarRoom(width, LEADING));
    expect(at(900)).toMatchObject({ title: false, quitLabel: true, searchField: true });
    expect(at(780)).toMatchObject({ title: false, quitLabel: false, searchField: true });
    expect(at(640)).toMatchObject({ title: false, quitLabel: false, searchField: false, segment: 64 });
  });

  test("at the least width (the brief's 520 × 400, and a half-screen tile) the whole row fits", () => {
    const fit = toolbarFit(toolbarRoom(TOOLBAR_MIN_WIDTH, LEADING));
    expect(toolbarWidth(fit)).toBeLessThanOrEqual(toolbarRoom(TOOLBAR_MIN_WIDTH, LEADING));
    expect(toolbarWidth(fit)).toBeLessThanOrEqual(toolbarRoom(539, LEADING));
  });

  test("with an ordinary title bar there is no inset to clear", () => {
    expect(toolbarRoom(600, 0)).toBe(600 - 18 - 12);
  });
});

describe("view button", () => {
  test("it knows every label it can show, so it keeps the longest one's width", () => {
    for (const grouped of [true, false]) for (const mine of [true, false]) expect(VIEW_LABELS).toContain(viewLabel({ grouped, mine }));
  });
});

describe("columns", () => {
  const width = (keys: readonly { width?: number }[]): number => keys.reduce((sum, column) => sum + (column.width ?? 0), 0);

  test("at the default size every column shows", () => {
    for (const tab of ["cpu", "memory", "energy", "disk", "network"] as const) expect(fitColumns(tab, COLUMNS[tab], 940)).toHaveLength(COLUMNS[tab].length);
  });

  test("in a narrow window the name keeps its least width, and the figures it can spare go first", () => {
    for (const tab of ["cpu", "memory", "energy", "disk", "network"] as const) {
      for (const window of [520, 539, 640]) {
        const kept = fitColumns(tab, COLUMNS[tab], window);
        expect(window - 10 - width(kept)).toBeGreaterThanOrEqual(NAME_MIN);
        expect(kept[0]?.key).toBe("name");
        expect(kept[1]?.key).toBe(COLUMNS[tab][1]?.key);
      }
    }
    expect(fitColumns("cpu", COLUMNS.cpu, 520).map((column) => column.key)).toEqual(["name", "cpu", "cpuTime", "threads", "pid"]);
  });

  test("the column the list is sorted by stays", () => {
    expect(fitColumns("cpu", COLUMNS.cpu, 520, "user").map((column) => column.key)).toContain("user");
  });
});

describe("summary", () => {
  test("a short window gets one line, a tall one the strip with its graph", () => {
    expect(summaryHeight(400)).toBe(SUMMARY_BRIEF_HEIGHT);
    expect(summaryHeight(640)).toBe(SUMMARY_HEIGHT);
  });

  test("the graph narrows before the figures are cut, and stops at its widest", () => {
    expect(graphWidth(940)).toBe(260);
    expect(graphWidth(640)).toBeLessThan(260);
    expect(graphWidth(520)).toBeGreaterThanOrEqual(120);
  });

  test("the one line keeps the figures the graph showed, without swatches", () => {
    const figures = [
      { label: "Idle", value: "97.3%" },
      { label: "System", value: "1.1%", color: "#123456" },
      { label: "User", value: "1.7%", color: "#654321" },
      { label: "Cores", value: "8" },
    ];
    expect(briefFigures("cpu", figures)).toEqual([
      { label: "System", value: "1.1%" },
      { label: "User", value: "1.7%" },
      { label: "Idle", value: "97.3%" },
    ]);
  });
});

describe("sheets", () => {
  test("a long name is cut in the middle, keeping both ends", () => {
    expect(middleCut("alex-kim-quarterly-report-renderer-for-the-whole-design-team", 21)).toBe("alex-kim-q…esign-team");
    expect(middleCut("bash", 10)).toBe("bash");
    expect([...middleCut("abcdefghij", 5)]).toHaveLength(5);
  });

  test("the quit question keeps a long name on its one line, cut in the middle", () => {
    const name = "alex-kim-quarterly-report-renderer-for-the-whole-design-team";
    const cut = nameFor(name, 420, 8);
    expect(cut).toContain("…");
    expect(cut.startsWith("alex-kim")).toBe(true);
    expect(cut.endsWith("design-team")).toBe(true);
    expect(nameFor("Files", 420, 8)).toBe("Files");
  });

  test("Inspect's facts leave Done inside a 400 pt window", () => {
    const room = factsRoom(400, 38, false);
    // The sheet hangs at 46 and its frame, question and buttons take 119 more; under it, 8.
    expect(46 + 40 + 17 + 10 + room + 44 + 8).toBeLessThanOrEqual(400);
    expect(factsRoom(200, 38, true)).toBe(80);
  });
});
