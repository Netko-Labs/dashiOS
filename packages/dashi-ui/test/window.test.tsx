import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { Notice } from "../src/notice.tsx";
import { TOOLTIP_DELAY_MS, tooltipOrigin } from "../src/tooltip.tsx";
import { AppWindow, ToolbarButton } from "../src/window.tsx";
import { fakeHost, settle } from "./host.ts";

const unified = { type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 22 } } as const;

test("a tip is centered under its button and kept inside the window", () => {
  const button = { x: 100, y: 5, width: 32, height: 28 };
  expect(tooltipOrigin(button, { width: 60, height: 22 }, 800)).toEqual({ x: 86, y: 39 });
  // Near the left edge it starts 6 px in; near the right it ends 6 px in.
  expect(tooltipOrigin({ ...button, x: 0 }, { width: 80, height: 22 }, 800).x).toBe(6);
  expect(tooltipOrigin({ ...button, x: 780 }, { width: 80, height: 22 }, 800).x).toBe(714);
  // Before the window's width is known, only the left edge holds it.
  expect(tooltipOrigin({ ...button, x: 780 }, { width: 80, height: 22 }, 0).x).toBe(756);
});

test("the window has one title line and a notice that floats over the content", async () => {
  const host = fakeHost();
  const root = render(
    <AppWindow title="Notes" notice={<Notice testID="saved" text="Couldn't save “Groceries”." tone="error" />}>
      {null}
    </AppWindow>,
    host.transport,
  );
  host.emit(unified);
  await settle();
  expect(host.last()).toContain("Notes");
  expect(root.nodeId("saved")).toBeDefined();
  // The notice is laid over the content (absolutely placed), not stacked under it.
  const id = root.nodeId("window-notice");
  expect(host.last()).toContain(`{"id":"${id}","absolute":true`);
  root.unmount();
});

test("a glyph button shows its name after the pointer rests on it, and hides it on leaving", async () => {
  const host = fakeHost();
  const root = render(
    <AppWindow title="Notes" toolbar={<ToolbarButton testID="new" glyph="<svg/>" tooltip="New note" onPress={() => {}} />}>
      {null}
    </AppWindow>,
    host.transport,
  );
  host.emit(unified);
  await settle();
  const button = root.nodeId("new") as string;
  // The name is the button's accessible name from the start; the tooltip's words come after a rest.
  const tip = '["New note"]';
  expect(host.last()).toContain('"label":"New note"');
  expect(host.last()).not.toContain(tip);
  host.emit({ type: "hover", nodeId: button, hovered: true, bounds: { x: 300, y: 5, width: 32, height: 28 } });
  await settle(TOOLTIP_DELAY_MS / 2);
  expect(host.last()).not.toContain(tip);
  await settle(TOOLTIP_DELAY_MS);
  expect(host.last()).toContain(tip);
  host.emit({ type: "hover", nodeId: button, hovered: false });
  await settle();
  expect(host.last()).not.toContain(tip);
  root.unmount();
});

/** The props the host was sent for the node with this id. */
function propsOf(tree: string, id: string | undefined): Record<string, unknown> | null {
  const walk = (node: { props?: Record<string, unknown>; children?: unknown[] }): Record<string, unknown> | null => {
    if (node.props?.id === id) return node.props;
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
