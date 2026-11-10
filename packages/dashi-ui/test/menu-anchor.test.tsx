import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { MENU_SEPARATOR, PopupMenu } from "../src/popup-menu.tsx";
import { fakeHost, settle } from "./host.ts";

// A menu hung from a toolbar's "…" at the window's right: its right edge under the button, at the width it is
// drawn (not a guess at it); its ticks' column keeps its width in every row; what it covers never shows through.

interface Node {
  props: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, test: (node: Node) => boolean): Node | undefined {
  if (test(node)) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, test) : undefined)).find(Boolean);
}

const items = [
  { label: "Zoom to Fit", keys: "❖9", onPress: () => {} },
  MENU_SEPARATOR,
  { label: "Open With…", onPress: () => {} },
  { label: "Show in Files", checked: true, onPress: () => {} },
];

test("a menu anchored at its end puts its right edge at x, once it knows its width", async () => {
  const host = fakeHost();
  const root = render(<PopupMenu testID="more" x={700} y={40} anchor="end" items={items} onClose={() => {}} />, host.transport);
  await settle();
  const away = root.nodeId("more:away");
  if (away === undefined) throw new Error("no menu");
  host.emit({ type: "resize", nodeId: away, bounds: { x: 0, y: 0, width: 800, height: 600 } });
  await settle();
  // The box around the list reports the width it is drawn at.
  const tree = JSON.parse(host.last()) as Node;
  const box = find(tree, (node) => node.props.focusTrap === true);
  if (!box?.props.id) throw new Error("no menu box");
  host.emit({ type: "resize", nodeId: String(box.props.id), bounds: { x: 0, y: 0, width: 158, height: 120 } });
  await settle();
  const placed = find(JSON.parse(host.last()) as Node, (node) => node.props.focusTrap === true);
  expect(placed?.props.left).toBe(700 - 158);
  root.unmount();
});

test("the ticks' column never shrinks, and the menu's ground is opaque", async () => {
  const host = fakeHost();
  const root = render(<PopupMenu testID="more" x={10} y={40} items={items} onClose={() => {}} />, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Node;
  const ticks: Node[] = [];
  const walk = (node: Node): void => {
    if (node.props.width === 12) ticks.push(node);
    for (const child of node.children ?? []) if (isNode(child)) walk(child);
  };
  walk(tree);
  expect(ticks.length).toBe(3);
  for (const tick of ticks) expect(tick.props.shrink).toBe(false);
  const card = find(tree, (node) => node.props.id === root.nodeId("more"));
  expect(String(card?.props.background)).toMatch(/^#[0-9a-f]{6}$/i);
  root.unmount();
});
