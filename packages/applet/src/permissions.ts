/**
 * What an applet may touch, as applet.json names it, and what each name means
 * in plain words (the consent sheet, the store's page). The sandbox
 * (shell's src/applets/lib/sandbox.ts) gives an applet exactly these and nothing
 * else: no permission, no network, no files, no buses beyond the applets
 * socket and its own Wayland surfaces.
 *
 *   network                   the network
 *   network:HOST              only HOST: no network in the sandbox, one socket to a proxy outside it that lets
 *                             through only HTTPS to the hosts named (shell's src/applets/lib/net-proxy.ts)
 *   account:PROVIDER          the person's account there, once they connect it: the token comes over the channel
 *   notifications             org.freedesktop.Notifications on the session bus
 *   hardware.sensors          dashi-hardware: read the machine (Describe, Get, the Changed signal)
 *   hardware.power            dashi-hardware: everyday knobs (mode, charge limit, boost, EPP)
 *   hardware.lighting         dashi-hardware: the keyboard light and the lid's Slash bar
 *   hardware.fans             dashi-hardware: fan curves (asks for the password: polkit `tune`)
 *   hardware.tuning           dashi-hardware: power limits, the Curve Optimizer, the graphics card's limits (`tune`)
 *   power.mode                Dashi's power mode on the applets channel: read the choice, ask for another (power.ts)
 *   controls                  its controls in Control Center (controls.ts); nothing else
 *   dbus.system:NAME          talk to NAME on the system bus
 *   dbus.session:NAME         talk to NAME on the session bus
 *   files.DIR, files.DIR:read one of the person's folders (downloads, documents, pictures, music, videos, desktop)
 */

/** The permission for Dashi's power mode on the applets channel. */
export const POWER_MODE_PERMISSION = "power.mode";

/** The permission for controls in Control Center (controls.ts). */
export const CONTROLS_PERMISSION = "controls";

export const FOLDERS = ["downloads", "documents", "pictures", "music", "videos", "desktop"] as const;
export type Folder = (typeof FOLDERS)[number];

export const HARDWARE = ["sensors", "power", "lighting", "fans", "tuning"] as const;
export type HardwareScope = (typeof HARDWARE)[number];

export type Permission =
  | { kind: "network" }
  /** Only these addresses (`network:api.github.com`), through Dashi's proxy: the sandbox has no network of its own. */
  | { kind: "host"; host: string }
  /** The person's account at a provider (`account:github.com`), once connected; the shell keeps the token. */
  | { kind: "account"; provider: string }
  | { kind: "notifications" }
  | { kind: "hardware"; scope: HardwareScope }
  /** Dashi's own power mode, Automatic included (power.ts): the shell checks it; the sandbox gives nothing more. */
  | { kind: "power-mode" }
  /** Tiles in Control Center (controls.ts): drawn by Dashi; grants nothing else. */
  | { kind: "controls" }
  | { kind: "dbus"; bus: "system" | "session"; name: string }
  | { kind: "files"; folder: Folder; write: boolean };

/** A well-known bus name: dots between parts of letters, digits, `_` and `-`. */
/** A host name: letters, digits and `-` between dots, lowercase. */
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Subscriptions Dashi never signs anyone in to, for anything (decisions.md D460): Claude's and ChatGPT's.
 * A key the person pastes into an extension's own preference is theirs to give; an account sign-in is not offered.
 */
const REFUSED_PROVIDERS = ["claude.ai", "anthropic.com", "chatgpt.com", "openai.com"];

/** Whether `provider` is (or is under) one Dashi never signs in to. */
export const refusedProvider = (provider: string): boolean => REFUSED_PROVIDERS.some((each) => provider === each || provider.endsWith(`.${each}`));

const BUS_NAME = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)+$/;

/** Names an applet may not ask for by name: they are the system's to grant, or Dashi's own channels. */
const RESERVED_NAMES = [/^org\.freedesktop\.(DBus|systemd1|login1|PolicyKit1|portal\.)/, /^org\.freedesktop\.secrets$/, /^dev\.dashi\./];

export function parsePermission(value: unknown): Permission | { error: string } {
  if (typeof value !== "string") return { error: "a permission must be a string" };
  if (value === "network") return { kind: "network" };
  if (value === "notifications") return { kind: "notifications" };
  if (value.startsWith("network:")) {
    const host = value.slice("network:".length);
    return HOST.test(host) ? { kind: "host", host } : { error: `“${host}” is not a host name` };
  }
  if (value.startsWith("account:")) {
    const provider = value.slice("account:".length);
    if (!HOST.test(provider)) return { error: `“${provider}” is not a provider's host name` };
    return refusedProvider(provider) ? { error: `Dashi never signs in to ${provider} for an extension` } : { kind: "account", provider };
  }
  if (value === POWER_MODE_PERMISSION) return { kind: "power-mode" };
  if (value === CONTROLS_PERMISSION) return { kind: "controls" };
  const hardware = /^hardware\.([a-z]+)$/.exec(value);
  if (hardware) {
    const scope = HARDWARE.find((each) => each === hardware[1]);
    return scope
      ? { kind: "hardware", scope }
      : { error: `“${value}” is not a hardware permission (${HARDWARE.map((each) => `hardware.${each}`).join(", ")})` };
  }
  const dbus = /^dbus\.(system|session):(.+)$/.exec(value);
  if (dbus) {
    const name = dbus[2] ?? "";
    if (name.length > 255 || !BUS_NAME.test(name)) return { error: `“${name}” is not a D-Bus name` };
    if (RESERVED_NAMES.some((pattern) => pattern.test(name))) return { error: `an applet can't ask for ${name} by name` };
    return { kind: "dbus", bus: dbus[1] === "system" ? "system" : "session", name };
  }
  const files = /^files\.([a-z]+)(:read)?$/.exec(value);
  if (files) {
    const folder = FOLDERS.find((each) => each === files[1]);
    return folder
      ? { kind: "files", folder, write: files[2] === undefined }
      : { error: `“${files[1]}” is not a folder an applet can ask for (${FOLDERS.join(", ")})` };
  }
  return { error: `“${value}” is not a permission` };
}

export function permissionName(permission: Permission): string {
  switch (permission.kind) {
    case "network":
    case "notifications":
      return permission.kind;
    case "host":
      return `network:${permission.host}`;
    case "account":
      return `account:${permission.provider}`;
    case "hardware":
      return `hardware.${permission.scope}`;
    case "power-mode":
      return POWER_MODE_PERMISSION;
    case "controls":
      return CONTROLS_PERMISSION;
    case "dbus":
      return `dbus.${permission.bus}:${permission.name}`;
    case "files":
      return `files.${permission.folder}${permission.write ? "" : ":read"}`;
  }
}

/**
 * The one set of lines for what a program may reach, in plain words: an
 * applet's permissions (here), a Flatpak app's sandbox (Software's trust
 * card), and what apps were allowed through the portal (Settings › Privacy &
 * Security). One thing, one sentence, wherever it is shown.
 */
export const REACH = {
  network: "Use the network",
  notifications: "Show notifications",
  camera: "Use the camera",
  microphone: "Use the microphone",
  sound: "Play sound",
  location: "See your location",
  background: "Run in the background",
  screenshot: "Take screenshots",
  wallpaper: "Change the wallpaper",
} as const;

/** "Read and change files in Downloads", "Read files in Pictures": a folder, by the name a person knows. */
export const folderLine = (name: string, write: boolean): string => `${write ? "Read and change" : "Read"} files in ${name}`;

const FOLDER_NAMES: Record<Folder, string> = {
  downloads: "Downloads",
  documents: "Documents",
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
  desktop: "Desktop",
};

/** Services an applet may name, in words a person knows. */
const KNOWN_SERVICES: Readonly<Record<string, string>> = {
  "xyz.ljones.Asusd": "the ASUS lighting service (asusd)",
  "org.freedesktop.UPower": "the battery service",
  "org.freedesktop.NetworkManager": "the network settings",
  "org.bluez": "Bluetooth",
  "org.mpris.MediaPlayer2": "media players",
};

const HARDWARE_WORDS: Record<HardwareScope, string> = {
  sensors: "Read temperatures, fan speeds and power draw",
  power: "Change the power mode, battery charge limit and processor boost",
  lighting: "Change the keyboard and lid lights",
  fans: "Change fan curves",
  tuning: "Change power limits and undervolt the processor",
};

/** One line on the consent sheet. */
export function describePermission(permission: Permission): string {
  switch (permission.kind) {
    case "network":
      return REACH.network;
    case "host":
      return `Talk to ${permission.host}, and no other address`;
    case "account":
      return `Use your ${permission.provider} account, once you connect it`;
    case "notifications":
      return REACH.notifications;
    case "hardware":
      return HARDWARE_WORDS[permission.scope];
    case "power-mode":
      return "See and choose the power mode, Automatic included";
    case "controls":
      return "Add controls to Control Center";
    case "dbus":
      return `Talk to ${KNOWN_SERVICES[permission.name] ?? permission.name}${permission.bus === "system" ? " on the system" : ""}`;
    case "files":
      return folderLine(FOLDER_NAMES[permission.folder], permission.write);
  }
}

/** Whether using it asks for the person's password (dashi-hardware's `tune` action, auth_admin_keep). */
export const asksForPassword = (permission: Permission): boolean =>
  permission.kind === "hardware" && (permission.scope === "fans" || permission.scope === "tuning");

/** What the sheet says it can't do: the reassuring line under the list. Held to hosts, it can't reach any other. */
export function cannotDo(permissions: readonly Permission[]): string | null {
  const files = permissions.some((each) => each.kind === "files");
  const network = permissions.some((each) => each.kind === "network");
  const held = !network && permissions.some((each) => each.kind === "host");
  if (files && network) return null;
  if (files) return held ? "It can't reach any other address." : "It can't use the network.";
  if (network) return "It can't read your files.";
  return held ? "It can't read your files or reach any other address." : "It can't read your files or use the network.";
}

/** Whether it reaches the network: `network`, or `network:HOST` (then only through the proxy, to those hosts). */
export const usesNetwork = (permission: Permission): boolean => permission.kind === "network" || permission.kind === "host";

/** The hosts it may reach through the proxy (`network:HOST`); none when it has the whole network or no network. */
export const proxiedHosts = (permissions: readonly Permission[]): string[] =>
  permissions.some((each) => each.kind === "network") ? [] : permissions.flatMap((each) => (each.kind === "host" ? [each.host] : []));

/** The consent sheet's list: plain words, in the manifest's order, each once. */
export function consentLines(permissions: readonly Permission[]): string[] {
  return [...new Set(permissions.map(describePermission))];
}

/** Whether `next` asks for anything `granted` didn't (an update that does is asked about again). */
export function widens(granted: readonly string[], next: readonly Permission[]): boolean {
  const had = new Set(granted);
  return next.some((permission) => !had.has(permissionName(permission)));
}
