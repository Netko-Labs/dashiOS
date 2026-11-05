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
  expect(host.last()).not.toContain("New note");
  host.emit({ type: "hover", nodeId: button, hovered: true, bounds: { x: 300, y: 5, width: 32, height: 28 } });
  await settle(TOOLTIP_DELAY_MS / 2);
  expect(host.last()).not.toContain("New note");
  await settle(TOOLTIP_DELAY_MS);
  expect(host.last()).toContain("New note");
  host.emit({ type: "hover", nodeId: button, hovered: false });
  await settle();
  expect(host.last()).not.toContain("New note");
  root.unmount();
});
