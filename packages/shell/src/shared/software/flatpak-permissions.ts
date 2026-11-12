/**
 * What a Flatpak app can reach outside its sandbox, from Flathub's summary
 * (`summary/<id>`: `metadata.permissions`, the app's `[Context]` as lists:
 * shared, sockets, devices, filesystems, and the session and system buses),
 * read strictly and put in the plain lines applets and Settings' Privacy &
 * Security use (@dashi/applet's REACH). What it can reach is Flathub's word,
 * untrusted like the rest of its answer: entries are checked and cut, and an
 * answer without permissions is "not known", never "nothing".
 *
 * Broad access (all your files, every device, a way out of the sandbox) is
 * what turns Get into Get…: the trust card is asked about as a sheet first.
 */

import { folderLine, REACH } from "@dashi/applet";
import { isRecord } from "./parse-values.ts";
import { tidy } from "./text.ts";

export interface BusAccess {
  talk: string[];
  own: string[];
}

export interface FlatpakPermissions {
  shared: string[];
  sockets: string[];
  devices: string[];
  filesystems: string[];
  sessionBus: BusAccess;
  systemBus: BusAccess;
}

const MAX_ENTRIES = 60;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((each): each is string => typeof each === "string")
        .slice(0, MAX_ENTRIES)
        .map((each) => tidy(each, 200))
        .filter((each) => each !== "")
    : [];

const bus = (value: unknown): BusAccess => (isRecord(value) ? { talk: strings(value.talk), own: strings(value.own) } : { talk: [], own: [] });

/** `metadata.permissions` from a summary answer, or null when Flathub didn't say. */
export function parsePermissions(summary: unknown): FlatpakPermissions | null {
  if (!isRecord(summary) || !isRecord(summary.metadata) || !isRecord(summary.metadata.permissions)) return null;
  const permissions = summary.metadata.permissions;
  return {
    shared: strings(permissions.shared),
    sockets: strings(permissions.sockets),
    devices: strings(permissions.devices),
    filesystems: strings(permissions.filesystems),
    sessionBus: bus(permissions["session-bus"]),
    systemBus: bus(permissions["system-bus"]),
  };
}

/** The folders a person knows, by Flatpak's names for them. */
const XDG_FOLDERS: Readonly<Record<string, string>> = {
  "xdg-download": "Downloads",
  "xdg-documents": "Documents",
  "xdg-pictures": "Pictures",
  "xdg-music": "Music",
  "xdg-videos": "Videos",
  "xdg-desktop": "Desktop",
  "xdg-templates": "Templates",
  "xdg-public-share": "Public",
};

/** Services on the session bus, in words: the ones that mean something to a person. */
const SESSION_SERVICES: Readonly<Record<string, string>> = {
  "org.freedesktop.Notifications": REACH.notifications,
  "org.freedesktop.secrets": "Use the passwords saved in your keyring",
  "org.kde.StatusNotifierWatcher": "Show an icon in the menu bar",
  "org.freedesktop.ScreenSaver": "Keep the screen from sleeping",
  "org.mpris.MediaPlayer2.*": "Talk to media players",
};

/** A sandbox escape: a running app may start commands outside the sandbox. */
const ESCAPES = new Set(["org.freedesktop.Flatpak", "org.freedesktop.Flatpak.*"]);

interface FileAccess {
  line: string;
  broad: boolean;
}

/**
 * One `filesystems` entry in words; null for one that names nothing a person
 * keeps (its own folders, runtime sockets). `appId`: the app's own, so its
 * own folder in ~/.var/app is left out and another app's is named in words.
 */
function fileAccess(entry: string, appId?: string): FileAccess | null {
  if (entry.startsWith("!")) return null;
  const [where = "", mode] = entry.split(":");
  const write = mode !== "ro";
  // Where Flatpak apps keep their settings and data: a path no one reads (CP-6).
  const appData = /^~\/\.var\/app\/([^/]+)/.exec(where);
  if (appData) {
    if (appData[1] === appId) return null;
    return { line: write ? "Read and change another app's settings and data" : "Read another app's settings and data", broad: false };
  }
  if (where === "host" || where === "host-os" || where === "host-etc" || where === "/") {
    if (where === "host") return { line: write ? "Read and change all your files" : "Read all your files", broad: write };
    return { line: "Read the system's own files", broad: false };
  }
  if (where === "home" || where === "~")
    return { line: write ? "Read and change everything in your home folder" : "Read everything in your home folder", broad: write };
  const xdg = /^(xdg-[a-z-]+)(\/.*)?$/.exec(where);
  if (xdg) {
    const name = XDG_FOLDERS[xdg[1] ?? ""];
    if (name) return { line: folderLine(xdg[2] ? `${name}${xdg[2]}` : name, write), broad: false };
    // xdg-config, xdg-data, xdg-cache, xdg-run: its own corners of them.
    return null;
  }
  if (where.startsWith("~/")) return { line: folderLine(where, write), broad: false };
  if (where.startsWith("/media") || where.startsWith("/run/media") || where.startsWith("/mnt"))
    return { line: folderLine("removable drives", write), broad: false };
  if (where.startsWith("/")) return { line: folderLine(where, write), broad: false };
  return null;
}

export interface Reach {
  /** What it can do, each once, the weightiest first. */
  lines: string[];
  /** Why it is broad (the sheet's reasons); empty when it isn't. */
  broad: string[];
}

/** The permissions in plain lines, and whether any is broad; `appId` is the app's own (its own folders aren't named). */
export function describeReach(permissions: FlatpakPermissions, appId?: string): Reach {
  const lines: string[] = [];
  const broad: string[] = [];
  const add = (line: string, isBroad = false): void => {
    if (!lines.includes(line)) lines.push(line);
    if (isBroad && !broad.includes(line)) broad.push(line);
  };
  for (const entry of permissions.filesystems) {
    const access = fileAccess(entry, appId);
    if (access) add(access.line, access.broad);
  }
  if (permissions.devices.includes("all")) add("Use every device: cameras, microphones, USB and game controllers", true);
  else {
    if (permissions.devices.includes("input")) add("Use game controllers");
    if (permissions.devices.includes("usb")) add("Use USB devices");
    if (permissions.devices.includes("kvm")) add("Run virtual machines");
  }
  if (permissions.shared.includes("network")) add(REACH.network);
  if (permissions.sockets.includes("pulseaudio")) add("Play sound and use the microphone");
  if (permissions.sockets.includes("session-bus")) add("Talk to every app in your session", true);
  if (permissions.sockets.includes("system-bus")) add("Talk to every service on the system", true);
  if (permissions.sockets.includes("x11") && !permissions.sockets.includes("wayland"))
    add("Draw its windows the older way (X11), where apps can see each other's keys");
  if (permissions.sockets.includes("ssh-auth")) add("Use your SSH keys");
  if (permissions.sockets.includes("gpg-agent")) add("Use your GPG keys");
  if (permissions.sockets.includes("pcsc")) add("Use smart cards");
  if (permissions.sockets.includes("cups")) add("Print");
  const others: string[] = [];
  for (const name of permissions.sessionBus.talk) {
    if (ESCAPES.has(name)) add("Run commands outside its sandbox", true);
    else if (SESSION_SERVICES[name]) add(SESSION_SERVICES[name]);
    else if (!name.startsWith("org.freedesktop.portal.")) others.push(name);
  }
  if (others.length > 0) add(others.length === 1 ? "Talk to one other app" : `Talk to ${others.length} other apps`);
  const system = permissions.systemBus.talk.length;
  if (system > 0) add(system === 1 ? "Talk to one system service" : `Talk to ${system} system services`);
  // The broad ones lead.
  return { lines: [...broad, ...lines.filter((line) => !broad.includes(line))], broad };
}

/** The line under the list: what it can't do, when there is something reassuring to say. */
export function cannotReach(permissions: FlatpakPermissions, appId?: string): string | null {
  const files = permissions.filesystems.some((entry) => fileAccess(entry, appId) !== null);
  const network = permissions.shared.includes("network");
  if (files && network) return null;
  if (!files && !network) return "It can't read your files or use the network, except files you open with it.";
  return files ? "It can't use the network." : "It can't read your files, except the ones you open with it.";
}
