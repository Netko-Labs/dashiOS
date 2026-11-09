import { expect, test } from "bun:test";
import { LIGHT_SURFACE, lightColors, MENU } from "@dashi/ui";
import { type NativeTransport, render } from "@mirinjs/metal";
import type { MenuEntry } from "../src/menus/model.ts";
import { DropdownMenu } from "../src/menus/view.tsx";

// 0.6 menus: the menu bar's dropdown drew its own rows (22 tall, 6 in, a 14 gutter) and a white edge that
// vanished on a light window. It draws every menu's row now, with the menus' edge, and stays on its screen.

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isDrawn = (child: unknown): child is Drawn => typeof child === "object" && child !== null && "props" in child;
const find = (node: Drawn, id: string): Drawn | undefined =>
  node.props.id === id
    ? node
    : (node.children ?? [])
        .filter(isDrawn)
        .map((child) => find(child, id))
        .find(Boolean);

test("the menu bar's dropdown draws every menu's rows and edge, inside the screen", async () => {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const entries: MenuEntry<string>[] = [
    { kind: "item", label: "Undo", keys: "❖Z", action: "undo" },
    { kind: "separator" },
    { kind: "item", label: "Show Sidebar", checked: true, action: "sidebar" },
    { kind: "item", label: "Can't", action: null },
  ];
  const root = render(<DropdownMenu entries={entries} x={1250} room={{ width: 1280, height: 772 }} onChoose={() => {}} onClose={() => {}} />, transport);
  await new Promise((done) => setTimeout(done, 20));
  const tree = JSON.parse(trees.at(-1) ?? "{}") as Drawn;
  const panel = find(tree, root.nodeId("menu-panel") ?? "");
  // Solid: the card ground under the menu's tint, so the window under it never ghosts through.
  expect(panel?.props).toMatchObject({ cornerRadius: MENU.radius, borderColor: lightColors.menuEdge, background: LIGHT_SURFACE.card });
  const inner = (panel?.children ?? []).filter(isDrawn)[0];
  expect(inner?.props).toMatchObject({ padding: MENU.padding, background: lightColors.menu });
  // Its least width (not drawn yet) kept 6 inside the screen's right side.
  expect(panel?.props.left).toBe(1280 - MENU.margin - 230);
  for (const label of ["Undo", "Show Sidebar", "Can't"]) {
    const row = find(tree, root.nodeId(`menu-row:${label}`) ?? "");
    expect(row?.props).toMatchObject({ height: MENU.row, paddingX: MENU.inset });
  }
  root.unmount();
});
