import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { MenuList } from "../src/sheet.tsx";
import { fakeHost, settle } from "./host.ts";

// Review 54 (Files 14, 15): a ticked row's label sat 3 px right of its siblings, since an empty
// tick column could shrink and one with a tick could not. Every row keeps the column whole.

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isDrawn = (child: unknown): child is Drawn => typeof child === "object" && child !== null && "props" in child;
function findDrawn(node: Drawn, id: string): Drawn | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isDrawn(child) ? findDrawn(child, id) : undefined)).find(Boolean);
}

test("every row of a menu with ticks keeps a tick column that never shrinks", async () => {
  const host = fakeHost();
  const items = [
    { label: "Paste", onPress: () => {} },
    { label: "View as Icons", onPress: () => {}, checked: true },
    { label: "View as List", onPress: () => {}, checked: false },
  ];
  const root = render(<MenuList testID="m" items={items} />, host.transport);
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  for (const item of items) {
    const row = findDrawn(tree, root.nodeId(`m:${item.label}`) ?? "");
    const lead = (row?.children ?? []).filter(isDrawn)[0];
    const tick = (lead?.children ?? []).filter(isDrawn)[0];
    expect(tick?.props.width).toBe(12);
    expect(tick?.props.shrink).toBe(false);
  }
  root.unmount();
});
