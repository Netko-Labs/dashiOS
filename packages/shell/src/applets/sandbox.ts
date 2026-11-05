/**
 * The sandbox an installed applet runs in: bubblewrap with only what its
 * manifest asks for (permissions.ts in @dashi/applet). Always: the system's
 * read-only /usr, the GPU for its Metal host, its own read-only folder at
 * /app, a private home (its data folder), the Wayland socket, and its own
 * applets socket. Nothing else unless asked:
 *
 *   network          the network namespace is shared (and /etc's resolver and certificates shown)
 *   notifications    the session bus, through xdg-dbus-proxy, talking only to org.freedesktop.Notifications
 *   hardware.*       the system bus, through xdg-dbus-proxy, calling only dashi-hardware's methods for that
 *                    scope (docs/hardware.md); dashi-hardware's polkit actions still decide; never /sys writes
 *   dbus.BUS:NAME    that bus, through the proxy, talking only to NAME
 *   files.DIR[:read] that folder, read-write (or read-only)
 *
 * This module only plans: the argument lists are pure, and tested per
 * permission (test/applets-sandbox.test.ts). launcher.ts runs them.
 */

import type { Folder, HardwareScope, Manifest, Permission } from "@dashi/applet";

/** dashi-hardware's name and object (docs/hardware.md). */
export const HARDWARE_BUS_NAME = "dev.dashi.Hardware1";
const HARDWARE_PATH = "/dev/dashi/Hardware1";

/** The methods each hardware scope may call; reading (sensors) comes with every scope. */
export const HARDWARE_METHODS: Readonly<Record<HardwareScope, readonly string[]>> = {
  sensors: ["Describe", "Get", "GetFanCurve", "CurveOptimizer", "BootGuard"],
  power: ["Set", "SetMany"],
  lighting: ["Set"],
  fans: ["GetFanCurve", "SetFanCurve", "ResetFanCurves"],
  tuning: ["Set", "SetMany", "SetCurveOptimizer", "ConfirmTuning", "ClearSavedTuning"],
};

/** Inside the sandbox. */
export const INSIDE = {
  app: "/app",
  bun: "/run/applet/bun",
  metalHost: "/run/applet/mirin-metal-host",
  /** The folder the shell's socket for this applet is in (a folder, so a restarted shell's new socket shows). */
  socketDir: "/run/applet/socket",
  systemBus: "/run/dbus/system_bus_socket",
} as const;

export interface SandboxPaths {
  /** ~/.local/share/dashi/applets/<id> */
  appletDir: string;
  /** ~/.local/share/dashi/applet-data/<id>: the applet's home inside. */
  dataDir: string;
  /** The person's home, the path HOME is inside too. */
  home: string;
  uid: number;
  /** $XDG_RUNTIME_DIR */
  runtimeDir: string;
  /** The folder holding this applet's own `applets.sock`. */
  socketDir: string;
  /** The Wayland socket's name in the runtime directory ("wayland-1"). */
  wayland: string;
  bun: string;
  metalHost: string;
  /** The shell's Dark Mode switch (control-center.json), shown read-only. */
  appearance: string;
  /** The session bus's address, for the proxy. */
  sessionBus: string | null;
  systemBus: string;
  /** Where the proxy's sockets go (outside the sandbox). */
  proxyDir: string;
  /** The person's folders (XDG user dirs). */
  folders: Readonly<Record<Folder, string>>;
  lang?: string;
}

/** One xdg-dbus-proxy invocation: `xdg-dbus-proxy` + args. */
export interface ProxyPlan {
  args: string[];
  /** The sockets it makes, which must exist before bwrap starts. */
  sockets: string[];
}

export interface SandboxPlan {
  proxy: ProxyPlan | null;
  bwrap: string[];
}

const FOLDER_DIRS: Readonly<Record<Folder, string>> = {
  downloads: "Downloads",
  documents: "Documents",
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
  desktop: "Desktop",
};

/** The proxy's filter for each bus: `--talk=` names and `--call=` rules. */
export function busRules(permissions: readonly Permission[]): { session: string[]; system: string[] } {
  const session = new Set<string>();
  const system = new Set<string>();
  const methods = new Set<string>();
  for (const permission of permissions) {
    if (permission.kind === "notifications") session.add("--talk=org.freedesktop.Notifications");
    if (permission.kind === "dbus") (permission.bus === "system" ? system : session).add(`--talk=${permission.name}`);
    if (permission.kind === "hardware") {
      for (const method of [...HARDWARE_METHODS.sensors, ...HARDWARE_METHODS[permission.scope]]) methods.add(method);
    }
  }
  if (methods.size > 0) {
    // Only these calls, on dashi-hardware's one object; its Changed signal comes through.
    for (const method of [...methods].sort()) system.add(`--call=${HARDWARE_BUS_NAME}=${HARDWARE_BUS_NAME}.${method}@${HARDWARE_PATH}`);
    system.add(`--broadcast=${HARDWARE_BUS_NAME}=${HARDWARE_BUS_NAME}.Changed@${HARDWARE_PATH}`);
  }
  return { session: [...session], system: [...system] };
}

export function proxyPlan(id: string, permissions: readonly Permission[], paths: SandboxPaths): ProxyPlan | null {
  const rules = busRules(permissions);
  const args: string[] = [];
  const sockets: string[] = [];
  if (rules.session.length > 0 && paths.sessionBus) {
    const socket = `${paths.proxyDir}/${id}.session`;
    args.push(paths.sessionBus, socket, "--filter", ...rules.session);
    sockets.push(socket);
  }
  if (rules.system.length > 0) {
    const socket = `${paths.proxyDir}/${id}.system`;
    args.push(paths.systemBus, socket, "--filter", ...rules.system);
    sockets.push(socket);
  }
  return args.length > 0 ? { args, sockets } : null;
}

/** bubblewrap's arguments for `manifest` (the command at the end). */
export function sandboxPlan(manifest: Manifest, paths: SandboxPaths): SandboxPlan {
  const { permissions } = manifest;
  const has = (kind: Permission["kind"]): boolean => permissions.some((each) => each.kind === kind);
  const network = has("network");
  const proxy = proxyPlan(manifest.id, permissions, paths);
  const sessionSocket = proxy?.sockets.find((socket) => socket.endsWith(".session"));
  const systemSocket = proxy?.sockets.find((socket) => socket.endsWith(".system"));
  const runtime = paths.runtimeDir;
  const args: string[] = ["--die-with-parent", "--new-session", "--unshare-all"];
  if (network) args.push("--share-net");
  args.push("--clearenv", "--ro-bind", "/usr", "/usr");
  for (const [link, target] of [
    ["/bin", "usr/bin"],
    ["/sbin", "usr/sbin"],
    ["/lib", "usr/lib"],
    ["/lib64", "usr/lib64"],
  ] as const)
    args.push("--symlink", target, link);
  // What libraries and fonts read from /etc; the GPU's driver lists.
  for (const path of ["/etc/ld.so.cache", "/etc/fonts", "/etc/alternatives", "/etc/vulkan", "/etc/glvnd", "/etc/egl", "/var/cache/fontconfig"])
    args.push("--ro-bind-try", path, path);
  if (network)
    for (const path of ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/pki", "/etc/ssl", "/etc/crypto-policies"])
      args.push("--ro-bind-try", path, path);
  args.push("--proc", "/proc", "--dev", "/dev", "--dev-bind-try", "/dev/dri", "/dev/dri");
  // The GPU's driver finds its device here; read-only, and nothing is written through it.
  args.push("--ro-bind-try", "/sys/dev/char", "/sys/dev/char", "--ro-bind-try", "/sys/devices", "/sys/devices");
  args.push("--tmpfs", "/tmp", "--perms", "0700", "--dir", runtime);
  args.push("--ro-bind", `${runtime}/${paths.wayland}`, `${runtime}/${paths.wayland}`);
  args.push("--ro-bind", paths.socketDir, INSIDE.socketDir);
  if (sessionSocket) args.push("--ro-bind", sessionSocket, `${runtime}/bus`);
  if (systemSocket) args.push("--ro-bind", systemSocket, INSIDE.systemBus);
  args.push("--ro-bind", paths.appletDir, INSIDE.app);
  args.push("--ro-bind", paths.bun, INSIDE.bun, "--ro-bind", paths.metalHost, INSIDE.metalHost);
  args.push("--bind", paths.dataDir, paths.home);
  args.push("--ro-bind-try", paths.appearance, `${paths.home}/.local/state/dashi/control-center.json`);
  for (const permission of permissions) {
    if (permission.kind !== "files") continue;
    args.push(permission.write ? "--bind-try" : "--ro-bind-try", paths.folders[permission.folder], `${paths.home}/${FOLDER_DIRS[permission.folder]}`);
  }
  const env: Array<[string, string]> = [
    ["HOME", paths.home],
    ["PATH", "/usr/bin"],
    ["LANG", paths.lang ?? "C.UTF-8"],
    ["XDG_RUNTIME_DIR", runtime],
    ["XDG_SESSION_TYPE", "wayland"],
    ["WAYLAND_DISPLAY", paths.wayland],
    ["DASHI_APPLETS_SOCKET", `${INSIDE.socketDir}/applets.sock`],
    ["DASHI_METAL_HOST", INSIDE.metalHost],
    ["DASHI_APPLET_MANIFEST", `${INSIDE.app}/applet.json`],
    ["DASHI_APPLET_ID", manifest.id],
  ];
  if (sessionSocket) env.push(["DBUS_SESSION_BUS_ADDRESS", `unix:path=${runtime}/bus`]);
  if (systemSocket) env.push(["DBUS_SYSTEM_BUS_ADDRESS", `unix:path=${INSIDE.systemBus}`]);
  for (const [key, value] of env) args.push("--setenv", key, value);
  args.push("--chdir", INSIDE.app, "--", INSIDE.bun, `${INSIDE.app}/main.js`);
  return { proxy, bwrap: args };
}

/** A systemd unit name for an applet: its id is already safe (reverse-DNS, lowercase). */
export const unitName = (id: string): string => `dashi-applet-${id}.service`;
