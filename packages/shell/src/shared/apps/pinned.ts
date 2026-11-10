/**
 * Dashi's own app list: the first installed choice of each, which the Dock
 * starts with and which Files, Preview and the portal offer to open things in.
 */

import { existsSync } from "node:fs";
import { type App, iconPath } from "./app.ts";

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

const shellRoot = new URL("../../../", import.meta.url).pathname;

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
      { id: "dev.dashi.terminal", exec: [process.execPath, `${shellRoot}apps/terminal/main.tsx`], cwd: shellRoot, runs: ["-e"] },
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
