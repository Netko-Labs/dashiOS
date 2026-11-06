import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Manifest, parseManifest, permissionName } from "@dashi/applet";
import { readInstalled } from "../src/applets/installed.ts";
import { AppletLauncher, type Units, userFolders } from "../src/applets/launcher.ts";
import { busRules, HARDWARE_BUS_NAME, INSIDE, type SandboxPaths, sandboxPlan, unitName } from "../src/applets/sandbox.ts";
import { ExtrasStore } from "../src/extras/index.ts";

const HOME = "/home/alex";
const PATHS: SandboxPaths = {
  appletDir: `${HOME}/.local/share/dashi/applets/dev.example.weather`,
  dataDir: `${HOME}/.local/share/dashi/applet-data/dev.example.weather`,
  home: HOME,
  uid: 1000,
  runtimeDir: "/run/user/1000",
  socketDir: "/run/user/1000/dashi-applets/dev.example.weather",
  wayland: "wayland-1",
  bun: "/usr/libexec/dashi/bin/bun",
  metalHost: "/usr/libexec/dashi/mirin-metal-host",
  appearance: `${HOME}/.local/state/dashi/control-center.json`,
  sessionBus: "unix:path=/run/user/1000/bus",
  systemBus: "unix:path=/run/dbus/system_bus_socket",
  proxyDir: "/run/user/1000/dashi-applets/proxy",
  folders: userFolders(HOME, null),
};

function manifest(permissions: string[]): Manifest {
  const parsed = parseManifest({
    id: "dev.example.weather",
    name: "Weather",
    version: "0.1.0",
    dashi: ">=0.4",
    entry: "src/main.tsx",
    summary: "The weather where you are.",
    author: { name: "Alex Kim" },
    permissions,
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** The value after `flag` each time it appears with `first` as its first value. */
const binds = (args: readonly string[], flag: string): Array<[string, string]> =>
  args.flatMap((arg, at) => (arg === flag ? [[args[at + 1] ?? "", args[at + 2] ?? ""] as [string, string]] : []));
const envOf = (args: readonly string[]): Map<string, string> => new Map(binds(args, "--setenv"));

test("no permissions: no network, no buses, no folders; only /usr, the GPU, its own folder and home, Wayland and its socket", () => {
  const { bwrap, proxy } = sandboxPlan(manifest([]), PATHS);
  expect(proxy).toBeNull();
  expect(bwrap.slice(0, 3)).toEqual(["--die-with-parent", "--new-session", "--unshare-all"]);
  expect(bwrap).not.toContain("--share-net");
  expect(bwrap).toContain("--clearenv");
  const ro = binds(bwrap, "--ro-bind");
  expect(ro).toContainEqual(["/usr", "/usr"]);
  expect(ro).toContainEqual([PATHS.appletDir, INSIDE.app]);
  expect(ro).toContainEqual(["/run/user/1000/wayland-1", "/run/user/1000/wayland-1"]);
  expect(ro).toContainEqual([PATHS.socketDir, INSIDE.socketDir]);
  expect(binds(bwrap, "--bind")).toEqual([[PATHS.dataDir, HOME]]);
  expect(binds(bwrap, "--dev-bind-try")).toEqual([["/dev/dri", "/dev/dri"]]);
  // Never /sys writable, never the session's own sockets, never the person's home itself.
  expect(bwrap.join(" ")).not.toMatch(/--bind(-try)? \/sys/);
  expect(bwrap).not.toContain("/run/user/1000/bus");
  expect(bwrap).not.toContain(INSIDE.systemBus);
  expect(bwrap).not.toContain("/run/user/1000/dashi-comp.sock");
  expect(bwrap).not.toContain("/etc/resolv.conf");
  const env = envOf(bwrap);
  expect(env.get("DASHI_APPLETS_SOCKET")).toBe(`${INSIDE.socketDir}/applets.sock`);
  expect(env.get("DASHI_METAL_HOST")).toBe(INSIDE.metalHost);
  expect(env.has("DBUS_SESSION_BUS_ADDRESS")).toBe(false);
  expect(env.has("DBUS_SYSTEM_BUS_ADDRESS")).toBe(false);
  expect(bwrap.slice(-3)).toEqual(["--", INSIDE.bun, "/app/main.js"]);
});

test("network shares the network and shows the resolver and certificates", () => {
  const { bwrap } = sandboxPlan(manifest(["network"]), PATHS);
  expect(bwrap).toContain("--share-net");
  expect(binds(bwrap, "--ro-bind-try")).toContainEqual(["/etc/resolv.conf", "/etc/resolv.conf"]);
  expect(binds(bwrap, "--ro-bind-try")).toContainEqual(["/etc/pki", "/etc/pki"]);
});

test("notifications: the session bus through the proxy, talking to Notifications only", () => {
  const { bwrap, proxy } = sandboxPlan(manifest(["notifications"]), PATHS);
  expect(proxy?.args).toEqual([
    "unix:path=/run/user/1000/bus",
    "/run/user/1000/dashi-applets/proxy/dev.example.weather.session",
    "--filter",
    "--talk=org.freedesktop.Notifications",
  ]);
  expect(binds(bwrap, "--ro-bind")).toContainEqual(["/run/user/1000/dashi-applets/proxy/dev.example.weather.session", "/run/user/1000/bus"]);
  expect(envOf(bwrap).get("DBUS_SESSION_BUS_ADDRESS")).toBe("unix:path=/run/user/1000/bus");
  expect(envOf(bwrap).has("DBUS_SYSTEM_BUS_ADDRESS")).toBe(false);
});

test("hardware: the system bus through the proxy, dashi-hardware's methods for that scope only", () => {
  const call = (method: string): string => `--call=${HARDWARE_BUS_NAME}=${HARDWARE_BUS_NAME}.${method}@/dev/dashi/Hardware1`;
  const sensors = busRules(manifest(["hardware.sensors"]).permissions).system;
  expect(sensors).toContain(call("Describe"));
  expect(sensors).toContain(call("Get"));
  expect(sensors).not.toContain(call("Set"));
  expect(sensors).toContain(`--broadcast=${HARDWARE_BUS_NAME}=${HARDWARE_BUS_NAME}.Changed@/dev/dashi/Hardware1`);
  const power = busRules(manifest(["hardware.power"]).permissions).system;
  expect(power).toContain(call("SetMany"));
  expect(power).not.toContain(call("SetFanCurve"));
  expect(power).not.toContain(call("SetCurveOptimizer"));
  const fans = busRules(manifest(["hardware.fans"]).permissions).system;
  expect(fans).toContain(call("SetFanCurve"));
  expect(fans).not.toContain(call("Set"));
  const tuning = busRules(manifest(["hardware.tuning"]).permissions).system;
  expect(tuning).toContain(call("SetCurveOptimizer"));
  expect(tuning).toContain(call("ConfirmTuning"));
  // Never --talk to dashi-hardware: only the calls listed.
  expect([...sensors, ...power, ...fans, ...tuning].some((rule) => rule.startsWith(`--talk=${HARDWARE_BUS_NAME}`))).toBe(false);
  const { bwrap } = sandboxPlan(manifest(["hardware.power"]), PATHS);
  expect(binds(bwrap, "--ro-bind")).toContainEqual(["/run/user/1000/dashi-applets/proxy/dev.example.weather.system", INSIDE.systemBus]);
  // The sensors, read-only, with any hardware scope; not without one.
  expect(binds(bwrap, "--ro-bind-try")).toContainEqual(["/sys/class/hwmon", "/sys/class/hwmon"]);
  expect(binds(sandboxPlan(manifest([]), PATHS).bwrap, "--ro-bind-try")).not.toContainEqual(["/sys/class/hwmon", "/sys/class/hwmon"]);
  expect(envOf(bwrap).get("DBUS_SYSTEM_BUS_ADDRESS")).toBe(`unix:path=${INSIDE.systemBus}`);
});

test("a named service: that bus, that name", () => {
  const { proxy } = sandboxPlan(manifest(["dbus.system:xyz.ljones.Asusd", "dbus.session:org.example.Sync"]), PATHS);
  expect(proxy?.args).toEqual([
    "unix:path=/run/user/1000/bus",
    "/run/user/1000/dashi-applets/proxy/dev.example.weather.session",
    "--filter",
    "--talk=org.example.Sync",
    "unix:path=/run/dbus/system_bus_socket",
    "/run/user/1000/dashi-applets/proxy/dev.example.weather.system",
    "--filter",
    "--talk=xyz.ljones.Asusd",
  ]);
});

test("folders: read-write or read-only, at the same place in its home", () => {
  const { bwrap } = sandboxPlan(manifest(["files.downloads", "files.pictures:read"]), PATHS);
  expect(binds(bwrap, "--bind-try")).toEqual([[`${HOME}/Downloads`, `${HOME}/Downloads`]]);
  expect(binds(bwrap, "--ro-bind-try")).toContainEqual([`${HOME}/Pictures`, `${HOME}/Pictures`]);
  expect(bwrap).not.toContain(`${HOME}/Documents`);
  const folders = userFolders(HOME, 'XDG_DOWNLOAD_DIR="$HOME/Descargas"\n# comment\n');
  expect(folders.downloads).toBe(`${HOME}/Descargas`);
  expect(folders.music).toBe(`${HOME}/Music`);
});

function installedTree(consent: string[] | null, disabled?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "dashi-applets-"));
  const dir = join(root, "dev.example.weather");
  mkdirSync(dir);
  const m = manifest(["network"]);
  writeFileSync(join(dir, "applet.json"), JSON.stringify({ ...m, permissions: m.permissions.map(permissionName) }));
  writeFileSync(join(dir, "main.js"), "");
  writeFileSync(
    join(dir, "install.json"),
    JSON.stringify({ version: "0.1.0", sha256: "x", authorKey: null, source: "local", consent: consent ?? [], ...(disabled ? { disabled } : {}) }),
  );
  return root;
}

function fakeUnits() {
  const log: string[] = [];
  const units: Units = {
    start: async (unit, argv) => {
      log.push(`start ${unit} ${argv.at(-1)?.split("/").at(-1)}`);
      return true;
    },
    stop: async (unit) => {
      log.push(`stop ${unit}`);
    },
  };
  return { log, units };
}

function launcher(root: string, units: Units, askConsent?: () => Promise<boolean>) {
  const runtime = mkdtempSync(join(tmpdir(), "dashi-runtime-"));
  return new AppletLauncher({
    root,
    dataRoot: join(root, "..", "data"),
    runtimeDir: runtime,
    context: { extras: new ExtrasStore() },
    bun: "/usr/bin/bun",
    metalHost: "/usr/libexec/dashi/mirin-metal-host",
    runScript: "/usr/share/dashi/shell/bin/dashi-applet-run.ts",
    dashiVersion: "0.4.0",
    env: { WAYLAND_DISPLAY: "wayland-1" },
    home: HOME,
    ...(askConsent ? { askConsent } : {}),
    units,
  });
}

test("the launcher runs an allowed applet in its unit, asks once about one that isn't, and stops what goes", async () => {
  const allowed = installedTree(["network"]);
  const { log, units } = fakeUnits();
  const running = launcher(allowed, units);
  await running.reconcile();
  expect(log).toEqual([`stop ${unitName("dev.example.weather")}`, `start ${unitName("dev.example.weather")} dev.example.weather.json`]);
  expect(running.runningIds()).toEqual(["dev.example.weather"]);
  await running.stop();
  expect(log.at(-1)).toBe(`stop ${unitName("dev.example.weather")}`);

  const unasked = installedTree(null);
  const second = fakeUnits();
  let asked = 0;
  const askingNo = launcher(unasked, second.units, async () => {
    asked++;
    return false;
  });
  await askingNo.reconcile();
  await askingNo.reconcile();
  expect(asked).toBe(1);
  expect(second.log).toEqual([]);

  const askingYes = launcher(unasked, second.units, async () => true);
  await askingYes.reconcile();
  expect(readInstalled(unasked)[0]?.record.consent).toEqual(["network"]);
  expect(askingYes.runningIds()).toEqual(["dev.example.weather"]);
  await askingYes.stop();

  const pulled = installedTree(["network"], { reason: "pulled", detail: "drains the battery" });
  const third = fakeUnits();
  const off = launcher(pulled, third.units);
  await off.reconcile();
  expect(off.runningIds()).toEqual([]);
  expect(third.log).toEqual([]);
});
