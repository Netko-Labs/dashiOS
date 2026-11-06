import { expect, test } from "bun:test";
import { type ActionDeps, runMenuAction } from "../src/menus/actions.ts";
import { buildMenu, type MenuContext } from "../src/menus/model.ts";

// Finding 12: nothing taught the launcher. The Dashi menu now lists it with its key.

const ctx: MenuContext = { appName: "Desktop", windows: [], focused: null, canLaunch: false, canOpenHelp: false };

test("the Dashi menu has Search… with ❖Space, just above System Settings…", () => {
  const rows = buildMenu("dashi", ctx).flatMap((entry) => (entry.kind === "item" ? [entry] : []));
  const at = rows.findIndex((row) => row.label === "Search…");
  expect(rows[at]).toMatchObject({ keys: "❖Space", action: { kind: "search" } });
  expect(rows[at + 1]?.label).toBe("System Settings…");
});

test("choosing Search… opens the launcher", async () => {
  let opened = 0;
  const deps = { compositor: null, arranger: null, openSearch: () => (opened += 1) } as unknown as ActionDeps;
  await runMenuAction({ kind: "search" }, deps);
  expect(opened).toBe(1);
});
