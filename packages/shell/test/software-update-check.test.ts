import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledIds } from "../apps/kit/index.ts";
import { type SoftwareMenuContext, softwareMenus } from "../apps/software/menus.ts";
import type { NotifyInput } from "../src/notifications/types.ts";
import type { FlatpakUpdate } from "../src/software/flatpak-parse.ts";
import { DAY_MS, dueIn, FIRST_LOOK_MS, parseCheckState, RETRY_MS, UpdateCheck, updatesSummary } from "../src/software/update-check.ts";

test("the daily look's words: one line for what waits", () => {
  expect(updatesSummary(0, 0)).toBeNull();
  expect(updatesSummary(1, 0)).toBe("An app update is ready");
  expect(updatesSummary(3, 0)).toBe("3 app updates are ready");
  expect(updatesSummary(0, 40)).toBe("A system update is ready");
  expect(updatesSummary(12, 40)).toBe("12 app updates and a system update are ready");
});

test("when the next look is due; a clock set back counts as due; a bad state file is no state", () => {
  expect(dueIn(null, 1000)).toBe(0);
  expect(dueIn(1000, 1000 + DAY_MS + 5)).toBe(0);
  expect(dueIn(1000, 1000 + 3600)).toBe(DAY_MS - 3600);
  expect(dueIn(5000, 1000)).toBe(0);
  expect(parseCheckState("{bad")).toEqual({ checkedAt: null, told: null });
  expect(parseCheckState('{"checkedAt": 5, "told": "x"}')).toEqual({ checkedAt: 5, told: "x" });
});

const update = (id: string, version = "2"): FlatpakUpdate =>
  ({ id, name: id, version, branch: "stable", arch: "x86_64", origin: "flathub", installation: "user", downloadSize: null }) as FlatpakUpdate;

function rig(apps: FlatpakUpdate[], options: { canLook?: () => boolean; statePath?: string | null } = {}) {
  const posted: NotifyInput[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const listeners: Array<(event: { type: string; id: number; key?: string }) => void> = [];
  const opened: string[] = [];
  let now = 1_000_000;
  const check = new UpdateCheck({
    software: {
      hasFlatpak: true,
      hasPackageKit: true,
      flatpakUpdates: async () => apps,
      systemUpdates: async () => ({ updates: [{ name: "kernel" }] as never, restartCauses: [] }),
    },
    notifications: {
      notify: (input: NotifyInput) => posted.push(input),
      onEvent: (listener: never) => {
        listeners.push(listener);
        return () => {};
      },
    } as never,
    open: () => opened.push("updates"),
    statePath: options.statePath ?? null,
    now: () => now,
    setTimer: (run, ms) => {
      timers.push({ run, ms });
      return () => {};
    },
    ...(options.canLook ? { canLook: options.canLook } : {}),
  });
  return { check, posted, timers, listeners, opened, advance: (ms: number) => (now += ms) };
}

test("the daily look tells once what it found, opens Software on Show, and looks again a day later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-update-check-"));
  const path = join(dir, "software-check.json");
  const { check, posted, timers, listeners, opened, advance } = rig([update("org.videolan.VLC")], { statePath: path });
  check.start();
  expect(timers[0]?.ms).toBe(FIRST_LOOK_MS);
  await check.look();
  expect(posted.map((each) => each.summary)).toEqual(["An app update and a system update are ready"]);
  expect(posted[0]?.urgency).toBe("low");
  expect(timers.at(-1)?.ms).toBe(DAY_MS);
  expect(JSON.parse(readFileSync(path, "utf8")).checkedAt).toBe(1_000_000);
  // The same updates the next day: not told again.
  advance(DAY_MS);
  await check.look();
  expect(posted.length).toBe(1);
  // Show opens Software on Updates.
  for (const listener of listeners) listener({ type: "action", id: 1, key: "default" });
  expect(opened).toEqual(["updates"]);
  check.stop();
});

test("on battery or offline it waits an hour instead, and asks nothing", async () => {
  const { check, posted, timers } = rig([update("a.b.C")], { canLook: () => false });
  await check.look();
  expect(posted).toEqual([]);
  expect(timers.at(-1)?.ms).toBe(RETRY_MS);
});

const context = (over: Partial<SoftwareMenuContext> = {}): SoftwareMenuContext => ({
  place: "discover",
  canGoBack: false,
  thing: null,
  appletsReady: true,
  appUpdates: 0,
  systemUpdates: 0,
  checking: false,
  updatingApps: false,
  updatingSystem: false,
  blocked: false,
  actions: {
    search() {},
    back() {},
    show() {},
    checkForUpdates() {},
    updateAllApps() {},
    updateSystem() {},
    open() {},
    get() {},
    update() {},
    remove() {},
  },
  ...over,
});

test("the menus: Go with Back and the places (applets only with a catalog), Get… when a sheet comes first", () => {
  const { menus } = softwareMenus(context({ canGoBack: true, thing: { canOpen: false, canGet: true, canUpdate: false, canRemove: false, asks: true } }));
  const enabled = enabledIds(menus);
  expect(enabled.has("back")).toBe(true);
  expect(enabled.has("show:applets")).toBe(true);
  expect(enabled.has("item:get")).toBe(true);
  expect(enabled.has("item:remove")).toBe(false);
  const file = menus.find((menu) => menu.id === "file");
  expect(file?.items.some((item) => "label" in item && item.label === "Get…")).toBe(true);
  expect(enabledIds(softwareMenus(context({ appletsReady: false })).menus).has("show:applets")).toBe(false);
  expect(enabledIds(softwareMenus(context({ blocked: true, canGoBack: true })).menus).has("back")).toBe(false);
  let went = "";
  const { run } = softwareMenus(context({ actions: { ...context().actions, show: (place) => (went = place) } }));
  run("show:applets");
  expect(went).toBe("applets");
});
