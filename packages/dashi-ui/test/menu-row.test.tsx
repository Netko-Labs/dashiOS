import { describe, expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { HUNG_ROWS, hungHeight, MENU, menuFits, menuLabelLeft, menuMaxWidth } from "../src/menu-place.ts";
import { MenuHighlightContext, MenuRow } from "../src/menu-row.tsx";
import { Shortcut } from "../src/shortcut.tsx";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

// 0.6 menus: the menu bar's menus drew 22 rows 6 in with a 14 tick gutter and 28 before the keys, a
// window's 24 rows 8 in with a 12 column; the same app's menu bar menu and right-click menu didn't line
// up. Every menu draws this one row now. Its shortcut keeps its key in a column, so ❖W and ⇧❖I end their
// modifiers on one edge.

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isDrawn = (child: unknown): child is Drawn => typeof child === "object" && child !== null && "props" in child;
const kids = (node: Drawn | undefined): Drawn[] => (node?.children ?? []).filter(isDrawn);

async function drawn(element: React.ReactElement): Promise<Drawn> {
  const host = fakeHost();
  const root = render(element, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  root.unmount();
  return tree;
}

describe("MenuRow", () => {
  test("a row is 24 tall at radius 5, 8 in, 24 between its label and its keys", async () => {
    const row = await drawn(<MenuRow testID="r" label="Undo" keys="❖Z" ticks={false} lit={false} />);
    expect(row.props).toMatchObject({ height: MENU.row, paddingX: MENU.inset, cornerRadius: MENU.rowRadius, gap: MENU.keysGap, shrink: false });
  });

  test("with ticks, every row keeps the 12 column and 6 after it; the label starts at menuLabelLeft", async () => {
    const row = await drawn(<MenuRow testID="r" label="Icons" ticks checked={false} lit={false} />);
    const lead = kids(row)[0];
    expect(lead?.props.gap).toBe(MENU.tickGap);
    expect(kids(lead)[0]?.props).toMatchObject({ width: MENU.tick, shrink: false });
    expect(menuLabelLeft(true)).toBe(MENU.edge + MENU.padding + MENU.inset + MENU.tick + MENU.tickGap);
    expect(menuLabelLeft(false)).toBe(MENU.edge + MENU.padding + MENU.inset);
  });

  test("a lit row is kombu with white ink; a disabled one never lights", async () => {
    const lit = await drawn(<MenuRow testID="r" label="Copy" ticks={false} lit />);
    expect(lit.props.background).not.toBe("#00000000");
    const off = await drawn(<MenuRow testID="r" label="Copy" ticks={false} lit disabled />);
    expect(off.props.background).toBe("#00000000");
  });

  test("inside a MenuHighlightContext a lit row takes the surface's fill and ink (Settings' green, not kombu)", async () => {
    const look = { fill: "#86d3b6", ink: "#0b2a20", keysInk: "#0b2a20cc" };
    const row = await drawn(
      <MenuHighlightContext.Provider value={look}>
        <MenuRow testID="r" label="5 min" ticks checked lit />
      </MenuHighlightContext.Provider>,
    );
    expect(String(row.props.background).toLowerCase()).toContain("86d3b6");
    expect(JSON.stringify(row)).toContain("0b2a20");
    expect(JSON.stringify(row)).not.toContain('#ffffff"');
  });
});

describe("Shortcut's key column", () => {
  test("the last key sits at the left of a column at least `keyColumn` wide", async () => {
    const keys = await drawn(<Shortcut keys="⇧❖I" color="#000" size={12} keyColumn={MENU.keyColumn} />);
    const parts = kids(keys);
    expect(parts.map((part) => part.type)).toEqual(["svg", "svg", "view"]);
    expect(parts[2]?.props).toMatchObject({ minWidth: MENU.keyColumn, justify: "start" });
  });

  test("without one, the keys are one run, as before", async () => {
    const keys = await drawn(<Shortcut keys="❖I" color="#000" />);
    expect(kids(keys).map((part) => part.type)).toEqual(["svg", "text"]);
  });
});

describe("menuMaxWidth", () => {
  test("a menu is never wider than its window less 6 a side", () => {
    expect(menuMaxWidth(undefined, 300)).toBe(300 - 2 * MENU.margin);
    expect(menuMaxWidth(280, 1000)).toBe(280);
    expect(menuMaxWidth(280, 200)).toBe(200 - 2 * MENU.margin);
  });

  test("before the window is known, only its own cap", () => {
    expect(menuMaxWidth(undefined, 0)).toBeUndefined();
    expect(menuMaxWidth(280, 0)).toBe(280);
  });
});

// 0.6 menus: in a 300-tall Files window, "…"'s menu didn't fit under the button and slid up over it.
describe("hungHeight", () => {
  const rows = (count: number): number => count * MENU.row + 2 * (MENU.padding + MENU.edge);

  test("a menu that fits under its button keeps its height", () => {
    expect(hungHeight(rows(5), 40, 600)).toBe(rows(5));
  });

  test("one that doesn't is as tall as the room under the button, and scrolls", () => {
    expect(hungHeight(rows(11), 32, 300)).toBe(300 - 32 - MENU.margin);
  });

  test(`with fewer than ${HUNG_ROWS} rows' room under it, it fits the window as any menu does`, () => {
    expect(hungHeight(rows(11), 250, 300)).toBe(menuFits(rows(11), 300));
  });

  test("before the window is known, its own height", () => {
    expect(hungHeight(rows(11), 32, 0)).toBe(rows(11));
  });
});
