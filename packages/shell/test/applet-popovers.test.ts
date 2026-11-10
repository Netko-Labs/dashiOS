import { expect, test } from "bun:test";
import { AppletPopovers, joinShellMenus } from "../src/applets/popovers.ts";
import { MenuController } from "../src/menus/controller.ts";
import type { MenuContext } from "../src/menus/types.ts";

function shell() {
  const surfaces = { opened: 0, closed: 0 };
  const controller = new MenuController({
    context: async (appName) => ({ appName }) as MenuContext,
    openSurface: () => {
      surfaces.opened++;
      return { close: () => void surfaces.closed++ };
    },
  });
  const popovers = new AppletPopovers();
  const stop = joinShellMenus(popovers, controller);
  return { controller, popovers, surfaces, stop };
}

test("a shell menu opening closes an applet's popover", async () => {
  const { controller, popovers } = shell();
  let dismissed = 0;
  popovers.opened(() => dismissed++);
  await controller.toggleControlCenter("Files");
  expect(dismissed).toBe(1);
  expect(popovers.isOpen()).toBe(false);
  // Turning Control Center's page (or closing it) dismisses nothing more.
  controller.setControlPage("wifi");
  controller.close();
  expect(dismissed).toBe(1);
});

test("an applet's popover opening closes the shell's open menu, and only an open one", async () => {
  const { controller, popovers, surfaces } = shell();
  popovers.opened(() => {});
  expect(surfaces.closed).toBe(0);
  await controller.toggleMenu("app", 40, "Files");
  expect(controller.getSnapshot().popover).not.toBeNull();
  popovers.opened(() => {});
  expect(controller.getSnapshot().popover).toBeNull();
  expect(surfaces.closed).toBe(1);
});

test("joined no more once stopped", async () => {
  const { controller, popovers, stop } = shell();
  stop();
  let dismissed = 0;
  popovers.opened(() => dismissed++);
  await controller.toggleNotificationCenter("Files");
  expect(dismissed).toBe(0);
  popovers.opened(() => {});
  expect(controller.getSnapshot().popover).not.toBeNull();
});
