import { expect, test } from "bun:test";
import { desktopChordRefusal } from "../src/agents/desktop/input.ts";
import { resolveChord } from "../src/keymap-match.ts";

test("an agent's ❖Q is the desktop's Quit: the refusal names the menu's Quit instead", () => {
  // ❖Q never reaches an app as keys (Calculator's included): the shell's keymap takes it.
  expect(resolveChord({ mods: ["super"], key: "q" }, "dev.dashi.calculator")).toEqual({ kind: "bind", name: "quit-app" });
  expect(desktopChordRefusal("❖Q", "quit-app")).toBe(
    "❖Q is the desktop's own shortcut, not the window's; to quit the app, choose_menu_item its app menu's Quit (list_menus names it), or close_window.",
  );
  expect(desktopChordRefusal("❖Space", "launcher")).toContain("use the window tools");
});
