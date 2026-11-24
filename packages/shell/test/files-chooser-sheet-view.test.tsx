/**
 * The chooser's own measures (review 17). Its "Save as" field collapsed to a
 * sliver, its label wrapping, in a row of parts that keep their width: the
 * field now takes the row's room, never under a name's worth, and the label
 * stays on one line. As Text Editor's sheet it was as wide as the editor and
 * started 8 from the window's top, so the window's buttons sat on its Back
 * and Up: it now hangs below the title bar, inside the window at each side,
 * on the kit's Sheet (its scrim, 0.10).
 */

import { afterAll, expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { CHOOSER_SHEET, ChooserSheet } from "../src/shared/file-browser/chooser-view.tsx";
import { openChooser } from "../src/shared/file-browser/index.ts";
import { chooserRequest } from "../src/shared/files/chooser/request.ts";
import { settle } from "./support/time.ts";

interface Node {
  type: string;
  props?: Record<string, unknown>;
  children?: Array<Node | string>;
}

/** The tree the host was sent, and a node by its testID with its parent. */
async function tree(element: ReactElement): Promise<(testID: string) => { node: Node; parent: Node | null }> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => void trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const mounted = render(element, transport);
  await settle();
  const root = JSON.parse(trees.at(-1) ?? "{}") as Node;
  const ids = new Map(["chooser", "chooser:name-box", "chooser:name", "chooser:footer", "content"].map((testID) => [testID, mounted.nodeId(testID)]));
  mounted.unmount();
  return (testID: string) => {
    const found = walk(root, null, ids.get(testID));
    if (!found) throw new Error(`no ${testID}`);
    return found;
  };
}

function walk(node: Node, parent: Node | null, id: string | undefined): { node: Node; parent: Node | null } | undefined {
  if (id !== undefined && node.props?.id === id) return { node, parent };
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue;
    const found = walk(child, node, id);
    if (found) return found;
  }
  return undefined;
}

const saving = openChooser(chooserRequest("save", { currentName: "notes.txt" }), undefined, { watch: false });
afterAll(() => saving.stop());
const sheet = () => tree(<ChooserSheet model={saving} title="Save As" exists={() => false} answer={() => {}} />);

test("the Save as field takes the row's room, at least 160 wide, and its label keeps to one line", async () => {
  const find = await sheet();
  const box = find("chooser:name-box");
  expect(box.node.props).toMatchObject({ flex: 1, minWidth: 160, direction: "row" });
  expect(find("chooser:name").parent).toBe(box.node);
  // The label is the row's first part: a box that never shrinks, its text on one line.
  const label = box.parent?.children?.[0] as Node;
  expect(label.props).toMatchObject({ shrink: false });
  expect(label.children?.[0]).toMatchObject({ type: "text", props: { truncate: true }, children: ["Save as"] });
});

test("as a sheet it hangs below the title bar and stays inside the window", async () => {
  const { node: card, parent: scrim } = (await sheet())("chooser");
  // The kit's Sheet: the window's scrim, SHEET_MARGIN from its foot; the card under the title bar.
  expect(scrim?.props).toMatchObject({ paddingBottom: CHOOSER_SHEET.inset });
  expect(Number(card.props?.marginTop)).toBeGreaterThanOrEqual(CHOOSER_SHEET.below);
  // At most 760 (the window's width less 16 a side once laid out, sheetWidth); shorter when the window is.
  expect(Number(card.props?.width)).toBeLessThanOrEqual(CHOOSER_SHEET.width);
  expect(card.props).toMatchObject({ height: CHOOSER_SHEET.height, minHeight: 0 });
  expect(card.props?.shrink).not.toBe(false);
});

// The installed pass: Cancel and Open sat on the grid, and the last row's names were hidden behind them.
test("Cancel and Open sit on a strip of their own, under a hairline, below the listing", async () => {
  const find = await sheet();
  const footer = find("chooser:footer");
  expect(footer.node.props).toMatchObject({ shrink: false, borderTop: 1 });
  // The listing is in a column of its own beside the strip, not in the strip's.
  expect(footer.parent?.children).not.toContain(find("content").node);
});
