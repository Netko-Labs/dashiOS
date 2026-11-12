import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { AppWindow, ToolbarButton } from "../src/window.tsx";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

const unified = { type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 22 } } as const;

/** The props the host was sent for the node with this id. */
function propsOf(tree: string, id: string | undefined): Record<string, unknown> | null {
  const walk = (node: { props?: Record<string, unknown>; children?: unknown[] }): Record<string, unknown> | null => {
    if (node.props?.id === id) return node.props ?? null;
    for (const child of node.children ?? []) {
      if (child && typeof child === "object") {
        const found = walk(child as { props?: Record<string, unknown>; children?: unknown[] });
        if (found) return found;
      }
    }
    return null;
  };
  return walk(JSON.parse(tree));
}

test("the title gives way before the toolbar: the detail takes only what is left, the title keeps a little", async () => {
  // Review 54 (Text Editor): a long name or a long detail pushed every control off the window.
  const host = fakeHost();
  const root = render(
    <AppWindow
      title="Quarterly planning notes for the design review with Alex Kim.txt"
      detail="~/Documents/Projects/Client work/Alex Kim"
      toolbar={<ToolbarButton testID="new" glyph="<svg/>" tooltip="New" onPress={() => {}} />}
    >
      {null}
    </AppWindow>,
    host.transport,
  );
  host.emit(unified);
  await settle();
  // The title's row takes the room the controls leave, never less than a little, and never their room.
  expect(propsOf(host.last(), root.nodeId("window-title"))).toMatchObject({ flex: 1, minWidth: 96 });
  // The detail grows from nothing (it has only what the title leaves), so it is cut first.
  expect(propsOf(host.last(), root.nodeId("window-title-detail"))).toMatchObject({ flex: 1 });
  // Both are one line, cut with an ellipsis.
  expect(host.last().match(/"truncate":true/g)?.length).toBeGreaterThanOrEqual(2);
  root.unmount();
});
