import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { PopupMenu } from "../src/popup-menu.tsx";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

// Review 54 (Notes 12): the Move menu took a long folder's whole name, 490 pt, and was pushed far
// left of its button. A menu can be capped, its long labels cut, and hung by its right edge.

interface Node {
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, test: (node: Node) => boolean): Node | undefined {
  if (test(node)) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, test) : undefined)).find(Boolean);
}

const items = [
  { label: "Move to Notes", checked: true, onPress: () => {} },
  { label: "Move to Recipes and other things from the farmers market on Saturdays", checked: false, onPress: () => {} },
];

test("a capped menu is no wider than its cap, and its labels may shrink to an ellipsis", async () => {
  const host = fakeHost();
  const root = render(<PopupMenu testID="move" x={700} y={40} anchor="end" maxWidth={280} items={items} onClose={() => {}} />, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  const card = find(tree, (node) => node.props.id === root.nodeId("move"));
  expect(card?.props.maxWidth).toBe(280);
  const row = find(tree, (node) => node.props.id === root.nodeId(`move:${items[1]?.label}`));
  const lead = (row?.children ?? []).filter(isNode)[0];
  expect(lead?.props.shrink).not.toBe(false);
  expect(lead?.props.minWidth).toBe(0);
  root.unmount();
});

test("a menu hung by its end puts its right edge at x, at the width it is drawn", async () => {
  const host = fakeHost();
  const root = render(<PopupMenu testID="move" x={700} y={40} anchor="end" maxWidth={280} items={items} onClose={() => {}} />, host.transport);
  await settle();
  const away = root.nodeId("move:away");
  if (away === undefined) throw new Error("no menu");
  host.emit({ type: "resize", nodeId: away, bounds: { x: 0, y: 0, width: 980, height: 600 } });
  await settle();
  const box = find(JSON.parse(host.last()) as Node, (node) => node.props.focusTrap === true);
  if (!box?.props.id) throw new Error("no menu box");
  host.emit({ type: "resize", nodeId: String(box.props.id), bounds: { x: 0, y: 0, width: 280, height: 60 } });
  await settle();
  const placed = find(JSON.parse(host.last()) as Node, (node) => node.props.focusTrap === true);
  expect(placed?.props.left).toBe(700 - 280);
  root.unmount();
});
