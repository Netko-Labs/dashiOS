import { expect, test } from "bun:test";
import { Caption, Group, ROW_INSET, Row, SidebarItem, TILE_SIZE } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { PAGE, pillsUnder, roomBeside, Row as SettingsRow } from "../src/settings-app/row.tsx";
import { titleLine } from "../src/settings-app/ui.tsx";
import { pillsWrapped, SEGMENTED, Segmented } from "../src/shared/controls/inputs.tsx";
import { settle } from "./support/time.ts";

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

test("a row's pills go under its words when the room beside them is less than their one-line width", () => {
  expect(pillsUnder(300, null)).toBe(false);
  expect(pillsUnder(300, 300)).toBe(false);
  expect(pillsUnder(299, 300)).toBe(true);
  // The room: the row's insets, the knob and its gap, the words' least width and the gap after them.
  expect(roomBeside(800, true)).toBe(800 - PAGE.knobInset - PAGE.knob - 12 - PAGE.inset - PAGE.words - 12);
  expect(roomBeside(800, false)).toBe(800 - 2 * PAGE.inset - PAGE.words - 12);
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

const LINE = SEGMENTED.height + 2 * SEGMENTED.padding;

test("pills squeezed while the window narrows go back beside the words when it widens, whichever layout event comes first", async () => {
  // mirin reports a parent's children after laying them out: the pills' layout comes before their row's.
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (sent) => trees.push(sent),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const options = ["Default", "Large", "Larger", "Largest"].map((label) => ({ value: label, label }));
  const root = render(
    <SettingsRow testID="row" label="Text size" glyph="<svg/>">
      <Segmented testID="pills" options={options} value="Default" onChange={() => {}} />
    </SettingsRow>,
    transport,
  );
  const laid = async (testID: string, width: number, height: number): Promise<void> => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no ${testID}`);
    for (const listener of listeners) listener({ type: "resize", nodeId, bounds: { x: 0, y: 0, width, height } });
    await settle();
  };
  const under = (): boolean => {
    const id = root.nodeId("row");
    const row = views(JSON.parse(trees.at(-1) ?? "{}") as Node).find((node) => node.props.id === id);
    return (row?.children ?? []).filter(isNode).length > 1;
  };
  await settle();
  // A wide window: one line of pills beside the words.
  await laid("pills", 300, LINE);
  await laid("row", 822, 56);
  expect(under()).toBe(false);
  // Half the screen: the pills wrap (their event first), then the row tells its new width.
  await laid("pills", 180, 2 * LINE);
  await laid("row", 500, 56);
  expect(under()).toBe(true);
  // Under the words they lie on one line again; back at the first width they go beside the words.
  await laid("pills", 300, LINE);
  await laid("row", 744, 56);
  expect(under()).toBe(false);
  await laid("row", 822, 56);
  expect(under()).toBe(false);
  root.unmount();
});
