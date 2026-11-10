/**
 * All apps lists every app a person would expect, once, A to Z, and all of
 * it can be reached. Fixture desktop files reproduce what went missing:
 * the end of the alphabet (the list was cut to fit the panel, so it ended
 * at Preview and WhatsApp Web, Steam and the rest never showed), programs
 * for a terminal (htop), and Wine's programs in a subfolder.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Entry, launchable, loadEntries } from "../src/entries.ts";
import { fitToRoom, listHeight } from "../src/launcher/fit.ts";
import { measuresFor } from "../src/launcher/measures.ts";
import { ALL_APPS_ROWS, allApps, buildSections, type ListInput } from "../src/launcher/rows.ts";
import { desktopFiles, inTerminal, parseDesktopEntry } from "../src/shared/apps/index.ts";

const desktop = (name: string, lines: string[] = []): string =>
  ["[Desktop Entry]", "Type=Application", `Name=${name}`, `Exec=${name.toLowerCase().replaceAll(" ", "-")} %U`, "Terminal=false", ...lines, ""].join("\n");

/** A home and a system with the kinds of entries this laptop has (and Wine's). */
const FIXTURE: Record<string, string> = {
  // The person's own: a web app installed from Helium, Steam's games (a file name with a space), Wine's programs.
  "home/applications/chrome-hnpfjngllnobngcgfapefoaidbinmjnm-Default.desktop": desktop("WhatsApp Web", [
    "StartupWMClass=crx_hnpfjngllnobngcgfapefoaidbinmjnm",
  ]).replace(/^Exec=.*$/m, "Exec=/opt/helium/helium-wrapper --profile-directory=Default --app-id=hnpfjngllnobngcgfapefoaidbinmjnm"),
  "home/applications/Wuthering Waves.desktop": desktop("Wuthering Waves").replace(/^Exec=.*$/m, "Exec=steam steam://rungameid/3513350"),
  "home/applications/wine/Programs/Notepad++.desktop": desktop("Notepad++"),
  // A URL handler and an app's window-naming entry: never listed.
  "home/applications/claude-code-url-handler.desktop": desktop("Claude Code URL Handler", ["NoDisplay=true"]),
  "home/applications/com.t3tools.T3Code.desktop": desktop("T3 Code (Nightly)", ["NoDisplay=true"]),
  // The person deleted the system's Xterm-ish tool (Hidden=true overrides it).
  "home/applications/zapped.desktop": desktop("Zapped", ["Hidden=true"]),
  // A Flatpak export.
  "flatpak/applications/org.zotero.Zotero.desktop": desktop("Zotero"),
  // The system's.
  "system/applications/com.onepassword.OnePassword.desktop": desktop("1Password"),
  "system/applications/htop.desktop": desktop("Htop").replace("Terminal=false", "Terminal=true"),
  "system/applications/nvidia-settings.desktop": desktop("NVIDIA X Server Settings"),
  "system/applications/org.fedoraproject.MediaWriter.desktop": desktop("Fedora Media Writer"),
  "system/applications/steam.desktop": desktop("Steam"),
  "system/applications/t3code-nightly.desktop": desktop("T3 Code (Nightly)", ["StartupWMClass=t3code-nightly"]),
  "system/applications/zapped.desktop": desktop("Zapped"),
  "system/applications/qemu.desktop": "[Desktop Entry]\nName=QEMU\nType=Application\nNoDisplay=true\n",
  "system/applications/kde-only.desktop": desktop("KDE Only", ["OnlyShowIn=KDE;"]),
  "system/applications/gcr-prompter.desktop": desktop("Access Prompt", ["NoDisplay=true"]),
};

const EXPECTED = [
  "1Password",
  "Fedora Media Writer",
  "Htop",
  "Notepad++",
  "NVIDIA X Server Settings",
  "Steam",
  "T3 Code (Nightly)",
  "WhatsApp Web",
  "Wuthering Waves",
  "Zotero",
];

let root = "";
const saved = { home: process.env.XDG_DATA_HOME, dirs: process.env.XDG_DATA_DIRS };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-all-apps-"));
  for (const [path, text] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  process.env.XDG_DATA_HOME = join(root, "home");
  process.env.XDG_DATA_DIRS = [join(root, "flatpak"), join(root, "system")].join(":");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of [
    ["XDG_DATA_HOME", saved.home],
    ["XDG_DATA_DIRS", saved.dirs],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** The fixture's apps among everything installed (Dashi's own come too, whatever this machine has). */
const fixtureNames = (entries: readonly Entry[]): string[] =>
  entries.filter((entry) => !entry.id.startsWith("dev.dashi.") && !entry.shell && entry.id !== "helium").map((entry) => entry.name);

const ICONS = { calculator: "/c.svg", files: "/f.svg", software: "/s.svg" };
const list = (entries: Entry[], extra: Partial<ListInput> = {}): ListInput => ({
  query: "",
  entries,
  recent: [],
  files: { kind: "none" },
  icons: ICONS,
  ...extra,
});

test("every visible entry is listed once, A to Z: web apps, Flatpaks, games, a terminal program, Wine's", () => {
  const entries = loadEntries();
  expect(fixtureNames(allApps(entries))).toEqual(EXPECTED);
});

test("All apps is never cut to fit the panel: it is drawn a window at a time, and its end is there to scroll to", () => {
  const entries = loadEntries();
  const m = measuresFor(1);
  const sections = buildSections(list(entries, { allApps: true, limits: { local: m.localRows, files: m.fileRows, allApps: m.allAppsRows } }));
  const all = sections.find((section) => section.id === "all");
  expect(all?.window).toBe(m.allAppsRows);
  // Far more apps than rows that fit: before, fitToRoom cut the list after the 12th (Preview).
  expect((all?.rows.length ?? 0) * m.row).toBeGreaterThan(m.room);
  const fitted = fitToRoom(sections, { height: m.room, row: m.row, head: m.head });
  expect(fitted).toEqual(sections);
  expect(listHeight(fitted, m.row, m.head)).toBeLessThanOrEqual(m.room);
  expect(fitted.at(-1)?.rows.at(-1)?.title).toBe(allApps(entries).at(-1)?.name);
  // With a failed app's row on top too, at the largest text size.
  const large = measuresFor(1.5);
  const failed = buildSections(list(entries, { allApps: true, failed: entries[0] ?? null, limits: { local: 3, files: 1, allApps: large.allAppsRows } }));
  const kept = fitToRoom(failed, { height: large.room, row: large.row, head: large.head });
  expect(kept.find((section) => section.id === "all")?.rows).toHaveLength(allApps(entries).length);
});

test("a short list's window is only as tall as its apps", () => {
  const sections = buildSections(list([{ id: "a", name: "A", icon: "/a.svg", keywords: [] }], { allApps: true }));
  expect(sections[0]?.window).toBe(1);
  expect(ALL_APPS_ROWS).toBe(measuresFor(1).allAppsRows);
});

test("NoDisplay, Hidden, another desktop's and Exec-less entries stay out; the person's file wins over the system's", () => {
  const names = loadEntries().map((entry) => entry.name);
  for (const name of ["Claude Code URL Handler", "Zapped", "QEMU", "KDE Only", "Access Prompt"]) expect(names).not.toContain(name);
  // T3 Code's NoDisplay entry still names its windows.
  expect(loadEntries({ withHidden: true }).find((entry) => entry.id === "com.t3tools.T3Code")).toMatchObject({ hidden: true });
});

test("Wine's programs in a subfolder are read, with the specification's desktop id", () => {
  const files = desktopFiles(join(root, "home/applications"));
  expect(files.map((file) => file.id)).toContain("wine-Programs-Notepad++");
  expect(desktopFiles(join(root, "nowhere"))).toEqual([]);
  // The listing's order doesn't matter; ids come out the same.
  expect(desktopFiles("/apps", () => ["b.desktop", "x/a.desktop", "notes.txt"])).toEqual([
    { id: "b", path: "/apps/b.desktop" },
    { id: "x-a", path: "/apps/x/a.desktop" },
  ]);
});

test("a Terminal=true entry is listed and opens in the pinned Terminal, its command after -e (or --)", () => {
  const text = desktop("Htop").replace("Terminal=false", "Terminal=true");
  const parsed = parseDesktopEntry("htop", text);
  expect(parsed).toMatchObject({ name: "Htop", exec: ["htop"], terminal: true });
  const has = (installed: string[]) => (program: string) => (installed.includes(program) ? `/usr/bin/${program}` : null);
  const wrapped = launchable({ exec: ["htop", "-t"], terminal: true as const }, (argv) => inTerminal(argv, has(["foot"])));
  expect(wrapped?.exec).toEqual(["foot", "--", "htop", "-t"]);
  expect(launchable({ exec: ["htop"], terminal: true as const }, (argv) => inTerminal(argv, has(["konsole"])))?.exec).toEqual(["konsole", "-e", "htop"]);
  // Dashi's own Terminal (a Bun app) runs it in its folder.
  const own = inTerminal(["htop"], () => "/usr/bin/x");
  expect(own?.exec?.slice(-2)).toEqual(["-e", "htop"]);
  expect(own?.exec?.at(-3)?.endsWith("apps/terminal/main.tsx")).toBe(true);
  expect(own?.cwd).toBeDefined();
  // No terminal installed: it can't be opened, so it isn't listed.
  expect(launchable({ exec: ["htop"], terminal: true as const }, (argv) => inTerminal(argv, has([])))).toBeNull();
  // An app that isn't for a terminal is left as it is.
  expect(launchable({ exec: ["steam"] }, () => null)).toEqual({ exec: ["steam"] });
});
