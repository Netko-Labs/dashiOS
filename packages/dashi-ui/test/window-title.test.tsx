import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { AppWindow, ToolbarButton } from "../src/window.tsx";
import { fakeHost, settle } from "./host.ts";

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
  // The detail grows into what the title leaves and never shrinks below its place: the row wraps it
  // out of sight instead (a second line, clipped), so it is whole, cut to a useful length, or gone.
  expect(propsOf(host.last(), root.nodeId("window-title-detail"))).toMatchObject({ grow: 1, shrink: false, height: 18 });
  expect(propsOf(host.last(), root.nodeId("window-title-detail-room"))).toMatchObject({ maxWidth: 120, height: 0, clip: true });
  const row = JSON.stringify(propsOf(host.last(), root.nodeId("window-title")));
  expect(row).not.toContain('"wrap"');
  expect(host.last()).toMatch(/"height":18,[^{}]*"wrap":true|"wrap":true,[^{}]*"height":18/);
  // Both are one line, cut with an ellipsis.
  expect(host.last().match(/"truncate":true/g)?.length).toBeGreaterThanOrEqual(2);
  root.unmount();
});
