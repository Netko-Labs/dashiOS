import { expect, test } from "bun:test";
import { type StoreMenuContext, storeMenus } from "../apps/applet-store/menus.ts";
import { enabledIds } from "../apps/kit/index.ts";

function context(patch: Partial<StoreMenuContext> = {}): { context: StoreMenuContext; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    context: {
      place: "installed",
      applet: null,
      catalogReady: true,
      loading: false,
      blocked: false,
      actions: {
        search: () => calls.push("search"),
        show: (place) => calls.push(`show:${place}`),
        checkForUpdates: () => calls.push("check"),
        get: () => calls.push("get"),
        remove: () => calls.push("remove"),
      },
      ...patch,
    },
  };
}

test("the store's menus: search, the three places with their keys, and Check for Updates", () => {
  const { context: ctx, calls } = context();
  const { menus, run } = storeMenus(ctx);
  expect(menus.map((menu) => menu.id)).toEqual(["file", "view", "store"]);
  const enabled = enabledIds(menus);
  for (const id of ["search", "show:discover", "show:installed", "show:updates", "check"]) expect(enabled.has(id)).toBe(true);
  expect(enabled.has("applet:get")).toBe(false);
  run("show:updates");
  run("check");
  run("applet:get");
  expect(calls).toEqual(["show:updates", "check"]);
});

test("without a catalog only Installed and search are offered", () => {
  const { context: ctx, calls } = context({ catalogReady: false });
  const { menus, run } = storeMenus(ctx);
  expect([...enabledIds(menus)].sort()).toEqual(["search", "show:installed"]);
  run("show:discover");
  run("check");
  expect(calls).toEqual([]);
});

test("an applet's page: Update and Remove when it has them, and nothing while a sheet is up", () => {
  const page = { canGet: false, canUpdate: true, canRemove: true };
  const { context: ctx, calls } = context({ place: null, applet: page });
  const { menus, run } = storeMenus(ctx);
  const enabled = enabledIds(menus);
  expect(enabled.has("applet:get")).toBe(false);
  expect(enabled.has("applet:update")).toBe(true);
  run("applet:update");
  run("applet:remove");
  expect(calls).toEqual(["get", "remove"]);
  expect(enabledIds(storeMenus(context({ place: null, applet: page, blocked: true }).context).menus).size).toBe(0);
});
