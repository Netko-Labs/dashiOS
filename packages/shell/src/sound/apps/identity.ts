/**
 * Which app a sound stream is, named as the Dock and Activity Monitor name
 * it (process-apps/, CP-6), first that answers:
 *
 * 1. A Flatpak, by the portal's app id. Its claimed pid comes from inside
 *    its sandbox, so it is never trusted.
 * 2. Its process: for a native client the pid PipeWire saw on the socket
 *    (the kernel vouches for it); for a Pulse client the pid it claims
 *    (the socket's is pipewire-pulse's), which only names the row. A
 *    Flatpak's scope in its cgroup still wins; then the process and its
 *    parents, each by itself or by the window it owns, as the battery menu
 *    walks them. A browser's audio service is its browser's child.
 * 3. The name it gives itself (application.name), never a binary's.
 *
 * Pure but for `read`, which reads a process's facts from /proc.
 */

import type { AppCatalog, AppIdentity, ProcessFacts } from "../../process-apps/index.ts";
import { DASHI_KEY, flatpakId, identify } from "../../process-apps/index.ts";
import type { Stream } from "./streams.ts";

/** What the walk reads of a process. */
export interface ProcessLook extends ProcessFacts {
  ppid: number;
}

export interface IdentityDeps {
  catalog: AppCatalog;
  /** A process's facts, or null when it is gone or unreadable. */
  read: (pid: number) => ProcessLook | null;
  /** The app whose window this process owns, if any (the Dock's name for it). */
  windowOwner?: (pid: number) => AppIdentity | null;
}

/** An app no entry or process names, as the microphone indicator says it. */
export const UNKNOWN_APP = "An app";

/** Parents followed at most. */
const MAX_DEPTH = 32;

/**
 * The programs Dashi itself plays or records sound with (Settings' level
 * meter, the screen recorder, event sounds). Any other program whose nearest
 * app is Dashi is an app the shell launched that no entry names: it is not
 * Dashi's own sound, so it keeps its own name.
 */
const DASHI_HELPERS: ReadonlySet<string> = new Set(["pw-record", "pw-cat", "pw-play", "wf-recorder", "ffmpeg", "canberra-gtk-pl", "paplay"]);

/** "org.gnome.Rhythmbox" → "Rhythmbox". */
function nameFromId(id: string): string {
  const last = id.split(".").filter(Boolean).at(-1) ?? id;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function flatpakApp(id: string, catalog: AppCatalog): AppIdentity {
  return catalog.byId.get(id.toLowerCase()) ?? { key: id, name: nameFromId(id), icon: catalog.genericIcon };
}

/** The pid that says who the stream is, or null. */
export function streamPid(stream: Pick<Stream, "pid" | "secPid" | "pulse">): number | null {
  if (stream.pulse) return stream.pid;
  return stream.secPid ?? stream.pid;
}

/** The app of a process: its Flatpak scope, else itself or its nearest parent that is an app or owns a window. */
export function processApp(pid: number, deps: IdentityDeps): AppIdentity | null {
  let at: ProcessLook | null = deps.read(pid);
  let current = pid;
  if (at) {
    const flatpak = flatpakId(at.cgroup);
    if (flatpak) return flatpakApp(flatpak, deps.catalog);
  }
  const own = at?.comm ?? "";
  for (let depth = 0; at && depth < MAX_DEPTH; depth++) {
    const found = (at.argv.length > 0 ? identify(at, deps.catalog) : null) ?? deps.windowOwner?.(current) ?? null;
    if (found) return found.key === DASHI_KEY && depth > 0 && !DASHI_HELPERS.has(own) ? null : found;
    if (at.ppid <= 2 || at.ppid === current) break;
    current = at.ppid;
    at = deps.read(current);
  }
  return null;
}

/** The app a stream belongs to. */
export function streamApp(stream: Stream, deps: IdentityDeps): AppIdentity {
  if (stream.portalAppId) return flatpakApp(stream.portalAppId, deps.catalog);
  const pid = streamPid(stream);
  const found = pid === null ? null : processApp(pid, deps);
  if (found) return found;
  const name = stream.appName;
  return name ? { key: `sound:${name}`, name, icon: deps.catalog.genericIcon } : { key: "sound:unknown", name: UNKNOWN_APP, icon: deps.catalog.genericIcon };
}
