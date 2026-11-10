/**
 * The portal backend on a private bus, called the way xdg-desktop-portal
 * calls it (the same signatures), with the sheets answered by fakes: what
 * comes back over the wire, and the Request objects that live meanwhile.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { accessInterface } from "../apps/portal/access.tsx";
import { appChooserInterface } from "../apps/portal/app-chooser/index.tsx";
import { fileChooserInterface } from "../apps/portal/file-chooser/index.tsx";
import { InhibitBackend } from "../apps/portal/inhibit.ts";
import { Requests } from "../apps/portal/request.ts";
import { settingsInterface, settingsTable } from "../apps/portal/settings.ts";
import { DBusConnection, FdService, Variant, variant } from "../src/shared/dbus/index.ts";
import { type PrivateBus, startPrivateBus } from "./private-bus.ts";
import { until } from "./support/time.ts";

const NAME = "org.freedesktop.impl.portal.desktop.dashi";
const PATH = "/org/freedesktop/portal/desktop";
let bus: PrivateBus | null = null;
let service: FdService | null = null;
let client: DBusConnection | null = null;
const holds: string[] = [];
let release: (() => void) | null = null;
let waiting = false;

beforeAll(async () => {
  bus = await startPrivateBus("dashi-portal-bus");
  if (!bus) return;
  service = await FdService.connect({ address: bus.address });
  const requests = new Requests(service);
  const inhibit = new InhibitBackend({
    bus: service,
    shell: {
      inhibit: async (appId, reason) => {
        holds.push(`+${appId}:${reason}`);
        return 5;
      },
      uninhibit: async (id) => void holds.push(`-${id}`),
      expectSheet: async () => false,
      addToDock: async () => {},
    },
    stateChanged: () => {},
  });
  service.export(PATH, [
    fileChooserInterface(requests, (request, signal) => {
      if (request.title === "Wait") {
        waiting = true;
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve(null)));
      }
      return Promise.resolve({ paths: [`/home/alex/${request.mode}.pdf`], choices: [], filter: request.currentFilter });
    }),
    settingsInterface(() => settingsTable({ dark: true, reduceMotion: true, pointerSize: 32, look: {} })),
    inhibit.spec(),
    accessInterface(requests, async () => ({ granted: true, choices: [] })),
    appChooserInterface(
      requests,
      async (_request, list) => ({ id: list.getSnapshot()[0] ?? "", always: false }),
      async () => "dev.dashi.preview",
    ),
  ]);
  await service.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "RequestName",
    signature: "su",
    body: [NAME, 4],
  });
  client = await DBusConnection.connect({ address: bus.address });
  release = () => {
    client?.close();
    service?.close();
  };
});

afterAll(() => {
  release?.();
  bus?.stop();
});

const call = (iface: string, member: string, signature: string, body: unknown[]) =>
  (client as DBusConnection).call({ destination: NAME, path: PATH, interface: `org.freedesktop.impl.portal.${iface}`, member, signature, body });

test("OpenFile and SaveFile over the bus: a response code and file URIs", async () => {
  if (!client) return;
  const filters = variant("a(sa(us))", [["PDF", [[1, "application/pdf"]]]]);
  const [code, results] = await call("FileChooser", "OpenFile", "osssa{sv}", [
    "/org/freedesktop/portal/desktop/request/1_9/a",
    "app",
    "",
    "Open",
    new Map([["filters", filters]]),
  ]);
  expect(code).toBe(0);
  const map = results as Map<string, Variant>;
  expect(map.get("uris")?.value).toEqual(["file:///home/alex/open.pdf"]);
  expect(map.get("current_filter")?.value).toEqual(["PDF", [[1, "application/pdf"]]]);
  const [saved] = await call("FileChooser", "SaveFile", "osssa{sv}", ["/org/freedesktop/portal/desktop/request/1_9/b", "app", "", "Save", new Map()]);
  expect(saved).toBe(0);
});

test("a Request's Close ends its dialog: the call answers, cancelled", async () => {
  if (!client) return;
  const handle = "/org/freedesktop/portal/desktop/request/1_9/c";
  const answer = call("FileChooser", "OpenFile", "osssa{sv}", [handle, "app", "", "Wait", new Map()]);
  await until(() => waiting, "the dialog to open");
  await (client as DBusConnection).call({ destination: NAME, path: handle, interface: "org.freedesktop.impl.portal.Request", member: "Close" });
  const [code] = await answer;
  expect(code).toBe(1);
});

test("Settings over the bus: ReadAll by namespace, Read one key", async () => {
  if (!client) return;
  const [all] = await call("Settings", "ReadAll", "as", [["org.freedesktop.appearance"]]);
  const appearance = (all as Map<string, Map<string, Variant>>).get("org.freedesktop.appearance");
  expect(appearance?.get("color-scheme")?.value).toBe(1);
  expect(appearance?.get("reduced-motion")?.value).toBe(1);
  const [one] = await call("Settings", "Read", "ss", ["org.gnome.desktop.interface", "cursor-size"]);
  expect((one as Variant).value).toBe(32);
  await expect(call("Settings", "Read", "ss", ["org.example", "nothing"])).rejects.toThrow("NotFound");
});

test("Inhibit over the bus: the hold lasts until its Request is closed", async () => {
  if (!client) return;
  const handle = "/org/freedesktop/portal/desktop/request/1_9/i";
  await call("Inhibit", "Inhibit", "ossua{sv}", [handle, "org.gnome.Totem", "", 8, new Map([["reason", new Variant("s", "Playing")]])]);
  expect(holds).toEqual(["+org.gnome.Totem:Playing"]);
  await (client as DBusConnection).call({ destination: NAME, path: handle, interface: "org.freedesktop.impl.portal.Request", member: "Close" });
  expect(holds).toEqual(["+org.gnome.Totem:Playing", "-5"]);
});

test("Access and AppChooser over the bus", async () => {
  if (!client) return;
  const [granted] = await call("Access", "AccessDialog", "osssssa{sv}", [
    "/org/freedesktop/portal/desktop/request/1_9/d",
    "app",
    "",
    "Use the camera?",
    "",
    "",
    new Map(),
  ]);
  expect(granted).toBe(0);
  const [code, results] = await call("AppChooser", "ChooseApplication", "ossasa{sv}", [
    "/org/freedesktop/portal/desktop/request/1_9/e",
    "app",
    "",
    ["org.gnome.Evince", "dev.dashi.preview"],
    new Map([["content_type", new Variant("s", "application/pdf")]]),
  ]);
  expect(code).toBe(0);
  expect((results as Map<string, Variant>).get("choice")?.value).toBe("dev.dashi.preview");
});
