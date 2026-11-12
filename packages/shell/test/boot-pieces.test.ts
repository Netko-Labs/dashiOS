import { expect, test } from "bun:test";
import type { AppMenus } from "../src/app-menus/start.ts";
import { appQuitting, appShortcut } from "../src/boot/apps.ts";
import { machineEndNotice } from "../src/boot/bars.tsx";
import { startArranging, startDesktops, startOverview } from "../src/boot/desktop.ts";
import { mayLookForUpdates } from "../src/boot/notices.ts";
import { Screenshots, screenOf } from "../src/boot/overlays.tsx";
import type { LateParts } from "../src/boot/parts.ts";
import { Late, Services } from "../src/boot/services.ts";
import { onScreen, Screens } from "../src/boot/session.ts";
import type { Compositor } from "../src/compositor/client.ts";
import { filesLaunch } from "../src/file-manager.ts";
import { NotificationStore } from "../src/notifications/store.ts";
import { SettingsStore } from "../src/settings-app/index.ts";

/** The pieces start-up makes, with no compositor: each says how it stops as it starts. */
async function desktopWithoutCompositor(services: Services, late: Late<LateParts>) {
  const screens = new Screens(null);
  const desktops = await startDesktops({ compositor: null, settingsStore: new SettingsStore(), screens, services, late });
  const arranging = await startArranging(null, desktops, services, late);
  const overview = startOverview(null, desktops.spaces, services, late);
  return { screens, desktops, arranging, overview };
}

test("without a compositor the desktop's pieces start empty, in order, and say how they stop", async () => {
  const services = new Services();
  const late = new Late<LateParts>();
  const { desktops, arranging, overview } = await desktopWithoutCompositor(services, late);
  expect(desktops).toEqual({ spaces: null, fullscreenDesktops: null, displays: null });
  expect(arranging.arranger).toBeNull();
  expect(overview).toBeNull();
  // What later pieces reach through callbacks is there as soon as it is made.
  expect(late.get("fullscreenBars")).toBeNull();
  expect(late.get("overview")).toBeNull();
  expect(services.names()).toEqual(["spaces", "full-screen desktops", "displays", "display arrangement", "arranging", "full screen", "overview", "gestures"]);
  expect(await arranging.tile(1, "left")).toBeUndefined();
  expect(arranging.arrangement(1)).toBeNull();
});

test("the shell stops what it started backwards: the last piece started stops first", async () => {
  const services = new Services();
  await desktopWithoutCompositor(services, new Late<LateParts>());
  const started = services.names();
  const stopped: string[] = [];
  const order = new Services();
  for (const name of started) order.add(name, () => stopped.push(name));
  expect(order.closeAll()).toEqual([]);
  expect(stopped).toEqual([...started].reverse());
  // The real stops run without a compositor, too.
  expect(services.closeAll()).toEqual([]);
});

test("without a compositor there are no screens, and the person is on the compositor's choice", async () => {
  const screens = new Screens(null);
  expect(await screens.names()).toEqual([]);
  expect(screens.mainDisplay).toBeNull();
  expect(await screens.whereIsPerson()).toBeUndefined();
  expect(onScreen(undefined)).toEqual({});
  expect(onScreen("DP-1")).toEqual({ output: "DP-1" });
});

test("a failed question about the screens is null, so nothing is torn down", async () => {
  const compositor = { outputs: () => Promise.reject(new Error("gone")) } as unknown as Compositor;
  expect(await new Screens(compositor).names()).toBeNull();
});

test("without a compositor the screenshot tools are not made, and asking for one does nothing", async () => {
  const services = new Services();
  const late = new Late<LateParts>();
  const shots = new Screenshots(null, { capture: null, notifications: { store: new NotificationStore() } as never }, services, late);
  expect(shots.tools).toBeNull();
  await shots.run("screen", null);
  shots.selectArea(3);
  shots.registerApp(services);
  expect(services.names()).toEqual(["screen recording", "screenshot selection", "screenshot app"]);
  expect(services.closeAll()).toEqual([]);
  expect(await screenOf(null, 4)).toEqual({ origin: { x: 0, y: 0 } });
});

test("the daily look for updates waits for a network and for power", () => {
  const plugged = { state: "charging", percent: 50 } as never;
  const draining = { state: "discharging", percent: 50 } as never;
  const online = { kind: "wifi", ssid: "Home" } as never;
  const offline = { kind: "offline" } as never;
  expect(mayLookForUpdates({ battery: plugged, network: online })).toBe(true);
  expect(mayLookForUpdates({ battery: null, network: online })).toBe(true);
  expect(mayLookForUpdates({ battery: draining, network: online })).toBe(false);
  expect(mayLookForUpdates({ battery: plugged, network: offline })).toBe(false);
});

test("Restart says who isn't closing, and when it goes without them", () => {
  expect(machineEndNotice(["Helium"], 7, "restart")).toMatchObject({
    summary: "Restarting",
    body: "Helium isn’t closing. Dashi will restart without it in 7 s.",
    urgency: "critical",
    transient: true,
  });
  expect(machineEndNotice(["Helium", "Files"], 3, "shutdown")).toMatchObject({
    summary: "Shutting Down",
    body: "Helium, Files aren’t closing. Dashi will shut down without them in 3 s.",
  });
});

test("Show in folder starts Files on the paths, with the caller's token when there is one", () => {
  const files = { id: "dev.dashi.files", name: "Files", icon: "", exec: ["bun", "files.tsx"], env: { A: "1" } } as never;
  expect(filesLaunch(undefined, ["/home/alexk"], "")).toBeNull();
  expect(filesLaunch({ id: "x", name: "X", icon: "" } as never, ["/"], "")).toBeNull();
  expect(filesLaunch(files, ["/home/alexk"], "")).toEqual({
    id: "dev.dashi.files",
    name: "Files",
    icon: "",
    exec: ["bun", "files.tsx", "/home/alexk"],
    env: { A: "1" },
  });
  expect(filesLaunch(files, ["--info", "/tmp/a"], "tok")).toMatchObject({
    exec: ["bun", "files.tsx", "--info", "/tmp/a"],
    env: { A: "1", XDG_ACTIVATION_TOKEN: "tok", DESKTOP_STARTUP_ID: "tok" },
  });
});

test("an app's quitting and its shortcuts reach the processes that own the window's menus", async () => {
  const told: string[] = [];
  const appMenus = {
    ownersOf: (pid: number | null) => (pid === null ? [] : [pid, 1]),
    store: {
      quitting: (owners: number[]) => told.push(`quit ${owners.join(",")}`),
      shortcut: (owners: number[], shortcut: string) => {
        told.push(`${shortcut} ${owners.join(",")}`);
        return true;
      },
    },
  } as unknown as AppMenus;
  appQuitting(appMenus, 42);
  const compositor = { windows: async () => [{ id: 7, pid: 42 }] } as unknown as Compositor;
  expect(await appShortcut(compositor, appMenus, 7, "❖S")).toBe(true);
  expect(await appShortcut(null, appMenus, 7, "❖N")).toBe(true);
  expect(told).toEqual(["quit 42,1", "❖S 42,1", "❖N "]);
});
