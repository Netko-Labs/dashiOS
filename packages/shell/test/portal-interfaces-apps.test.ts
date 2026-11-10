import { expect, test } from "bun:test";
import { alwaysUse, orderChoices, parseAppChooser, parseGioDefault, subjectOf } from "../apps/portal/app-chooser/choices.ts";
import { installReply, launcherName, parseInstall } from "../apps/portal/dynamic-launcher.tsx";
import { composeEmail, mailtoUri, parseDraft, thunderbirdCompose } from "../apps/portal/email.ts";
import { NotificationBackend, notifyCall, parseIcon, parseNotification, withFdIcon } from "../apps/portal/notification.ts";
import { type Variant, variant } from "../src/shared/dbus/index.ts";
import { dict } from "./support/portal-interfaces.ts";

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
