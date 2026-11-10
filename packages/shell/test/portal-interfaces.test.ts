import { expect, test } from "bun:test";
import { accessReply, parseAccess } from "../apps/portal/access.tsx";
import { accountReply, parseAccountRequest } from "../apps/portal/account.tsx";
import { alwaysUse, orderChoices, parseAppChooser, parseGioDefault, subjectOf } from "../apps/portal/app-chooser/choices.ts";
import { installReply, launcherName, parseInstall } from "../apps/portal/dynamic-launcher.tsx";
import { composeEmail, mailtoUri, parseDraft, thunderbirdCompose } from "../apps/portal/email.ts";
import { InhibitBackend } from "../apps/portal/inhibit.ts";
import { NotificationBackend, notifyCall, parseIcon, parseNotification, withFdIcon } from "../apps/portal/notification.ts";
import { type Exporter, Requests } from "../apps/portal/request.ts";
import { accentTriple, changedSettings, namespaceWanted, readAll, settingsInterface, settingsTable } from "../apps/portal/settings.ts";
import type { ShellLink } from "../apps/portal/shell.ts";
import { type ExportedObject, type InterfaceSpec, type Variant, variant } from "../src/shared/dbus/index.ts";

const dict = (entries: Record<string, Variant>) => new Map(Object.entries(entries));

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

test("Open With: the default first, then the last choice, the rest as offered; Always writes the default", () => {
  const request = parseAppChooser([
    "",
    "x11:1",
    ["org.gnome.Evince", "net.imput.helium", "dev.dashi.preview", "bad id!"],
    dict({ last_choice: variant("s", "net.imput.helium"), content_type: variant("s", "Application/PDF"), filename: variant("s", "/home/alex/Lease 2026.pdf") }),
  ]);
  expect(request.choices).toEqual(["org.gnome.Evince", "net.imput.helium", "dev.dashi.preview"]);
  expect(request.contentType).toBe("application/pdf");
  expect(orderChoices(request, "dev.dashi.preview")).toEqual(["dev.dashi.preview", "net.imput.helium", "org.gnome.Evince"]);
  // A default the portal didn't offer isn't shown.
  expect(orderChoices(request, "com.other")).toEqual(["net.imput.helium", "org.gnome.Evince", "dev.dashi.preview"]);
  expect(parseGioDefault("Default application for “application/pdf”: dev.dashi.preview.desktop\nRegistered applications:\n\torg.gnome.Evince.desktop\n")).toBe(
    "dev.dashi.preview",
  );
  expect(parseGioDefault("No default applications for “x/y”\n")).toBeNull();
  expect(subjectOf(request)).toBe("Lease 2026.pdf");
  expect(subjectOf({ filename: null, uri: "https://example.org/a", contentType: null })).toBe("example.org");
  expect(alwaysUse("", "application/pdf", "org.gnome.Evince")).toBe("[Default Applications]\napplication/pdf=org.gnome.Evince.desktop;\n");
  expect(alwaysUse("[Default Applications]\napplication/pdf=dev.dashi.preview.desktop;\n", "application/pdf", "org.gnome.Evince")).toBe(
    "[Default Applications]\napplication/pdf=org.gnome.Evince.desktop;dev.dashi.preview.desktop;\n",
  );
});

test("Email: the draft, as a mailto link and as Thunderbird's compose line", async () => {
  const draft = parseDraft(
    dict({
      address: variant("s", "hi@peje.dev"),
      addresses: variant("as", ["alex@example.org", "not an address", "hi@peje.dev"]),
      cc: variant("as", ["c@example.org"]),
      subject: variant("s", "Lease\nagain"),
      body: variant("s", "Hi,\nsigned."),
      attachments: variant("as", ["file:///home/alex/Lease%202026.pdf", "/home/alex/b.txt", "https://x/y"]),
    }),
  );
  expect(draft).toMatchObject({
    to: ["hi@peje.dev", "alex@example.org"],
    cc: ["c@example.org"],
    subject: "Lease again",
    attachments: ["/home/alex/Lease 2026.pdf", "/home/alex/b.txt"],
  });
  expect(mailtoUri(draft)).toBe(
    "mailto:hi@peje.dev,alex@example.org?cc=c%40example.org&subject=Lease%20again&body=Hi%2C%0D%0Asigned.&attach=%2Fhome%2Falex%2FLease%202026.pdf&attach=%2Fhome%2Falex%2Fb.txt",
  );
  expect(thunderbirdCompose(draft)).toContain("attachment='file:///home/alex/Lease%202026.pdf,file:///home/alex/b.txt'");
  const ran: string[][] = [];
  const ok = await composeEmail(draft, async (command) => {
    ran.push([...command]);
    return {
      ok: true,
      code: 0,
      stdout: command[1] === "mime" ? "Default application for “x-scheme-handler/mailto”: org.gnome.Geary.desktop\n" : "",
      stderr: "",
    };
  });
  expect(ok).toBe(true);
  expect(ran[1]?.[0]).toBe("gio");
  expect(ran[1]?.[2]?.startsWith("mailto:")).toBe(true);
});

test("Notification: title, body, buttons and the default action, into Notify and back as ActionInvoked", async () => {
  const notification = parseNotification(
    dict({
      title: variant("s", "Alex Kim"),
      body: variant("s", "Lunch?"),
      priority: variant("s", "high"),
      "default-action": variant("s", "app.open-chat"),
      "default-action-target": variant("s", "chat-7"),
      buttons: variant("aa{sv}", [
        dict({ label: variant("s", "Reply"), action: variant("s", "app.reply"), target: variant("i", 7) }),
        dict({ label: variant("s", "No action") }),
      ]),
      icon: variant("(sv)", ["themed", variant("as", ["chat-symbolic", "chat"])]),
    }),
  );
  expect(notification).toMatchObject({ title: "Alex Kim", body: "Lunch?", priority: "high", defaultAction: "app.open-chat", icon: { name: "chat-symbolic" } });
  expect(notification.buttons.map((button) => button.label)).toEqual(["Reply"]);
  const call = notifyCall("org.gnome.Fractal", notification);
  expect(call.actions).toEqual(["default", "", "button-0", "Reply"]);
  expect(call.hints.get("urgency")?.value).toBe(2);
  expect(call.hints.get("desktop-entry")?.value).toBe("org.gnome.Fractal");
  expect(parseIcon(variant("(sv)", ["file", variant("s", "/etc/passwd")]))).toBeNull();

  const sent: Array<[string, number]> = [];
  const invoked: unknown[] = [];
  const backend = new NotificationBackend(
    {
      notify: async (appName, replaces) => {
        sent.push([appName, replaces]);
        return 42;
      },
      close: async () => {},
    },
    (appId, id, action, parameter) => invoked.push([appId, id, action, parameter.map((p) => p.value)]),
    () => "Fractal",
  );
  await backend.add(
    "org.gnome.Fractal",
    "msg-1",
    dict({
      title: variant("s", "Hi"),
      buttons: variant("aa{sv}", [dict({ label: variant("s", "Reply"), action: variant("s", "app.reply"), target: variant("i", 7) })]),
    }),
  );
  await backend.add("org.gnome.Fractal", "msg-1", dict({ title: variant("s", "Hi again") }));
  expect(sent).toEqual([
    ["Fractal", 0],
    ["Fractal", 42],
  ]);
  await backend.add(
    "org.gnome.Fractal",
    "msg-1",
    dict({
      title: variant("s", "Hi"),
      buttons: variant("aa{sv}", [dict({ label: variant("s", "Reply"), action: variant("s", "app.reply"), target: variant("i", 7) })]),
    }),
  );
  backend.actionInvoked(42, "button-0");
  backend.actionInvoked(99, "button-0");
  expect(invoked).toEqual([["org.gnome.Fractal", "msg-1", "app.reply", [7]]]);
});

test("DynamicLauncher: the name and icon offered, given back on Add", () => {
  const icon = variant("(sv)", ["bytes", variant("ay", new Uint8Array([137, 80, 78, 71]))]);
  const request = parseInstall([
    "net.imput.helium",
    "wayland:x",
    " YNAB\n",
    icon,
    dict({ launcher_type: variant("u", 2), target: variant("s", "https://app.ynab.com"), editable_name: variant("b", true) }),
  ]);
  expect(request).toMatchObject({ name: "YNAB", kind: 2, target: "https://app.ynab.com", editableName: true });
  expect(launcherName("  ")).toBeNull();
  expect(launcherName("Budget\u0007 app")).toBe("Budget app");
  const [code, results] = installReply(request, "Budget");
  expect(code).toBe(0);
  expect((results.get("name") as Variant).value).toBe("Budget");
  expect(results.get("icon")).toBe(icon);
  expect(installReply(request, null)[0]).toBe(1);
});

test("Notification v2: a picture sent as a descriptor is read as bytes", () => {
  const value = dict({ title: variant("s", "Hi"), icon: variant("(sv)", ["file-descriptor", variant("h", 0)]) });
  const read = withFdIcon(value, [42], (fd) => (fd === 42 ? new Uint8Array([1, 2, 3]) : null));
  expect(parseNotification(read).icon).toEqual({ bytes: new Uint8Array([1, 2, 3]) });
  expect(parseNotification(withFdIcon(value, [], () => null)).icon).toBeNull();
});
