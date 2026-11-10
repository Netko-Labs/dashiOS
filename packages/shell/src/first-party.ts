/**
 * Dashi's own apps that run as their own process (shell/apps/<dir>/main.tsx,
 * built on shell/apps/kit): they are in the launcher, can be kept in the
 * Dock, and their windows are named and drawn properly in the Dock and the
 * menu bar. Adding one is one entry here, its icon in shell/icons/, and its
 * folder in shell/apps/ (README "First-party apps").
 */

import { existsSync } from "node:fs";
// biome-ignore lint/nursery/noImportCycles: H5 offender (scripts/lists/import-cycles.txt)
import { type App, iconPath } from "./apps.ts";

export interface FirstPartySpec {
  /** `dev.dashi.<name>`: the app id its window reports (`runApp`'s `id`). */
  id: string;
  name: string;
  /** shell/icons/<icon>.svg */
  icon: string;
  /** shell/apps/<dir>/main.tsx */
  dir: string;
  /** Other words it is found by in the launcher, lowercase. */
  keywords: readonly string[];
  /**
   * The MIME types it opens, which makes it take a file on its command line
   * and puts a `MimeType=` line in the desktop entry the shell writes for it
   * (desktop-entries.ts). Declared here so the entry, the launcher's "open
   * with", and the installer's defaults all come from one list.
   */
  mimeTypes?: readonly string[];
  /** Installed systems make it the default for `mimeTypes` (the system mimeapps.list; scripts/install.sh, spin/build.sh). */
  defaultHandler?: true;
  /** Freedesktop menu categories for its desktop entry ("Graphics;Viewer;" as a list). */
  categories?: readonly string[];
}

/** What Preview opens: the formats it draws itself or through ImageMagick, and PDF through poppler. */
export const PREVIEW_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
  "image/tiff",
  "application/pdf",
] as const;

/** What Text Editor opens: plain text and the text formats nothing else in Dashi edits (config, scripts, data, source). */
export const EDITOR_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-log",
  "text/csv",
  "text/tab-separated-values",
  "text/x-readme",
  "application/json",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/xml",
  "text/xml",
  "application/x-shellscript",
  "text/x-python",
  "application/javascript",
  "text/javascript",
  "application/x-desktop",
  "text/x-csrc",
  "text/x-chdr",
  "text/x-rust",
  "text/x-go",
  "text/css",
] as const;

export const FIRST_PARTY: readonly FirstPartySpec[] = [
  { id: "dev.dashi.calculator", name: "Calculator", icon: "calculator", dir: "calculator", keywords: ["calc", "math", "arithmetic"] },
  {
    id: "dev.dashi.terminal",
    name: "Terminal",
    icon: "terminal",
    dir: "terminal",
    keywords: ["terminal", "shell", "console", "command line", "zsh", "bash", "ghostty"],
    categories: ["System", "TerminalEmulator"],
  },
  {
    id: "dev.dashi.activity-monitor",
    name: "Activity Monitor",
    icon: "activity-monitor",
    dir: "activity-monitor",
    keywords: ["task manager", "processes", "system monitor", "top", "cpu", "memory", "kill"],
  },
  { id: "dev.dashi.notes", name: "Notes", icon: "notes", dir: "notes", keywords: ["notes", "notepad", "memo", "markdown", "todo", "checklist", "writing"] },
  {
    id: "dev.dashi.calendar",
    name: "Calendar",
    icon: "calendar",
    dir: "calendar",
    keywords: ["calendar", "events", "schedule", "agenda", "appointments", "reminders", "ics", "ical", "meetings", "dates", "planner"],
    categories: ["Office", "Calendar"],
  },
  {
    id: "dev.dashi.preview",
    name: "Preview",
    icon: "preview",
    dir: "preview",
    keywords: ["image", "photo", "picture", "pdf", "viewer", "png", "jpeg", "jpg", "gif", "webp", "svg", "document"],
    mimeTypes: PREVIEW_MIME_TYPES,
    defaultHandler: true,
    categories: ["Graphics", "Viewer"],
  },
  {
    id: "dev.dashi.software",
    name: "Software",
    icon: "software",
    dir: "software",
    // Menu bar applets are a section of Software (the Applet Store folded in), so their words find it too.
    keywords: [
      "app store",
      "store",
      "apps",
      "install",
      "uninstall",
      "updates",
      "update",
      "flatpak",
      "flathub",
      "packages",
      "download",
      "applets",
      "applet",
      "applet store",
      "menu bar",
      "extensions",
      "widgets",
      "add-ons",
      "plugins",
    ],
    categories: ["System", "PackageManager"],
  },
  {
    id: "dev.dashi.files",
    name: "Files",
    icon: "files",
    dir: "files",
    keywords: ["file manager", "finder", "folders", "explorer", "trash", "documents", "downloads", "drives", "nautilus"],
    // It opens folders: a folder on its command line, as `gio open` passes it. The default for them, in place of Nautilus.
    mimeTypes: ["inode/directory"],
    defaultHandler: true,
    categories: ["Utility", "FileManager"],
  },
  {
    id: "dev.dashi.editor",
    name: "Text Editor",
    icon: "editor",
    dir: "editor",
    keywords: ["text editor", "editor", "text", "plain text", "notepad", "txt", "code", "config", "gedit", "kate"],
    mimeTypes: EDITOR_MIME_TYPES,
    defaultHandler: true,
    categories: ["Utility", "TextEditor"],
  },
];

/** The shell's folder, with a trailing slash. */
export const shellDir = new URL("../", import.meta.url).pathname;

/** The command that starts `spec`: this Bun on its main.tsx, from the shell's folder (its tsconfig and node_modules). */
export function firstPartyApp(spec: FirstPartySpec, bun: string = process.execPath, root: string = shellDir): App {
  return { id: spec.id, name: spec.name, icon: iconPath(spec.icon), exec: [bun, `${root}apps/${spec.dir}/main.tsx`], cwd: root };
}

let installed: App[] | null = null;

/** The entries of `FIRST_PARTY` that are here (their main.tsx exists). */
export function installedSpecs(root: string = shellDir): FirstPartySpec[] {
  return FIRST_PARTY.filter((spec) => existsSync(`${root}apps/${spec.dir}/main.tsx`));
}

/** The first-party apps that are here (their main.tsx exists), in list order. Found once. */
export function firstPartyApps(): App[] {
  installed ??= installedSpecs().map((spec) => firstPartyApp(spec));
  return installed.map((app) => ({ ...app }));
}

/** The words the launcher finds a first-party app by. */
export function firstPartyKeywords(id: string): string[] {
  const spec = FIRST_PARTY.find((each) => each.id === id);
  return spec ? [spec.id.toLowerCase(), ...spec.keywords] : [];
}
