import { expect, test } from "bun:test";
import { createElement } from "react";
import type { ShellLink } from "../apps/portal/shell.ts";
import { dialogWindows } from "../apps/portal/windows.ts";

test("an app that gives up while the shell is asked about the sheet gets no dialog", async () => {
  const controller = new AbortController();
  const shell: ShellLink = {
    inhibit: async () => 0,
    uninhibit: async () => {},
    expectSheet: async () => {
      controller.abort();
      return true;
    },
    addToDock: async () => {},
  };
  // No Metal host at this path: opening a window would throw, so getting `closed` back means none was opened.
  const show = dialogWindows(shell, "/nonexistent/mirin-metal-host");
  const window = { parent: "wayland:abc", title: "Open", width: 400, height: 300 };
  expect(await show(window, () => createElement("view"), controller.signal, "closed")).toBe("closed");
});
