import { expect, test } from "bun:test";
import { Caption, Group, ROW_INSET, Row, SidebarItem, TILE_SIZE } from "@dashi/ui";
import { type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { PAGE, pillsUnder } from "../src/settings-app/row.tsx";
import { titleLine } from "../src/settings-app/ui.tsx";
import { pillsWrapped, SEGMENTED } from "../src/shared/controls/inputs.tsx";

// Shared edges (review 0.6 04-align-b): one line for the lights, the search
// and the title; one left edge for a list's labels and a card's captions;
// pills that wrap go under their row's words instead.

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

async function lastTree(tree: ReactNode): Promise<Node> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(tree, transport);
  await new Promise((done) => setTimeout(done, 30));
  root.unmount();
  return JSON.parse(trees.at(-1) ?? "{}") as Node;
}

function views(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const child of node.children ?? []) if (isNode(child)) views(child, out);
  return out;
}

/** dashi-comp's window lights: a 12 row 13 down, so their line is 19 down. */
const LIGHTS = { x: 14, y: 13, width: 56, height: 12 };

test("Settings' title sits on the window lights' line in its 56 row, the row's middle without lights", () => {
  expect(titleLine(LIGHTS)).toBe(19);
  expect(titleLine(null)).toBe(PAGE.title / 2);
  // Lights lower than the row's middle never push the title out of its row.
  expect(titleLine({ x: 14, y: 60, width: 56, height: 12 })).toBe(PAGE.title / 2);
});

test("a row's pills go under its words at the width they wrapped at and under, and are tried beside them again past it", () => {
  expect(pillsUnder(744, null)).toBe(false);
  expect(pillsUnder(744, 744)).toBe(true);
  expect(pillsUnder(700, 744)).toBe(true);
  expect(pillsUnder(745, 744)).toBe(false);
  // One line of pills is a pill and the track's padding; anything taller wrapped.
  const line = SEGMENTED.height + 2 * SEGMENTED.padding;
  expect(pillsWrapped(line)).toBe(false);
  expect(pillsWrapped(line + 0.5)).toBe(false);
  expect(pillsWrapped(2 * SEGMENTED.height + SEGMENTED.gap + 2 * SEGMENTED.padding)).toBe(true);
});

test("a sidebar that mixes glyphs and tiles starts every label at one edge: the glyph sits in a tile's width", async () => {
  const tree = await lastTree(
    <View>
      <SidebarItem testID="glyph" label="Discover" glyph="<svg/>" tileColumn selected={false} onPress={() => {}} />
      <SidebarItem testID="bare" label="Recents" glyph="<svg/>" selected={false} onPress={() => {}} />
    </View>,
  );
  const rows = (tree.children ?? []).filter(isNode);
  const slot = rows[0]?.children?.find(isNode);
  expect(slot?.props.width).toBe(TILE_SIZE);
  expect(slot?.props.align).toBe("center");
  // Without it, a Files-style list keeps its bare glyph.
  expect(rows[1]?.children?.find(isNode)?.type).toBe("svg");
});

test("a caption's words start where its card's rows' words do", async () => {
  const tree = await lastTree(
    <View>
      <Caption above>Battery</Caption>
      <Group>
        <Row label="Low Power Mode" />
      </Group>
      <Caption>The battery lasts longest kept below full.</Caption>
    </View>,
  );
  const all = views(tree);
  const captions = all.filter((view) => view.children?.some((child) => isNode(child) && child.type === "text" && child.props.size !== 13));
  expect(captions.length).toBeGreaterThanOrEqual(2);
  for (const caption of captions) expect(caption.props.paddingX).toBe(ROW_INSET);
  expect(all.some((view) => view.props.direction === "row" && view.props.paddingX === ROW_INSET && view.props.minHeight === 44)).toBe(true);
});
