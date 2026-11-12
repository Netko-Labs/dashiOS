import { expect, test } from "bun:test";
import { AppletPopovers, joinShellMenus } from "../src/applets/popovers.ts";
import { POPOVER_DISMISS, POPOVER_RULES } from "../src/keymap/keymap.ts";
import { resolveChord } from "../src/keymap/keymap-match.ts";
import { currentKeymap, setOpenRules } from "../src/keymap/keymap-state.ts";
import { withLauncher } from "../src/launcher/keys.ts";
import { MenuController } from "../src/menus/controller.ts";
import type { MenuContext } from "../src/menus/types.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";

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

test("Esc closes an applet's popover from the focused app: while one is open the key is the shell's", async () => {
  // The popover is the applet's own surface; one built with an SDK from before 0.5 never takes
  // the keyboard, so Esc typed in the focused app went to the app and the popover stayed.
  const popovers = new AppletPopovers();
  const heard: boolean[] = [];
  const stop = popovers.onOpenChange((open) => {
    heard.push(open);
    setOpenRules(open ? POPOVER_RULES : []);
  });
  const esc = { mods: [], key: "Escape" } as const;
  expect(resolveChord(esc, "dev.dashi.notes", currentKeymap())).not.toEqual({ kind: "bind", name: POPOVER_DISMISS });

  let dismissed = 0;
  popovers.opened(() => dismissed++);
  expect(heard).toEqual([true]);
  expect(resolveChord(esc, "dev.dashi.notes", currentKeymap())).toEqual({ kind: "bind", name: POPOVER_DISMISS });
  // The launcher's keys build on the same keymap: the rule is still there under them.
  expect(withLauncher(currentKeymap()).rules).toEqual(expect.arrayContaining(POPOVER_RULES));

  // The compositor's `binding` event runs it.
  const actions = { hardware: { run: async () => false }, dismissPopover: () => popovers.dismiss() } as unknown as ShellActions;
  await runBinding(POPOVER_DISMISS, 7, {} as Requests, actions);
  expect(dismissed).toBe(1);
  expect(heard).toEqual([true, false]);
  expect(popovers.isOpen()).toBe(false);
  expect(resolveChord(esc, "dev.dashi.notes", currentKeymap())).not.toEqual({ kind: "bind", name: POPOVER_DISMISS });
  // Esc again, late: nothing to close, and nobody is told twice.
  await runBinding(POPOVER_DISMISS, 7, {} as Requests, actions);
  expect(heard).toEqual([true, false]);
  stop();
});

test("one applet's popover replacing another's keeps the key; the last one closing by itself gives it back", () => {
  const popovers = new AppletPopovers();
  const heard: boolean[] = [];
  popovers.onOpenChange((open) => heard.push(open));
  const first = popovers.opened(() => {});
  const second = popovers.opened(() => {});
  // The first was dismissed by the second; its own late "I closed" changes nothing.
  first();
  expect(heard).toEqual([true]);
  second();
  expect(heard).toEqual([true, false]);
});
