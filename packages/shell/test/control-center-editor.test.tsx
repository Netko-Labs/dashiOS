import { expect, test } from "bun:test";
import { type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import { ControlGrid, REMOVE_MARK, removeMarkAt } from "../src/control-center/grid.tsx";
import { pack } from "../src/control-center/layout.ts";
import { settle } from "./support/time.ts";

// The editor's grid (the panel's edit mode and Settings' editor): a tile's "−" is drawn over everything in the grid.

interface TreeNode {
  props?: Record<string, unknown>;
  children?: TreeNode[];
}

const byId = (node: TreeNode, id: string): TreeNode | null => {
  if (node.props?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = byId(child, id);
    if (found) return found;
  }
  return null;
};

test("every '−' comes after every tile and ring, so a tile laid flat under it never covers it", async () => {
  let last = "";
  const transport: NativeTransport = { send: (frame) => void (last = frame), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  // The volume slider laid flat, under the second row's first tile: where its "−" went missing.
  const placed = pack([
    { id: "network", size: "wide" },
    { id: "focus", size: "round" },
    { id: "dark", size: "round" },
    { id: "volume", size: "flat" },
  ]);
  const root: NativeRoot = render(
    <ControlGrid
      placed={placed}
      focused="volume"
      editing={{ onRemove() {}, onResize() {}, onMove() {} }}
      radiusOf={() => 28}
      renderTile={(tile) => <View testID={`tile:${tile.id}`} style={{ flex: 1, backgroundColor: "#1d1830" }} />}
    />,
    transport,
  );
  await settle();
  const tree = JSON.parse(root.lastTree() ?? last) as TreeNode;
  const grid = byId(tree, root.nodeId("cc-grid") ?? "");
  const order = (grid?.children ?? []).map((child) => String(child.props?.id ?? ""));
  const marks = placed.map((tile) => root.nodeId(`cc-remove:${tile.id}`) ?? "missing");
  const tiles = order.filter((id) => !marks.includes(id));
  // The tiles' frames first (their rings inside them), then every mark.
  expect(order).toEqual([...tiles, ...marks]);
  expect(tiles).toHaveLength(placed.length);
  root.unmount();
});

test("a '−' sits 5 out from its tile's top left, 20 across", () => {
  expect(removeMarkAt({ left: 82, top: 64 })).toEqual({ left: 77, top: 59 });
  expect(REMOVE_MARK).toEqual({ size: 20, out: 5 });
});
