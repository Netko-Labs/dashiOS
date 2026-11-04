/**
 * The desktop's own file chooser, through xdg-desktop-portal
 * (`org.freedesktop.portal.FileChooser.OpenFile` on the session bus), so
 * Dashi draws no file browser of its own and the dialog is the one the
 * person's apps use. The chosen file comes back as a `file://` URI. Where
 * there is no session bus or no portal (a development run), `chooseFile`
 * rejects and the caller offers something else.
 *
 * Used by System Settings' "Add Photo…" (wallpaper/chooser.ts) and by
 * Preview's File > Open….
 */

import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { DBusConnection, variant } from "../dbus/index.ts";

const PORTAL = "org.freedesktop.portal.Desktop";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const CHOOSER = "org.freedesktop.portal.FileChooser";
const REQUEST = "org.freedesktop.portal.Request";
/** A person may take their time in a dialog, but not forever. */
const DIALOG_TIMEOUT_MS = 10 * 60 * 1000;

/** What the dialog shows: its title, and the kinds of file it lists (a name and MIME types). */
export interface FileDialog {
  title: string;
  filter: { name: string; types: readonly string[] };
  /** Whether a chosen path is one the caller takes; the first that is wins. */
  accept: (path: string) => boolean;
}

/** An absolute path with no control characters: what a chosen file may be. */
export const isPlainPath = (path: string): boolean => isAbsolute(path) && !/[\u0000-\u001f\u007f]/.test(path);

/** The absolute path a `file://` URI names (percent-decoded), or null for anything else. */
export function pathFromUri(uri: unknown, accept: (path: string) => boolean = () => true): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost")) return null;
    const path = decodeURIComponent(url.pathname);
    return isPlainPath(path) && accept(path) ? path : null;
  } catch {
    return null;
  }
}

/** The path a portal Request object has: it is derived from our unique name and the token we give. */
export function requestPath(uniqueName: string, token: string): string {
  return `/org/freedesktop/portal/desktop/request/${uniqueName.replace(/^:/, "").replaceAll(".", "_")}/${token}`;
}

/** The first usable path of a `Response`'s results, or null (cancelled, or nothing we can use). */
export function pickedPath(code: unknown, results: unknown, accept: (path: string) => boolean = () => true): string | null {
  if (code !== 0 || !(results instanceof Map)) return null;
  const uris: unknown = results.get("uris") && (results.get("uris") as { value?: unknown }).value;
  return Array.isArray(uris) ? (uris.map((uri) => pathFromUri(uri, accept)).find((path) => path !== null) ?? null) : null;
}

/** Asks the portal for one file; null when the person cancelled, rejects when there is no portal. */
export async function chooseFile(
  dialog: FileDialog,
  connect: () => Promise<DBusConnection> = () => DBusConnection.connect({ bus: "session" }),
): Promise<string | null> {
  const connection = await connect();
  try {
    const token = `dashi_${randomBytes(8).toString("hex")}`;
    const handle = requestPath(connection.uniqueName, token);
    return await new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), DIALOG_TIMEOUT_MS);
      const stop = (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("the file chooser portal is not available"));
      };
      // Subscribed before asking, so the answer cannot slip past.
      connection
        .subscribe({ type: "signal", sender: PORTAL, interface: REQUEST, member: "Response", path: handle }, (message) => {
          clearTimeout(timer);
          resolve(pickedPath(message.body[0], message.body[1], dialog.accept));
        })
        .then(() =>
          connection.call({
            destination: PORTAL,
            path: PORTAL_PATH,
            interface: CHOOSER,
            member: "OpenFile",
            signature: "ssa{sv}",
            body: [
              "",
              dialog.title,
              new Map([
                ["handle_token", variant("s", token)],
                ["modal", variant("b", true)],
                ["filters", variant("a(sa(us))", [[dialog.filter.name, dialog.filter.types.map((type) => [1, type])]])],
              ]),
            ],
          }),
        )
        .catch(stop);
    });
  } finally {
    connection.close();
  }
}
