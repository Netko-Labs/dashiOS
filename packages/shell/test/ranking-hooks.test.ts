/** What the Dock and the switcher open counts for the launcher's ranking (frecency from everywhere). */

import { expect, test } from "bun:test";
import type { Toplevel } from "@mirinjs/metal";
import type { CompositorWindow } from "../src/compositor/wire.ts";
import { DockController } from "../src/dock/controller.ts";
import type { DockEntry } from "../src/dock/layout.ts";
import { SwitcherController } from "../src/switcher/controller.ts";
import { settle } from "./support/time.ts";

function dock(opened: string[], launched: boolean) {
  const acted: Array<[number, string]> = [];
  const controller = new DockController({
    catalog: [],
    pins: { pin: () => {}, unpin: () => {} },
    toplevels: { act: (id: number, action: string) => void acted.push([id, action]), getSnapshot: () => [], subscribe: () => () => {} },
    compositor: null,
    launch: () => (launched ? 4242 : null),
    opened: (appId: string) => opened.push(appId),
    graceMs: 1,
  } as unknown as ConstructorParameters<typeof DockController>[0]);
  return { controller, acted };
}

const entry = (windows: Partial<Toplevel>[]): DockEntry =>
  ({ key: "dev.dashi.files", pinned: true, app: { id: "dev.dashi.files", name: "Files", icon: "", exec: ["files"] }, windows }) as unknown as DockEntry;

test("a Dock click that starts an app or brings its window forward counts; a failed start doesn't", () => {
  const opened: string[] = [];
  const { controller, acted } = dock(opened, true);
  controller.press(entry([]));
  controller.press(entry([{ id: 7, activated: false, minimized: false }]));
  expect(acted).toEqual([[7, "activate"]]);
  expect(opened).toEqual(["dev.dashi.files", "dev.dashi.files"]);
  controller.close();
  const failed: string[] = [];
  dock(failed, false).controller.press(entry([]));
  expect(failed).toEqual([]);
});

test("letting go of ❖Tab on a window counts its app; Esc doesn't", async () => {
  const windows: CompositorWindow[] = [
    { id: 1, appId: "dev.dashi.notes", title: "Groceries", pid: null, focused: true, state: "normal", frame: null, titleBar: 0 },
    { id: 2, appId: "dev.dashi.terminal", title: "~/dashi", pid: null, focused: false, state: "normal", frame: null, titleBar: 0 },
  ];
  const compositor = { windows: async () => windows, request: async () => ({}) };
  const opened: string[] = [];
  const controller = new SwitcherController(compositor as never, { show: () => {}, hide: () => {} }, undefined, undefined, (window) =>
    opened.push(window.appId),
  );
  controller.step("next");
  controller.cancel();
  await settle();
  expect(opened).toEqual([]);
  controller.step("next");
  controller.commit();
  await settle();
  await settle();
  expect(opened).toEqual(["dev.dashi.terminal"]);
});
