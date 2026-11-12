import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledIds } from "../apps/kit/index.ts";
import { type SoftwareMenuContext, softwareMenus } from "../apps/software/lib/menus.ts";
import type { NotifyInput } from "../src/notifications/types.ts";
import type { FlatpakUpdate } from "../src/shared/software/types.ts";
import { DAY_MS, dueIn, FIRST_LOOK_MS, parseCheckState, RETRY_MS, toldParts, UpdateCheck, updatesNotice, updatesWords } from "../src/software/update-check.ts";

test("the daily look's words: a short title, the counts in the body, and a Show button", () => {
  expect(updatesWords(0, 0)).toBeNull();
  expect(updatesNotice(0, 0)).toBeNull();
  expect(updatesWords(1, 0)).toBe("An app update");
  expect(updatesWords(3, 0)).toBe("3 app updates");
  expect(updatesWords(0, 40)).toBe("A system update");
  expect(updatesWords(12, 40)).toBe("12 app updates and a system update");
  expect(updatesNotice(1, 0)).toMatchObject({ summary: "An update is ready", body: "An app update waits in Software. Nothing installs on its own." });
  const notice = updatesNotice(2, 4);
  expect(notice).toMatchObject({ summary: "Updates are ready", body: "2 app updates and a system update wait in Software. Nothing installs on its own." });
  expect(notice?.actions.map((action) => action.key)).toEqual(["default", "show"]);
});

test("when the next look is due; a clock set back counts as due; a bad state file is no state", () => {
  expect(dueIn(null, 1000)).toBe(0);
  expect(dueIn(1000, 1000 + DAY_MS + 5)).toBe(0);
  expect(dueIn(1000, 1000 + 3600)).toBe(DAY_MS - 3600);
  expect(dueIn(5000, 1000)).toBe(0);
  expect(parseCheckState("{bad")).toEqual({ checkedAt: null, told: null });
  expect(parseCheckState('{"checkedAt": 5, "told": "x"}')).toEqual({ checkedAt: 5, told: "x" });
  // One field of the wrong shape loses only itself; a file that is no object is no state.
  expect(parseCheckState('{"checkedAt": "soon", "told": "x"}')).toEqual({ checkedAt: null, told: "x" });
  expect(parseCheckState("[1]")).toEqual({ checkedAt: null, told: null });
});

const update = (id: string, version = "2"): FlatpakUpdate =>
  ({ id, name: id, version, branch: "stable", arch: "x86_64", origin: "flathub", installation: "user", downloadSize: null }) as FlatpakUpdate;

function rig(apps: FlatpakUpdate[], options: { canLook?: () => boolean; statePath?: string | null; flatpak?: () => Promise<FlatpakUpdate[]> } = {}) {
  const posted: NotifyInput[] = [];
  const senders: string[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const listeners: Array<(event: { type: string; id: number; key?: string }) => void> = [];
  const opened: string[] = [];
  let now = 1_000_000;
  const check = new UpdateCheck({
    software: {
      hasFlatpak: true,
      hasPackageKit: true,
      flatpakUpdates: options.flatpak ?? (async () => apps),
      systemUpdates: async () => ({ updates: [{ name: "kernel" }] as never, restartCauses: [] }),
    },
    notifications: {
      notify: (input: NotifyInput, _replaces: number, sender: string) => {
        senders.push(sender);
        return posted.push(input);
      },
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
  return { check, posted, senders, timers, listeners, opened, advance: (ms: number) => (now += ms) };
}

test("the daily look tells once what it found, opens Software on Show, and looks again a day later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-update-check-"));
  const path = join(dir, "software-check.json");
  const { check, posted, timers, listeners, opened, advance } = rig([update("org.videolan.VLC")], { statePath: path });
  check.start();
  expect(timers[0]?.ms).toBe(FIRST_LOOK_MS);
  await check.look();
  expect(posted.map((each) => each.summary)).toEqual(["Updates are ready"]);
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

test("a look where flatpak fails is not written down as no app updates: the same ones aren't told again", async () => {
  let failing = false;
  const flatpak = async (): Promise<FlatpakUpdate[]> => {
    if (failing) throw new Error("flatpak: no network");
    return [update("org.videolan.VLC")];
  };
  const { check, posted, timers, advance } = rig([], { flatpak });
  await check.look();
  expect(posted.length).toBe(1);
  expect(timers.at(-1)?.ms).toBe(DAY_MS);
  // The next day flatpak fails and PackageKit answers: nothing new to tell, and the failed half is asked again soon.
  failing = true;
  advance(DAY_MS);
  await check.look();
  expect(posted.length).toBe(1);
  expect(timers.at(-1)?.ms).toBe(RETRY_MS);
  // It answers again with the same app update: still told once.
  failing = false;
  advance(RETRY_MS);
  await check.look();
  expect(posted.length).toBe(1);
  expect(timers.at(-1)?.ms).toBe(DAY_MS);
  expect(toldParts('{"apps":["a@1"],"system":2}')).toEqual({ apps: ["a@1"], system: 2 });
  expect(toldParts("nonsense")).toEqual({ apps: [], system: 0 });
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
