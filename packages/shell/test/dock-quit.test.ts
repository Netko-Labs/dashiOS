/**
 * The Dock's Quit asks as ❖Q does: each app hears it quits before its window
 * is asked to close. The Dock knows windows by mirin's foreign-toplevel ids
 * (protocol object ids from 0xff000000), the compositor by its own small
 * numbers, so the two are kept apart here as they are in a session.
 */

import { expect, test } from "bun:test";
import type { Toplevel } from "@mirinjs/metal";
import type { CompositorWindow } from "../src/compositor.ts";
import { DockController } from "../src/dock/controller.ts";
import { dockLayout } from "../src/dock/layout.ts";
import { buildDockMenu } from "../src/dock/menu.ts";
import type { Entry } from "../src/entries.ts";

const TERMINAL = { id: "dev.dashi.terminal", name: "Terminal", exec: "dashi-terminal" } as unknown as Entry;

const toplevel = (id: number, appId: string, title: string): Toplevel => ({
  id,
  appId,
  title,
  activated: false,
  minimized: false,
  maximized: false,
  fullscreen: false,
});

const compositorWindow = (id: number, appId: string, pid: number | null): CompositorWindow => ({
  id,
  appId,
  title: "",
  pid,
  focused: false,
  state: "normal",
  frame: null,
  titleBar: 0,
});

function setup(listed: CompositorWindow[] | null) {
  const heard: string[] = [];
  const controller = new DockController({
    catalog: [TERMINAL],
    pins: { pin: () => {}, unpin: () => {} },
    toplevels: { act: (id: number, action: string) => void heard.push(`toplevel ${action} ${id}`), getSnapshot: () => [], subscribe: () => () => {} },
    compositor:
      listed === null
        ? null
        : {
            windows: async () => listed,
            request: async (method: string, params: { window: number }) => void heard.push(`${method} ${params.window}`),
          },
    launch: () => null,
    appQuitting: (pid: number | null) => void heard.push(`quitting ${pid}`),
  } as unknown as ConstructorParameters<typeof DockController>[0]);
  return { heard, controller };
}

/** The Quit row's action, as the Dock's menu builds it from the toplevels it was told of. */
function quitAction(toplevels: Toplevel[]) {
  const [entry] = dockLayout([], [TERMINAL], toplevels).running;
  if (!entry) throw new Error("Terminal is not in the Dock");
  const quit = buildDockMenu(entry).find((row) => row.kind === "item" && row.label === "Quit");
  if (quit?.kind !== "item" || !quit.action) throw new Error("no Quit row");
  return quit.action;
}

test("Quit tells each window's app it quits, then asks the compositor's window to close", async () => {
  const { heard, controller } = setup([
    compositorWindow(4, "dev.dashi.terminal", 401),
    compositorWindow(5, "dev.dashi.text-editor", 450),
    compositorWindow(7, "dev.dashi.terminal", 702),
  ]);
  await controller.run(quitAction([toplevel(0xff000003, "dev.dashi.terminal", "~"), toplevel(0xff000009, "dev.dashi.terminal", "~/dashi")]));
  expect(heard).toEqual(["quitting 401", "close 4", "quitting 702", "close 7"]);
  controller.close();
});

test("Without dashi-comp, Quit asks the toplevels themselves", async () => {
  const { heard, controller } = setup(null);
  await controller.run(quitAction([toplevel(0xff000003, "dev.dashi.terminal", "~")]));
  expect(heard).toEqual(["quitting null", `toplevel close ${0xff000003}`]);
  controller.close();
});
