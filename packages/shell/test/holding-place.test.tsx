import { expect, test } from "bun:test";
import type { NativeHostOptions } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { Output } from "../src/layout.ts";
import { Dialogs } from "../src/menus/dialogs.tsx";
import { HOLDING_SURFACE, holdingPlace, SHEET_REACH } from "../src/menus/holding-place.ts";
import type { OpenOverlay } from "../src/overlay.tsx";

// A 1646×936 screen (the VM's), its menu bar 28 tall and a Dock that keeps 74 at the foot.
const SCREEN: Output = {
  name: "Virtual-1",
  frame: { x: 0, y: 0, width: 1646, height: 936 },
  usable: { x: 0, y: 28, width: 1646, height: 834 },
  scale: 1,
};
const SECOND: Output = { ...SCREEN, name: "HDMI-A-1", frame: { ...SCREEN.frame, x: 1646 }, usable: { ...SCREEN.usable, x: 1646 } };

/** Whether a notice at `edge` overlaps the band an app's sheet may take under a window's top. */
function overlapsSheet(edge: "top" | "bottom", windowTop: number): boolean {
  const notice =
    edge === "bottom"
      ? { top: SCREEN.usable.y + SCREEN.usable.height - HOLDING_SURFACE.height, bottom: SCREEN.usable.y + SCREEN.usable.height }
      : { top: SCREEN.usable.y, bottom: SCREEN.usable.y + HOLDING_SURFACE.height };
  return notice.top < windowTop + SHEET_REACH && windowTop < notice.bottom;
}

test("the notice goes to the foot of the window's screen, below its sheet", () => {
  // The Text Editor of the review (e3): its sheet sat right under the old notice at the top.
  const editor = { x: 499, y: 187, width: 760, height: 600 };
  expect(holdingPlace(editor, [SCREEN, SECOND])).toEqual({ edge: "bottom", output: "Virtual-1" });
  expect(holdingPlace({ ...editor, x: 1646 + 499 }, [SCREEN, SECOND])).toEqual({ edge: "bottom", output: "HDMI-A-1" });
  // A window filling the screen still asks from its top.
  expect(holdingPlace(SCREEN.usable, [SCREEN]).edge).toBe("bottom");
});

test("a window dragged low enough that its sheet would reach the foot gets the notice under the menu bar", () => {
  expect(holdingPlace({ x: 400, y: 640, width: 700, height: 400 }, [SCREEN]).edge).toBe("top");
});

test("wherever the window is, the notice never covers its sheet", () => {
  for (let top = SCREEN.usable.y; top < SCREEN.frame.height; top += 7) {
    const { edge } = holdingPlace({ x: 300, y: top, width: 800, height: 500 }, [SCREEN]);
    expect({ top, overlaps: overlapsSheet(edge, top) }).toEqual({ top, overlaps: false });
  }
});

test("with nothing known of the window, the notice goes to the foot", () => {
  expect(holdingPlace(null, [SCREEN])).toEqual({ edge: "bottom" });
  expect(holdingPlace({ x: 0, y: 100, width: 10, height: 10 }, [])).toEqual({ edge: "bottom" });
});

test("log out's notice opens at the place the shell found, on the window's screen", async () => {
  const opened: NativeHostOptions[] = [];
  const open: OpenOverlay = (options: NativeHostOptions, _element: ReactElement) => {
    opened.push(options);
    return { close() {} };
  };
  let windows = [{ id: 7, name: "Text Editor" }];
  const dialogs = new Dialogs(open, () => {}, {
    windows: async () => windows,
    close: async () => {},
    focus: () => {},
    place: async () => ({ edge: "bottom", output: "Virtual-1" }),
  });
  dialogs.confirm("logout");
  // Log Out on the confirm sheet: its own surface first.
  const confirm = opened.length;
  (dialogs as unknown as { end(what: string): Promise<void> }).end("logout");
  await new Promise((done) => setTimeout(done, 1300));
  const notice = opened.slice(confirm).find((options) => options.title === "Waiting");
  expect(notice?.surface).toMatchObject({ anchor: ["bottom"], output: "Virtual-1", keyboard: "on-demand" });
  expect(notice?.height).toBe(HOLDING_SURFACE.height);
  windows = [];
});
