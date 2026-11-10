/**
 * `org.freedesktop.FileManager1` at `/org/freedesktop/FileManager1`: the
 * file manager service that browsers, Electron apps, and portals call for
 * "Show in folder". The shell owns the name and answers with Dashi's Files:
 *
 * - `ShowFolders(as uris, s startup)`: a window on each folder.
 * - `ShowItems(as uris, s startup)`: a window on each item's folder with the
 *   items there selected.
 * - `ShowItemProperties(as uris, s startup)`: Get Info for each item.
 *
 * Only `file://` URIs (local paths) are shown; others are ignored. A burst of
 * one call opens at most `MAX_WINDOWS` windows. `startup` is the caller's
 * activation token, handed to Files so its window may take the focus.
 */

import { type ConnectOptions, DBusConnection, type InterfaceSpec, NameFlags, requestName } from "./shared/dbus/index.ts";

export const SERVICE = "org.freedesktop.FileManager1";
export const OBJECT_PATH = "/org/freedesktop/FileManager1";
export const MAX_WINDOWS = 8;

/** A local path from a `file://` URI (percent-decoded, no host or `localhost`), or null. */
export function pathOfUri(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "file:" || (url.host !== "" && url.host !== "localhost")) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!path.startsWith("/") || path.includes("\0")) return null;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
};

export type ShowKind = "folders" | "items" | "properties";

/** The Files command lines (after its main.tsx) that a call asks for: one per window. */
export function filesRequests(kind: ShowKind, uris: readonly string[]): string[][] {
  const paths = [...new Set(uris.flatMap((uri) => pathOfUri(uri) ?? []))];
  if (kind === "folders") return paths.slice(0, MAX_WINDOWS).map((path) => [path]);
  if (kind === "properties") return paths.slice(0, MAX_WINDOWS).map((path) => ["--info", path]);
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = parentOf(path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  return [...byFolder.values()].slice(0, MAX_WINDOWS);
}

/** How the shell opens one Files window: its arguments, and the caller's activation token (may be empty). */
export type OpenFiles = (args: readonly string[], startup: string) => void;

export function fileManagerInterface(open: OpenFiles): InterfaceSpec {
  const method = (kind: ShowKind) => ({
    in: "ass",
    handler: (args: unknown[]) => {
      const [uris, startup] = args;
      const list = Array.isArray(uris) ? uris.filter((uri): uri is string => typeof uri === "string") : [];
      for (const request of filesRequests(kind, list)) open(request, typeof startup === "string" ? startup : "");
    },
  });
  return {
    name: SERVICE,
    methods: { ShowFolders: method("folders"), ShowItems: method("items"), ShowItemProperties: method("properties") },
    signals: {},
  };
}

export interface FileManagerService {
  close(): void;
}

/**
 * Claim the file manager name and serve it. Resolves to null, after saying
 * why, without a bus or when another file manager has the name (it keeps it).
 */
export async function serveFileManager(open: OpenFiles, options: ConnectOptions = {}): Promise<FileManagerService | null> {
  let connection: DBusConnection;
  try {
    connection = await DBusConnection.connect(options);
  } catch (error) {
    console.error("dashi-shell: no file manager service, no session bus:", error instanceof Error ? error.message : error);
    return null;
  }
  connection.export(OBJECT_PATH, [fileManagerInterface(open)]);
  try {
    const result = await requestName(connection, SERVICE, NameFlags.doNotQueue);
    if (result !== "primary" && result !== "already-owner") {
      console.error(`dashi-shell: no file manager service, ${SERVICE} is already owned on this bus`);
      connection.close();
      return null;
    }
  } catch (error) {
    console.error("dashi-shell: no file manager service, could not take the name:", error instanceof Error ? error.message : error);
    connection.close();
    return null;
  }
  connection.onClose((error) => {
    if (error) console.error("dashi-shell: the file manager service lost its bus connection:", error.message);
  });
  return { close: () => connection.close() };
}
