import { expect, test } from "bun:test";
import type { NativeHostTransport, ToplevelEvent } from "@mirinjs/metal";
import { type BarName, barName, DESKTOP, HANDOVER_MS } from "../src/menubar/lib/bar-name.ts";
import { PORTAL_APP_ID, sheetTitle } from "../src/shared/portal-host/protocol.ts";
import { ToplevelStore } from "../src/toplevels.ts";

// The menu bar names the app in front; a portal dialog (an Access question)
// is no app's window, and used to leave it saying "Desktop".

const start: BarName = { name: DESKTOP };

test("a dialog over an app keeps that app's name, even with the handover between", () => {
  const settings = barName({ app: "System Settings" }, start, 0);
  expect(settings.name).toBe("System Settings");
  // The window lets go, then the dialog takes the keyboard.
  const between = barName({}, settings, 10);
  expect(between.name).toBe(DESKTOP);
  const asked = barName({ dialog: "Allow access?" }, between, 20);
  expect(asked.name).toBe("System Settings");
});

test("a dialog over the desktop is named by its title", () => {
  const settings = barName({ app: "System Settings" }, start, 0);
  const desktop = barName({}, settings, 10);
  // Long after the app let go, the desktop was in front.
  expect(barName({ dialog: "Allow access?" }, desktop, 10 + HANDOVER_MS + 1).name).toBe("Allow access?");
  expect(barName({ dialog: "Allow access?" }, start, 0).name).toBe("Allow access?");
  // A sheet's one-off first title is no name.
  expect(barName({ dialog: sheetTitle("p12ab") }, start, 0).name).toBe(DESKTOP);
});

test("the portal's windows are kept apart from the apps' windows", () => {
  const heard: Array<(event: ToplevelEvent) => void> = [];
  const listener = (event: ToplevelEvent): void => {
    for (const each of heard) each(event);
  };
  const transport = { onToplevel: (each: (event: ToplevelEvent) => void) => void heard.push(each) } as unknown as NativeHostTransport;
  const store = new ToplevelStore(transport);
  const base = { minimized: false, maximized: false, fullscreen: false };
  listener({ type: "changed", toplevel: { id: 1, title: "Settings", appId: "dev.dashi.settings", activated: false, ...base } });
  listener({ type: "changed", toplevel: { id: 2, title: "Allow access?", appId: PORTAL_APP_ID, activated: true, ...base } });
  expect(store.getSnapshot().map((window) => window.id)).toEqual([1]);
  expect(store.getDialogs().map((window) => window.title)).toEqual(["Allow access?"]);
  listener({ type: "closed", id: 2 });
  expect(store.getDialogs()).toEqual([]);
});
