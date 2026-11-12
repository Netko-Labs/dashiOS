/**
 * Runs the installed applets (installed.ts), each in its sandbox
 * (sandbox.ts), each with a socket of its own the shell listens on
 * (server.ts) and checks its hello against. An applet runs when the person
 * allowed what it asks for (asked once, on the consent sheet), it isn't
 * disabled (pulled from the catalog, or turned off), and it is for this
 * Dashi. The folder is watched: what Software installs, updates,
 * disables, or removes is started, restarted, or stopped here.
 *
 * Each runs as a systemd user unit (`dashi-applet-<id>.service`), so it is
 * not a process under the shell: the compositor's trust in the shell's
 * processes never reaches an applet (docs/applets.md, "The sandbox").
 */

import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consentNames, dashiSatisfies, FOLDERS, type Folder, type InstalledApplet, isAllowed, readInstalled, shouldRun, writeRecord } from "@dashi/applet";
import type { AppletContext } from "./lib/connection-context.ts";
import { type SandboxPaths, sandboxPlan, unitName } from "./lib/sandbox.ts";
import { appletSocketDir, ensureSocketDir, serveApplets } from "./lib/server.ts";
import { systemdUnits, type Units } from "./units.ts";

/** The person's folders from `~/.config/user-dirs.dirs`, else the usual names. */
export function userFolders(home: string, text: string | null): Record<Folder, string> {
  const keys: Record<Folder, [string, string]> = {
    downloads: ["XDG_DOWNLOAD_DIR", "Downloads"],
    documents: ["XDG_DOCUMENTS_DIR", "Documents"],
    pictures: ["XDG_PICTURES_DIR", "Pictures"],
    music: ["XDG_MUSIC_DIR", "Music"],
    videos: ["XDG_VIDEOS_DIR", "Videos"],
    desktop: ["XDG_DESKTOP_DIR", "Desktop"],
  };
  const given = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    const match = /^(XDG_[A-Z]+_DIR)="(.*)"$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) given.set(match[1], match[2].replace(/^\$HOME/, home));
  }
  return Object.fromEntries(FOLDERS.map((folder) => [folder, given.get(keys[folder][0]) ?? join(home, keys[folder][1])])) as Record<Folder, string>;
}

export interface LauncherOptions {
  root: string;
  dataRoot: string;
  runtimeDir: string;
  context: Omit<AppletContext, "installed">;
  bun: string;
  metalHost: string;
  /** bin/dashi-applet-run.ts */
  runScript: string;
  dashiVersion: string;
  env?: Record<string, string | undefined>;
  home?: string;
  /** The consent sheet; resolves with the person's answer. */
  askConsent?(applet: InstalledApplet, update: boolean): Promise<boolean>;
  /** The applets that run, after each look: their commands are indexed. */
  onInstalled?(applets: readonly InstalledApplet[]): void;
  units?: Units;
}

interface Running {
  version: string;
  /** The package it runs from: the same version installed again from new bytes (a rebuild) is another. */
  sha256: string;
  stopSocket: () => void;
}

export class AppletLauncher {
  private readonly running = new Map<string, Running>();
  /** `id@version`s already asked about this session: a "no" isn't asked again until it changes. */
  private readonly asked = new Set<string>();
  private readonly units: Units;
  private watcher: ReturnType<typeof watch> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: LauncherOptions) {
    this.units = options.units ?? systemdUnits;
  }

  start(): void {
    mkdirSync(this.options.root, { recursive: true });
    this.schedule(0);
    try {
      this.watcher = watch(this.options.root, { recursive: true }, () => this.schedule(300));
    } catch {
      this.watcher = null;
    }
  }

  /** Looks again soon (the store calls through the folder, so a burst of writes is one look). */
  schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.busy = this.busy.then(() => this.reconcile()).catch((error) => console.error("dashi-shell: applets:", error));
    }, ms);
  }

  /** Brings what runs in line with what is installed. */
  async reconcile(): Promise<void> {
    const installed = readInstalled(this.options.root).filter((applet) => dashiSatisfies(applet.manifest.dashi, this.options.dashiVersion));
    const ids = new Set(installed.map((applet) => applet.manifest.id));
    for (const id of [...this.running.keys()]) if (!ids.has(id)) await this.halt(id);
    for (const applet of installed) {
      if (this.stopped) return;
      const { id, version } = applet.manifest;
      if (!isAllowed(applet) && applet.record.disabled === undefined && !this.asked.has(`${id}@${version}`)) {
        this.asked.add(`${id}@${version}`);
        const yes = (await this.options.askConsent?.(applet, applet.record.consent.length > 0)) ?? false;
        if (yes) {
          applet.record = { ...applet.record, consent: consentNames(applet.manifest) };
          writeRecord(applet.dir, applet.record);
        }
      }
      const current = this.running.get(id);
      if (!shouldRun(applet)) {
        if (current) await this.halt(id);
        continue;
      }
      // Installed again (an update, or the same version rebuilt): the new files run, not the old process.
      if (current?.version === version && current.sha256 === applet.record.sha256) continue;
      if (current) await this.halt(id);
      await this.launch(applet);
    }
    // Their commands are in the launcher from now on, running or not (applets/commands.ts).
    this.options.onInstalled?.(installed.filter(shouldRun));
  }

  private paths(applet: InstalledApplet): SandboxPaths {
    const env = this.options.env ?? process.env;
    const home = this.options.home ?? homedir();
    const runtime = this.options.runtimeDir;
    const dataDir = join(this.options.dataRoot, applet.manifest.id);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const proxyDir = join(appletSocketDir(runtime), "proxy");
    mkdirSync(proxyDir, { recursive: true, mode: 0o700 });
    const userDirs = join(env.XDG_CONFIG_HOME || join(home, ".config"), "user-dirs.dirs");
    return {
      appletDir: applet.dir,
      dataDir,
      home,
      uid: process.getuid?.() ?? 1000,
      runtimeDir: runtime,
      socketDir: join(appletSocketDir(runtime), applet.manifest.id),
      wayland: env.WAYLAND_DISPLAY ?? "wayland-0",
      bun: this.options.bun,
      metalHost: this.options.metalHost,
      appearance: join(env.XDG_STATE_HOME || join(home, ".local/state"), "dashi/control-center.json"),
      sessionBus: env.DBUS_SESSION_BUS_ADDRESS ?? null,
      systemBus: env.DBUS_SYSTEM_BUS_ADDRESS ?? "unix:path=/run/dbus/system_bus_socket",
      proxyDir,
      folders: userFolders(home, existsSync(userDirs) ? readFileSync(userDirs, "utf8") : null),
      ...(env.LANG ? { lang: env.LANG } : {}),
    };
  }

  private async launch(applet: InstalledApplet): Promise<void> {
    const { id, version } = applet.manifest;
    const paths = this.paths(applet);
    ensureSocketDir(this.options.runtimeDir);
    mkdirSync(paths.socketDir, { recursive: true, mode: 0o700 });
    const stopSocket = serveApplets({ ...this.options.context, path: join(paths.socketDir, "applets.sock"), installed: applet.manifest, maxConnections: 1 });
    this.running.set(id, { version, sha256: applet.record.sha256, stopSocket });
    const plans = join(appletSocketDir(this.options.runtimeDir), "plans");
    mkdirSync(plans, { recursive: true, mode: 0o700 });
    const planPath = join(plans, `${id}.json`);
    writeFileSync(planPath, JSON.stringify(sandboxPlan(applet.manifest, paths)), { mode: 0o600 });
    // One left from a shell that didn't stop it (a crash) goes first.
    await this.units.stop(unitName(id));
    // The shell went meanwhile: what it stopped stays stopped.
    if (this.stopped) return;
    const started = await this.units.start(unitName(id), [this.options.bun, this.options.runScript, planPath]);
    if (!started) console.error(`dashi-shell: applet ${id} didn't start`);
  }

  private async halt(id: string): Promise<void> {
    const current = this.running.get(id);
    this.running.delete(id);
    current?.stopSocket();
    await this.units.stop(unitName(id));
  }

  /**
   * Starts an installed applet again that isn't connected (its tile in
   * Control Center was pressed): only one that may run here.
   */
  wake(id: string): void {
    if (this.stopped) return;
    this.busy = this.busy
      .then(async () => {
        const applet = readInstalled(this.options.root).find((each) => each.manifest.id === id);
        if (!applet || !shouldRun(applet) || !dashiSatisfies(applet.manifest.dashi, this.options.dashiVersion)) return;
        await this.halt(id);
        await this.launch(applet);
      })
      .catch((error) => console.error(`dashi-shell: applet ${id}:`, error));
  }

  /**
   * The shell is going: every applet stops with it. Nothing here is awaited:
   * the shell's closers run in one turn and the process exits after them
   * (main.tsx `quit`), so systemd is asked before this returns.
   */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close();
    const ids = [...this.running.keys()];
    for (const id of ids) this.running.get(id)?.stopSocket();
    this.running.clear();
    this.units.stopNow(ids.map(unitName));
  }

  /** What runs now, for Settings and tests. */
  runningIds(): string[] {
    return [...this.running.keys()];
  }
}
