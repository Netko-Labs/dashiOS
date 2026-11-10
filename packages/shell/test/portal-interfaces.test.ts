import { expect, test } from "bun:test";
import { accessReply, parseAccess } from "../apps/portal/access.tsx";
import { accountReply, parseAccountRequest } from "../apps/portal/account.tsx";
import { InhibitBackend } from "../apps/portal/inhibit.ts";
import { type Exporter, Requests } from "../apps/portal/request.ts";
import { accentTriple, changedSettings, namespaceWanted, readAll, settingsInterface, settingsTable } from "../apps/portal/settings.ts";
import type { ShellLink } from "../apps/portal/shell.ts";
import { type ExportedObject, type InterfaceSpec, type Variant, variant } from "../src/shared/dbus/index.ts";
import { dict } from "./support/portal-interfaces.ts";

/** A bus that only remembers what is exported, and calls into it. */
function fakeBus() {
  const objects = new Map<string, InterfaceSpec[]>();
  const bus: Exporter = {
    export(path, interfaces): ExportedObject {
      objects.set(path, [...interfaces]);
      return { path, emit: () => {}, propertiesChanged: () => {}, unexport: () => void objects.delete(path) };
    },
  };
  const call = (path: string, member: string) => objects.get(path)?.[0]?.methods?.[member]?.handler([], { sender: ":1.1", path, interface: undefined, member });
  return { bus, objects, call };
}

test("Requests: the object lives while the work runs, and Close aborts it", async () => {
  const { bus, objects, call } = fakeBus();
  const requests = new Requests(bus);
  let aborted = false;
  const running = requests.run("/org/freedesktop/portal/desktop/request/1_2/t", (signal) => {
    signal.addEventListener("abort", () => (aborted = true));
    return new Promise<string>((resolve) => signal.addEventListener("abort", () => resolve("closed")));
  });
  expect(objects.has("/org/freedesktop/portal/desktop/request/1_2/t")).toBe(true);
  await call("/org/freedesktop/portal/desktop/request/1_2/t", "Close");
  expect(await running).toBe("closed");
  expect(aborted).toBe(true);
  expect(objects.size).toBe(0);
  await expect(requests.run("not a path", async () => 1)).rejects.toThrow("object path");
});

function fakeShell() {
  const log: string[] = [];
  let next = 10;
  let gate: Promise<void> = Promise.resolve();
  const shell: ShellLink = {
    inhibit: async (appId, reason, flags) => {
      await gate;
      log.push(`inhibit ${appId} ${reason} ${flags}`);
      return next++;
    },
    uninhibit: async (id) => void log.push(`uninhibit ${id}`),
    expectSheet: async () => true,
    addToDock: async () => {},
  };
  return { shell, log, hold: (until: Promise<void>) => (gate = until) };
}

test("Inhibit: the hold is the shell's; the Request's Close lets go, even before the shell answered", async () => {
  const { bus, call } = fakeBus();
  const { shell, log, hold } = fakeShell();
  const states: unknown[] = [];
  const backend = new InhibitBackend({
    bus,
    shell,
    stateChanged: (path, state) => states.push([path, state.get("session-state")?.value]),
    later: (work) => work(),
  });
  await backend.inhibit("/r/1", "org.gnome.Totem", 8, dict({ reason: variant("s", "Playing a film") }));
  expect(log).toEqual(["inhibit org.gnome.Totem Playing a film 8"]);
  expect(backend.held).toBe(1);
  await call("/r/1", "Close");
  expect(log.at(-1)).toBe("uninhibit 10");
  expect(backend.held).toBe(0);
  let release = () => {};
  hold(new Promise((resolve) => (release = resolve)));
  const pending = backend.inhibit("/r/2", "mpv", 8, new Map());
  await call("/r/2", "Close");
  release();
  await pending;
  expect(log.slice(-2)).toEqual(["inhibit mpv  8", "uninhibit 11"]);
  expect(backend.createMonitor("/r/3", "/s/1")).toBe(0);
  expect(states).toEqual([["/s/1", 1]]);
});

test("Settings: the appearance namespace and GTK's keys, read by pattern, changes key by key", async () => {
  const light = settingsTable({ dark: false, reduceMotion: false, pointerSize: 24, look: { interFont: true, accent: "blue" } });
  const dark = settingsTable({ dark: true, reduceMotion: false, pointerSize: 24, look: { interFont: true, accent: "blue" } });
  expect(light.get("org.freedesktop.appearance")?.get("color-scheme")?.value).toBe(0);
  expect(dark.get("org.freedesktop.appearance")?.get("color-scheme")?.value).toBe(1);
  expect(dark.get("org.gnome.desktop.interface")?.get("color-scheme")?.value).toBe("prefer-dark");
  expect(light.get("org.gnome.desktop.interface")?.get("font-name")?.value).toBe("Inter 11");
  expect(light.get("org.freedesktop.appearance")?.get("accent-color")?.signature).toBe("(ddd)");
  expect(accentTriple("#ff0080")).toEqual([1, 0, 0.502]);
  expect(accentTriple("blue")).toBeNull();
  expect(namespaceWanted("org.freedesktop.appearance", ["org.freedesktop.*"])).toBe(true);
  expect(namespaceWanted("org.gnome.desktop.interface", ["org.freedesktop.*"])).toBe(false);
  expect(namespaceWanted("org.gnome.desktop.interface", [])).toBe(true);
  expect([...readAll(light, ["org.freedesktop.appearance"]).keys()]).toEqual(["org.freedesktop.appearance"]);
  expect(changedSettings(light, dark).map(([namespace, key]) => `${namespace} ${key}`)).toEqual([
    "org.freedesktop.appearance color-scheme",
    "org.gnome.desktop.interface color-scheme",
    "org.gnome.desktop.interface gtk-theme",
  ]);
  const spec = settingsInterface(() => light);
  expect(
    (
      (await spec.methods?.Read?.handler(["org.freedesktop.appearance", "color-scheme"], {
        sender: "",
        path: "/",
        interface: undefined,
        member: "Read",
      })) as Variant
    ).value,
  ).toBe(0);
  expect(() => spec.methods?.Read?.handler(["org.freedesktop.appearance", "nope"], { sender: "", path: "/", interface: undefined, member: "Read" })).toThrow(
    "no such setting",
  );
});

test("Access: the question, labels and choices; Allow is 0, Don't Allow and Cancel 1", () => {
  const request = parseAccess([
    "net.imput.helium",
    "wayland:abc",
    "Helium wants to use the camera",
    "Asked from “Meet – Standup”",
    "",
    dict({ grant_label: variant("s", "_Allow"), choices: variant("a(ssa(ss)s)", [["always", "Remember", [], "false"]]) }),
  ]);
  expect(request).toMatchObject({ title: "Helium wants to use the camera", grantLabel: "Allow", denyLabel: "Don’t Allow" });
  expect(request.choices[0]?.initial).toBe("false");
  expect(accessReply({ granted: true, choices: [["always", "true"]] })[0]).toBe(0);
  expect(accessReply({ granted: false, choices: [] })[0]).toBe(1);
  expect(accessReply(null)[0]).toBe(1);
});

test("Account: the reason, and what sharing sends", () => {
  expect(parseAccountRequest(["org.gnome.Fractal", "", dict({ reason: variant("s", "To set up your profile") })]).reason).toBe("To set up your profile");
  const account = {
    uid: 1000,
    userName: "alexk",
    realName: "Alex Kim",
    iconFile: "/var/lib/AccountsService/icons/alexk",
    automaticLogin: false,
    administrator: false,
    hasPassword: true,
  };
  const [code, results] = accountReply(account, true);
  expect(code).toBe(0);
  expect([...results].map(([key, value]) => [key, (value as Variant).value])).toEqual([
    ["id", "alexk"],
    ["name", "Alex Kim"],
    ["image", "file:///var/lib/AccountsService/icons/alexk"],
  ]);
  expect(accountReply(account, false)[0]).toBe(1);
  expect(accountReply(null, true)[0]).toBe(2);
});
