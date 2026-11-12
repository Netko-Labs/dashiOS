import { expect, test } from "bun:test";
import { dockDefaults, resolvePinned } from "../src/shared/apps/index.ts";

test("a new Dock leaves out the Components gallery, and keeps the rest in order", () => {
  expect(dockDefaults([{ id: "dev.dashi.files" }, { id: "dev.dashi.components" }, { id: "dev.dashi.terminal" }])).toEqual([
    "dev.dashi.files",
    "dev.dashi.terminal",
  ]);
});

test("only Components is left out of Dashi's own list", () => {
  // Every program "installed": the first installed choice of each app (scripts must exist on disk too).
  const apps = resolvePinned(() => "/usr/bin/true");
  expect(dockDefaults(apps)).toEqual(apps.map((app) => app.id).filter((id) => id !== "dev.dashi.components"));
});
