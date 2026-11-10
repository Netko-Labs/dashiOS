import { describe, expect, test } from "bun:test";
import { closeCopy, stillRunning } from "../apps/terminal/closing.ts";
import { lookFor } from "../apps/terminal/line.tsx";
import { terminalMenus } from "../apps/terminal/menus.ts";
import { ANSI_NAMES, contrast, DARK_TERMINAL, groundSide, LIGHT_TERMINAL, terminalPalette } from "../apps/terminal/palette.ts";
import { reservedBy } from "../src/app-menus/lib/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";
import { KEYMAP } from "../src/keymap/keymap.ts";

const AA = 4.5;

describe("the terminal palette", () => {
  test("contrast is WCAG's ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  for (const dark of [false, true]) {
    const palette = terminalPalette(dark);
    const mode = dark ? "dark" : "light";

    test(`${mode}: 16 colors, all #rrggbb`, () => {
      expect(palette.ansi).toHaveLength(ANSI_NAMES.length);
      for (const value of [palette.ground, palette.ink, ...palette.ansi]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    });

    test(`${mode}: the ink and every color programs write text in are AA on the ground`, () => {
      expect(contrast(palette.ink, palette.ground)).toBeGreaterThanOrEqual(7);
      const exempt = new Set(groundSide(dark));
      palette.ansi.forEach((value, index) => {
        if (exempt.has(index)) return;
        const ratio = contrast(value, palette.ground);
        if (ratio < AA) throw new Error(`${mode} ${ANSI_NAMES[index]} ${value} is ${ratio.toFixed(2)}:1 on ${palette.ground}`);
      });
    });

    test(`${mode}: the ground's own side stays near the ground (it is a background, not text)`, () => {
      for (const index of groundSide(dark)) expect(contrast(palette.ansi[index] as string, palette.ground)).toBeLessThan(2);
    });
  }

  test("ls's colored backgrounds stay readable: white on red and blue in Light Mode, black on green and yellow in Dark Mode", () => {
    const [, red, , , blue, , , white] = LIGHT_TERMINAL.ansi as string[];
    expect(contrast(white as string, red as string)).toBeGreaterThanOrEqual(3);
    expect(contrast(white as string, blue as string)).toBeGreaterThanOrEqual(3);
    const [black, , green, yellow] = DARK_TERMINAL.ansi as string[];
    expect(contrast(black as string, green as string)).toBeGreaterThanOrEqual(3);
    expect(contrast(black as string, yellow as string)).toBeGreaterThanOrEqual(3);
  });
});

test("the grid paints with the palette until a program sets its own ink and ground; the cursor is kombu", () => {
  expect(lookFor(LIGHT_TERMINAL, false, "#3E8A72", undefined, undefined)).toEqual({
    ground: LIGHT_TERMINAL.ground,
    ink: LIGHT_TERMINAL.ink,
    selection: "#3E8A7240",
    cursor: LIGHT_TERMINAL.cursor,
  });
  expect(lookFor(DARK_TERMINAL, true, "#3E8A72", "#ffffff", "#102030")).toMatchObject({ ground: "#102030", ink: "#ffffff", cursor: DARK_TERMINAL.cursor });
});

test("the letter under a block cursor (the ground's color on the cursor) is AA in both modes, and the cursor stands 3:1 on the ground", () => {
  for (const dark of [false, true]) {
    const palette = terminalPalette(dark);
    expect(contrast(palette.ground, palette.cursor)).toBeGreaterThanOrEqual(AA);
  }
});

describe("closing a tab that runs something", () => {
  test("only tabs past their prompt count", () => {
    expect(stillRunning([null, "sleep", null, ""])).toEqual(["sleep", ""]);
    expect(stillRunning([null, null])).toEqual([]);
  });

  test("the tab's question names its program", () => {
    expect(closeCopy({ kind: "tab", id: 1, program: "ssh" })).toEqual({
      title: "Close this tab?",
      message: "Closing it stops “ssh”.",
      confirmLabel: "Close tab",
    });
    expect(closeCopy({ kind: "tab", id: 1, program: "" }).message).toBe("Closing it stops a running program.");
  });

  test("the window's question names up to two, else counts them, in one short line", () => {
    expect(closeCopy({ kind: "window", programs: ["vim"] }).message).toBe("Closing it stops “vim”.");
    expect(closeCopy({ kind: "window", programs: ["vim", "ssh"] }).message).toBe("Closing it stops “vim” and “ssh”.");
    expect(closeCopy({ kind: "window", programs: ["vim", "ssh", "make"] }).message).toBe("Closing it stops 3 running programs.");
    expect(closeCopy({ kind: "window", programs: ["sleep", "sleep"] }).message).toBe("Closing it stops 2 running programs.");
    expect(closeCopy({ kind: "window", programs: ["vim"] }).confirmLabel).toBe("Close window");
  });

  test("quitting asks to quit Terminal, naming what still runs", () => {
    expect(closeCopy({ kind: "window", programs: ["sleep"], quit: true })).toEqual({
      title: "Quit Terminal?",
      message: "Quitting stops “sleep”.",
      confirmLabel: "Quit",
    });
    expect(closeCopy({ kind: "window", programs: ["vim", "ssh", "make"], quit: true }).message).toBe("Quitting stops 3 running programs.");
  });
});

describe("the Terminal's menus", () => {
  const noop = (): void => {};
  const heard: string[] = [];
  const terminal = (tabs: string[], canCopy = true) =>
    terminalMenus({
      canCopy,
      tabs,
      active: 0,
      canGrow: true,
      canShrink: false,
      actions: {
        copy: noop,
        paste: noop,
        selectAll: noop,
        clear: () => heard.push("clear"),
        newWindow: noop,
        newTab: noop,
        closeTab: noop,
        closeWindow: noop,
        zoom: (step) => heard.push(`zoom ${step}`),
        jump: (prompts) => heard.push(`jump ${prompts}`),
        stepTab: noop,
        showIndex: noop,
      },
    });
  const menus = (tabs: string[]) => terminal(tabs).menus;

  test("every shortcut reaches the app: ❖W closes the tab and ⇧❖W the window, ❖↑ and ❖↓ jump between prompts", () => {
    const rows = menus(["zsh", "vim"]).flatMap((menu) => menu.items.flatMap((row) => ("shortcut" in row && row.shortcut ? [row] : [])));
    for (const row of rows) {
      const chord = chordFromShortcut(row.shortcut as string);
      expect(chord).not.toBeNull();
      if (chord) expect(reservedBy(chord, KEYMAP, ["metal", "dashiTerminal"])).toBeNull();
    }
    const byKey = new Map(rows.map((row) => [row.shortcut, "id" in row ? row.id : ""]));
    expect(byKey.get("❖W")).toBe("close-tab");
    expect(byKey.get("⇧❖W")).toBe("close-window");
    expect(byKey.get("❖↑")).toBe("previous-prompt");
    expect(byKey.get("❖↓")).toBe("next-prompt");
    expect(byKey.get("❖K")).toBe("clear");
    // Any other Dashi app's ❖↑ is still the move to the top, never its menus'.
    expect(reservedBy({ key: "Up", shift: false, ctrl: false, alt: false })).toBe("super+Up");
  });

  test("the rows do what they say; Copy waits for a selection, and the face's size stops at its ends", () => {
    heard.length = 0;
    const { run, menus: rows } = terminal(["zsh"], false);
    for (const id of ["previous-prompt", "next-prompt", "bigger", "smaller", "actual-size", "clear"]) run(id);
    expect(heard).toEqual(["jump -1", "jump 1", "zoom 1", "zoom 0", "clear"]);
    const copy = rows.flatMap((menu) => menu.items).find((row) => "id" in row && row.id === "copy");
    expect(copy && "enabled" in copy && copy.enabled).toBe(false);
  });
});
