import { expect, test } from "bun:test";
import { FIRST_PANE, isPrivatePane, Nav, PANES } from "../src/settings-app/panes.ts";

test("Passwords is the private pane, and Appearance isn't", () => {
  expect(PANES.filter((pane) => pane.private).map((pane) => pane.id)).toEqual(["passwords"]);
  expect(isPrivatePane("passwords")).toBe(true);
  expect(isPrivatePane(FIRST_PANE)).toBe(false);
});

test("Settings reopens on the last pane", () => {
  const nav = new Nav();
  nav.select("sound");
  nav.reopen();
  expect(nav.getSnapshot()).toBe("sound");
});

test("Settings left on Passwords reopens on the last pane that isn't private", () => {
  const nav = new Nav();
  nav.select("keyboard");
  nav.select("passwords");
  nav.reopen();
  expect(nav.getSnapshot()).toBe("keyboard");
});

test("Settings that only showed Passwords reopens on Appearance", () => {
  const nav = new Nav();
  nav.select("passwords");
  nav.reopen();
  expect(nav.getSnapshot()).toBe("appearance");
});

test("reopening tells the window only when the pane changes", () => {
  const nav = new Nav();
  let told = 0;
  nav.subscribe(() => told++);
  nav.select("passwords");
  nav.reopen();
  nav.reopen();
  expect(told).toBe(2);
});
