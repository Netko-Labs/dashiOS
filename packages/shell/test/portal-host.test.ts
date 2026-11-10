import { expect, test } from "bun:test";
import type { Placing } from "../src/compositor/events.ts";
import { isSheetTitle, PORTAL_APP_ID, parseParentWindow, sheetTitle } from "../src/portal-host/index.ts";
import { newLauncher } from "../src/portal-host/launchers.ts";
import { PortalSheets, SHEET_TOPS, sheetTop } from "../src/portal-host/sheets.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { flush } from "./support/time.ts";

test("parent windows: wayland and x11 handles, nothing else", () => {
  expect(parseParentWindow("wayland:AbC123_-x")).toBe("wayland:AbC123_-x");
  expect(parseParentWindow("x11:3e00004")).toBe("x11:3e00004");
  expect(parseParentWindow("x11:0x3e00004")).toBe("x11:0x3e00004");
  expect(parseParentWindow("")).toBeNull();
  expect(parseParentWindow("wayland:")).toBeNull();
  expect(parseParentWindow("x11:zz")).toBeNull();
  expect(parseParentWindow("wayland:a b")).toBeNull();
  expect(isSheetTitle(sheetTitle("r12"))).toBe(true);
  expect(isSheetTitle("Open")).toBe(false);
});

const placing = (id: number, title: string, appId = PORTAL_APP_ID): Placing => ({ id, appId, title, width: 600, height: 400 });

test("an expected portal window becomes a sheet of the window its handle names", async () => {
  const sent: Array<[string, unknown]> = [];
  const placed: number[] = [];
  const sheets = new PortalSheets(
    fakeCompositor(async (method, params) => {
      sent.push([method, params]);
      if (method === "window-for-handle") return { window: params?.handle === "wayland:known" ? 3 : null };
      return {};
    }),
    async (window) => void placed.push(window.id),
  );
  expect(sheets.expect(sheetTitle("a"), "wayland:known")).toBe(true);
  expect(sheets.expect(sheetTitle("b"), "wayland:gone")).toBe(true);
  expect(sheets.expect(sheetTitle("c"), "not a handle")).toBe(false);
  // Other apps' windows, and portal windows nobody expected, are the Arranger's.
  expect(sheets.claim(placing(9, sheetTitle("a"), "org.other"))).toBe(false);
  expect(sheets.claim(placing(9, sheetTitle("zzz")))).toBe(false);
  expect(sheets.claim(placing(10, sheetTitle("a")))).toBe(true);
  expect(sheets.claim(placing(11, sheetTitle("b")))).toBe(true);
  // Claimed once only.
  expect(sheets.claim(placing(12, sheetTitle("a")))).toBe(false);
  await flush();
  expect(sent).toContainEqual(["attach", { window: 10, parent: 3 }]);
  expect(placed).toEqual([11]);
});

test("a sheet hangs below an app's own title bar and toolbar, guessed by the kind of app", async () => {
  expect(sheetTop({ appId: "org.gnome.TextEditor", titleBar: 28 })).toBeUndefined();
  expect(sheetTop({ appId: "net.imput.helium", titleBar: 0 })).toBe(SHEET_TOPS.browser);
  expect(sheetTop({ appId: "org.mozilla.firefox", titleBar: 0 })).toBe(SHEET_TOPS.browser);
  expect(sheetTop({ appId: "dev.dashi.files", titleBar: 0 })).toBe(SHEET_TOPS.dashi);
  expect(sheetTop({ appId: "org.gnome.Nautilus", titleBar: 0 })).toBe(SHEET_TOPS.other);

  const sent: Array<[string, unknown]> = [];
  const helium = { id: 3, appId: "net.imput.helium", title: "Helium", pid: 1, focused: true, state: "normal", frame: null, titleBar: 0 };
  const sheets = new PortalSheets(
    fakeCompositor(async (method, params) => {
      sent.push([method, params]);
      if (method === "window-for-handle") return { window: 3 };
      if (method === "windows") return { windows: [helium] };
      return {};
    }),
    async () => {},
  );
  sheets.expect(sheetTitle("a"), "wayland:helium");
  expect(sheets.claim(placing(10, sheetTitle("a")))).toBe(true);
  await flush();
  expect(sent).toContainEqual(["attach", { window: 10, parent: 3, top: SHEET_TOPS.browser }]);
});

test("expectations are forgotten after a while", () => {
  let now = 0;
  const sheets = new PortalSheets(
    fakeCompositor(async () => ({})),
    async () => {},
    () => now,
  );
  sheets.expect(sheetTitle("a"), "wayland:x");
  now = 60_000;
  expect(sheets.claim(placing(1, sheetTitle("a")))).toBe(false);
});

test("Add to Dock: the launcher the portal writes for the app, new since asking", () => {
  const before = new Set(["org.mozilla.firefox.desktop", "net.imput.helium.old.desktop"]);
  const files = [...before, "net.imput.helium.ynab.desktop", "other.desktop"];
  expect(newLauncher(files, before, "net.imput.helium")).toBe("net.imput.helium.ynab");
  expect(newLauncher(files, before, "com.example")).toBeNull();
  expect(newLauncher(["x.desktop"], new Set(), "")).toBe("x");
});
