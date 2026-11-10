/**
 * dashi-portal: Dashi's xdg-desktop-portal backend. xdg-desktop-portal
 * starts it through D-Bus activation (session/org.freedesktop.impl.portal.
 * desktop.dashi.service → the dashi-portal user unit) and calls it at
 * /org/freedesktop/portal/desktop for every interface session/dashi.portal
 * lists. It owns `org.freedesktop.impl.portal.desktop.dashi` on an
 * FdService connection (Print's document comes as a descriptor), draws its
 * dialogs as Metal windows hung from the asking window (windows.ts), and asks
 * the shell for what is the shell's: holds, sheets, the Dock (shell.ts).
 *
 *   bun apps/portal/main.tsx      (session/dashi-portal runs this)
 */

import { AccountsServiceBackend } from "../../src/accounts/backend.ts";
import { connectDarkMode } from "../../src/control-center/dark-mode.ts";
import { DBusConnection, FdService, type InterfaceSpec, type Variant } from "../../src/shared/dbus/index.ts";
import { PORTAL_BACKEND } from "../../src/shared/portal-host/protocol.ts";
import { setProcessName } from "../kit/name.ts";
import { accessInterface, askOnScreen as askAccessOnScreen } from "./access.tsx";
import { accountInterface, askShareOnScreen } from "./account.tsx";
import { appChooserInterface, chooseOnScreen as chooseAppOnScreen, gioDefault } from "./app-chooser/index.tsx";
import { appInfo } from "./apps.ts";
import { askInstallOnScreen, dynamicLauncherInterface } from "./dynamic-launcher.tsx";
import { emailInterface } from "./email.ts";
import { chooseOnScreen as chooseFilesOnScreen, fileChooserInterface } from "./file-chooser/index.tsx";
import { INHIBIT, InhibitBackend } from "./inhibit.ts";
import { followLook } from "./look.ts";
import { NOTIFICATION, NotificationBackend } from "./notification.ts";
import { followServer, freedesktopServer } from "./notify-server.ts";
import { PrintBackend } from "./print/index.ts";
import { printOnScreen } from "./print/sheet.tsx";
import { Requests } from "./request.ts";
import { changedSettings, SETTINGS, settingsInterface, settingsTable } from "./settings.ts";
import { ShellClient } from "./shell.ts";
import { dialogWindows } from "./windows.ts";

export const PORTAL_PATH = "/org/freedesktop/portal/desktop";

setProcessName("dashi-portal");
connectDarkMode();
process.on("unhandledRejection", (reason) => console.error("dashi-portal: unhandled rejection:", reason));
process.on("uncaughtException", (error) => console.error("dashi-portal: uncaught exception:", error));

let service: FdService;
try {
  service = await FdService.connect({ bus: "session" });
} catch (error) {
  console.error("dashi-portal: no session bus:", error instanceof Error ? error.message : error);
  process.exit(1);
}

// A second connection for what this process asks of others: the shell, the notification server.
let plain: Promise<DBusConnection> | null = null;
const session = (): Promise<DBusConnection> => {
  plain ??= DBusConnection.connect({ bus: "session" }).then((connection) => {
    connection.onClose(() => void (plain = null));
    return connection;
  });
  return plain;
};

const shell = new ShellClient();
const show = dialogWindows(shell);
const requests = new Requests(service);
let object: ReturnType<FdService["export"]> | null = null;
const emit = (iface: string, signal: string, ...args: unknown[]) => object?.emit(iface, signal, ...args);

// A question from an app with no window opens at once too, as a window of its own (windows.ts):
// an item waiting in the menu bar was easy to miss while the app waited on the answer.
const askAccess = askAccessOnScreen(show);
const askShare = askShareOnScreen(show);

const chooseFiles = chooseFilesOnScreen(show);
const inhibit = new InhibitBackend({ bus: service, shell, stateChanged: (path, state) => emit(INHIBIT, "StateChanged", path, state) });
const notifications = new NotificationBackend(
  freedesktopServer(session),
  (appId, id, action, parameter: Variant[]) => emit(NOTIFICATION, "ActionInvoked", appId, id, action, parameter),
  (appId) => appInfo(appId).name,
);
void session()
  .then((connection) => followServer(connection, notifications))
  .catch((error) => console.error("dashi-portal: notification actions will not come back:", error instanceof Error ? error.message : error));
const accounts = new AccountsServiceBackend();

let table = settingsTable({ dark: false, reduceMotion: false, pointerSize: 24, look: {} });
const look = followLook(() => {
  const next = settingsTable(look.current());
  for (const [namespace, key, value] of changedSettings(table, next)) emit(SETTINGS, "SettingChanged", namespace, key, value);
  table = next;
});
table = settingsTable(look.current());

const interfaces: InterfaceSpec[] = [
  fileChooserInterface(requests, chooseFiles),
  settingsInterface(() => table),
  inhibit.spec(),
  accessInterface(requests, askAccess),
  appChooserInterface(requests, chooseAppOnScreen(show), gioDefault),
  accountInterface(requests, () => accounts.read(), askShare),
  emailInterface(requests),
  notifications.spec(),
  dynamicLauncherInterface(requests, askInstallOnScreen(show), (appId, name) => void shell.addToDock(appId, name).catch(() => {})),
  new PrintBackend(requests, printOnScreen(show, chooseFiles)).spec(),
];
object = service.export(PORTAL_PATH, interfaces);

const [result] = await service
  .call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "RequestName",
    signature: "su",
    body: [PORTAL_BACKEND, 4],
  })
  .catch((error) => {
    console.error("dashi-portal: could not take the name:", error instanceof Error ? error.message : error);
    return [0];
  });
if (result !== 1 && result !== 4) {
  console.error(`dashi-portal: ${PORTAL_BACKEND} is already owned; another dashi-portal is running`);
  process.exit(1);
}

service.onClose((error) => {
  console.error("dashi-portal: the bus went away", error ? `(${error.message})` : "");
  look.stop();
  process.exit(0);
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => {
    requests.closeAll();
    service.close();
    process.exit(0);
  });
}
