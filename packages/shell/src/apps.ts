/**
 * Dashi's own app list (the first installed choice of each), which the Dock
 * starts with, starting an app, and how a click on an icon maps to an action. What the Dock shows and
 * keeps lives in dock/.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Toplevel } from "@mirinjs/metal";
import { firstPartyApps } from "./first-party.ts";
import { chooseGpu, readCards } from "./gpu.ts";
import { type GpuEnvs, gpuEnvs, launchEnvFor } from "./gpu-env.ts";

export interface App {
  /** The app id its windows report (xdg-toplevel app_id). */
  id: string;
  name: string;
  /** Full-color SVG or PNG path. */
  icon: string;
  /** Command line; absent for running apps the Dock cannot relaunch. */
  exec?: readonly string[];
  env?: Readonly<Record<string, string>>;
  /** Working directory; Bun apps read their tsconfig and bunfig from it. */
  cwd?: string;
  /** Its desktop entry asks for the discrete GPU (`PrefersNonDefaultGPU`; gpu-env.ts). */
  gpu?: "discrete";
}

const icons = new URL("../icons/", import.meta.url).pathname;
const mirin = new URL("../../../../mirin/", import.meta.url).pathname;

export function iconPath(name: string): string {
  return `${icons}${name}.svg`;
}

/** The Metal host binary every Metal app (and the shell) runs on. */
export const METAL_HOST = process.env.DASHI_METAL_HOST ?? `${mirin}crates/mirin-metal/target/release/mirin-metal-host`;

interface Choice {
  id: string;
  exec: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  /** A terminal's: what goes between its command line and a program it is to run (`-e`). */
  runs?: readonly string[];
}

interface PinnedSpec {
  name: string;
  icon: string;
  /** Alternatives in preference order; the first installed one is pinned. */
  choices: readonly Choice[];
  /** In the launcher, but not in a new Dock: a developer's tool. */
  inDock?: false;
}

const shellRoot = new URL("../", import.meta.url).pathname;

const PINNED: readonly PinnedSpec[] = [
  {
    name: "Files",
    icon: "files",
    choices: [
      // Dashi's own Files (apps/files) is the file manager: it replaces Nautilus.
      { id: "dev.dashi.files", exec: [process.execPath, `${shellRoot}apps/files/main.tsx`], cwd: shellRoot },
    ],
  },
  {
    // The @dashi/ui gallery (apps/components): a developer's tool, so it is in the launcher, not the Dock.
    name: "Components",
    icon: "components",
    inDock: false,
    choices: [{ id: "dev.dashi.components", exec: [process.execPath, `${shellRoot}apps/components/main.tsx`], cwd: shellRoot }],
  },
  {
    name: "Terminal",
    icon: "terminal",
    choices: [
      // Dashi's own (apps/terminal, on dashi-term and Ghostty's libghostty-vt); the others are fallbacks.
      { id: "dev.dashi.terminal", exec: [process.execPath, `${shellRoot}apps/terminal/main.tsx`], cwd: shellRoot, runs: ["--"] },
      { id: "foot", exec: ["foot"], runs: ["--"] },
      { id: "org.kde.konsole", exec: ["konsole"], runs: ["-e"] },
      { id: "Alacritty", exec: ["alacritty"], runs: ["-e"] },
    ],
  },
  {
    name: "Text Editor",
    icon: "editor",
    choices: [
      // Dashi's own Text Editor (apps/editor); the others only where it isn't here.
      { id: "dev.dashi.editor", exec: [process.execPath, `${shellRoot}apps/editor/main.tsx`], cwd: shellRoot },
      { id: "org.gnome.TextEditor", exec: ["gnome-text-editor"] },
      { id: "org.kde.kate", exec: ["kate"] },
    ],
  },
  {
    name: "Browser",
    icon: "browser",
    // Helium (helium.computer, Chromium-based) is Dashi's browser.
    choices: [{ id: "helium", exec: ["helium", "--ozone-platform=wayland"] }],
  },
];

const NOT_IN_DOCK: ReadonlySet<string> = new Set(PINNED.filter((spec) => spec.inDock === false).flatMap((spec) => spec.choices.map((choice) => choice.id)));

/** The app ids a Dock starts with, before the person keeps or removes any: Dashi's own list, less the developer tools. */
export function dockDefaults(apps: readonly Pick<App, "id">[]): string[] {
  return apps.filter((app) => !NOT_IN_DOCK.has(app.id)).map((app) => app.id);
}

/** Whether a command's program (and, for scripts, the script) is installed. */
function isInstalled(exec: readonly string[], which: (program: string) => string | null): boolean {
  const [program, script] = exec;
  if (!program || !which(program)) return false;
  return !script?.endsWith(".tsx") || existsSync(script);
}

export function resolvePinned(which: (program: string) => string | null = (program) => Bun.which(program)): App[] {
  return PINNED.flatMap((spec) => {
    const choice = spec.choices.find((candidate) => isInstalled(candidate.exec, which));
    if (!choice) return [];
    return [
      {
        id: choice.id,
        name: spec.name,
        icon: iconPath(spec.icon),
        exec: choice.exec,
        env: choice.env,
        cwd: choice.cwd,
      },
    ];
  });
}

/**
 * How to run `argv` in a terminal window (an app whose desktop entry says
 * `Terminal=true`, as htop's does): the pinned Terminal with the program
 * after its `--` or `-e`, in its folder; null when no terminal is installed.
 */
export function inTerminal(
  argv: readonly string[],
  which: (program: string) => string | null = (program) => Bun.which(program),
): Pick<App, "exec" | "cwd" | "env"> | null {
  const terminal = PINNED.find((spec) => spec.icon === "terminal")?.choices.find((choice) => choice.runs && isInstalled(choice.exec, which));
  if (!terminal?.runs || argv.length === 0) return null;
  return {
    exec: [...terminal.exec, ...terminal.runs, ...argv],
    ...(terminal.cwd ? { cwd: terminal.cwd } : {}),
    ...(terminal.env ? { env: terminal.env } : {}),
  };
}

/** The app id System Settings' window reports. */
export const SETTINGS_APP_ID = "dev.dashi.settings";
/** The app id the Setup Assistant's window reports. */
export const SETUP_APP_ID = "dev.dashi.setup";
/** Screenshot, an app the shell opens: ⇧❖5's toolbar, listed with the apps so it can be found and kept in the Dock. */
export const SCREENSHOT_APP_ID = "dev.dashi.screenshot";
/** The app id of a nested Dashi's window: dashi-comp inside another desktop (comp/src/winit.rs). */
export const NESTED_APP_ID = "dev.dashi.nested";

/**
 * Apps the shell runs inside its own process: there is no command to start,
 * so the shell registers what opens each one (`registerShellApp`) and
 * `launch` calls it. They are in the launcher, and their windows are named
 * and drawn properly in the Dock and menu bar.
 */
const SHELL_APPS: readonly App[] = [
  { id: SETTINGS_APP_ID, name: "System Settings", icon: iconPath("settings") },
  { id: SETUP_APP_ID, name: "Setup Assistant", icon: iconPath("setup") },
  { id: SCREENSHOT_APP_ID, name: "Screenshot", icon: iconPath("screenshot") },
  // Never registered, so never in the launcher; named and drawn with the bowl in the Dock and menu bar.
  { id: NESTED_APP_ID, name: "Dashi (nested)", icon: iconPath("setup") },
];

const shellOpeners = new Map<string, () => void>();

/** Teach `launch` to open the shell app `id`; returns the function that takes it back. */
export function registerShellApp(id: string, open: () => void): () => void {
  shellOpeners.set(id, open);
  return () => {
    if (shellOpeners.get(id) === open) shellOpeners.delete(id);
  };
}

/** How the launcher draws and finds a shell entry, beyond its `App` (a Settings pane: its glyph, what it holds). */
export interface ShellEntryLook {
  /** A one-color SVG drawn on a neutral tile in place of `icon`. */
  glyph?: string;
  /** A few muted words after the name, on the same line ("Dark Mode, accent, corners"). */
  detail?: string;
  /** Words it answers to only when nothing else matches ("settings" for a pane). */
  fallbackKeywords?: readonly string[];
}

/** Other things the launcher finds that open in the shell (a Settings pane), with the words they answer to. */
const shellEntries = new Map<string, { app: App; keywords: readonly string[]; look: ShellEntryLook }>();

/** Add a launcher entry that opens in the shell; returns the function that takes it back. */
export function registerShellEntry(app: App, keywords: readonly string[], open: () => void, look: ShellEntryLook = {}): () => void {
  const unregister = registerShellApp(app.id, open);
  shellEntries.set(app.id, { app, keywords, look });
  return () => {
    unregister();
    shellEntries.delete(app.id);
  };
}

/** The registered shell entries, each with its words and its look. */
export function shellEntryList(): Array<App & ShellEntryLook & { keywords: string[] }> {
  return [...shellEntries.values()].map(({ app, keywords, look }) => ({ ...app, ...look, keywords: [...keywords] }));
}

/** One of the shell's own apps or a first-party one, whether or not it can be opened from here (a window's app). */
export function ownApp(appId: string): App | undefined {
  return SHELL_APPS.find((app) => app.id === appId) ?? firstPartyApps().find((app) => app.id === appId);
}

/** The shell's own apps that are installed, i.e. have something registered to open them. */
export function shellApps(): App[] {
  return SHELL_APPS.filter((app) => shellOpeners.has(app.id)).map((app) => ({ ...app }));
}

/** Applets' own names, by their id (an applet's window has its id as app id): from its hello (applets/connection.ts). */
const appletNames = new Map<string, string>();

/** An applet said who it is: its windows are called by its manifest's name. */
export function nameApplet(id: string, name: string): void {
  if (name.trim() !== "") appletNames.set(id, name.trim());
}

/** "org.kde.konsole" → "Konsole" (an applet by its own name); falls back to the window title. */
export function displayName(appId: string, title: string): string {
  const applet = appletNames.get(appId);
  if (applet) return applet;
  const last = appId.split(".").filter(Boolean).at(-1);
  if (!last) return title || "Untitled";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * The app a window belongs to: a pinned one, the shell's or a first-party one,
 * the installed app `installed` finds for its app id (the Dock's match, so the
 * menu bar names an app as its Dock icon does: KCharSelect, not Kcharselect),
 * or a stand-in for it.
 */
export function appFor(pinned: readonly App[], window: Pick<Toplevel, "appId" | "title">, installed?: (appId: string) => App | undefined): App {
  return (
    pinned.find((app) => app.id === window.appId) ??
    ownApp(window.appId) ??
    (window.appId ? installed?.(window.appId) : undefined) ?? {
      id: window.appId,
      name: displayName(window.appId, window.title),
      icon: iconPath("generic"),
    }
  );
}

export interface DockItem {
  app: App;
  windows: readonly Toplevel[];
  pinned: boolean;
}

export type DockAction = { kind: "launch" } | { kind: "activate"; id: number } | { kind: "none" };

/**
 * A click on an app's icon: launch it when it has no windows, otherwise bring
 * its focused or most recent visible window forward, or restore a minimized one.
 */
export function clickAction(item: DockItem): DockAction {
  if (item.windows.length === 0) return canLaunch(item.app) ? { kind: "launch" } : { kind: "none" };
  const visible = item.windows.filter((window) => !window.minimized);
  const target = visible.find((window) => window.activated) ?? visible.at(-1) ?? item.windows.at(-1);
  return target ? { kind: "activate", id: target.id } : { kind: "none" };
}

/** Whether `launch` can start the app: it has a command, or the shell opens it itself. */
export function canLaunch(app: App): boolean {
  return app.exec !== undefined || shellOpeners.has(app.id);
}

/**
 * Start `app` detached from the shell's input and output; its pid, or null.
 * It gets a session of its own, so when the session supervisor restarts a
 * crashed shell (and reaps the shell's process group) apps keep running.
 * A shell app opens in the shell itself.
 */
let gpuEnvsHere: GpuEnvs | null = null;

/** This machine's GPU environments for apps (gpu-env.ts), read on the first launch. */
function machineGpuEnvs(): GpuEnvs {
  if (!gpuEnvsHere) {
    const cards = readCards();
    // The GPU dashi-session gave the compositor, else the one it would choose.
    const display = cards.find((card) => card.devnode === process.env.DASHI_DRM_DEVICE) ?? chooseGpu(cards)?.card ?? null;
    gpuEnvsHere = gpuEnvs(display, cards);
  }
  return gpuEnvsHere;
}

/** Who hears that an app quit with an error as it started (the launcher says "Couldn't open …"). */
export interface LaunchWatch {
  /** It exited with `code` (not 0) within `withinMs` of starting. */
  failed(code: number): void;
  /** How soon counts as "as it started"; 2 s unless said. */
  withinMs?: number;
}

export function launch(app: App, watch?: LaunchWatch): number | null {
  const open = app.exec ? undefined : shellOpeners.get(app.id);
  if (open) {
    open();
    // It runs in the shell: the shell's own process is the one that started it.
    return process.pid;
  }
  if (!app.exec) return null;
  try {
    const child = Bun.spawn([...app.exec], {
      env: { ...process.env, ...launchEnvFor(app, machineGpuEnvs(), process.env), ...app.env },
      // Apps start at home, like a fresh terminal, not where the shell runs.
      cwd: app.cwd ?? homedir(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    if (watch) {
      const started = Date.now();
      void child.exited.then((code) => {
        if (code !== 0 && Date.now() - started < (watch.withinMs ?? 2000)) watch.failed(code);
      });
    }
    return child.pid;
  } catch (error) {
    console.error(`dashi-shell: could not launch ${app.name}:`, error);
    return null;
  }
}
