import { expect, test } from "bun:test";
import { REACH } from "@dashi/applet";
import { appletChip } from "../apps/software/applets/words.ts";
import { appChip, chipLabel, type Operation, queueLine } from "../apps/software/model.ts";
import { failureOf } from "../apps/software/store.ts";
import { appTrust, askReasons, installsWords, isProprietary, licenseWords } from "../apps/software/trust-words.ts";
import { PORTAL_TABLES } from "../src/privacy/portal-grants.ts";
import { splitAsks, trustLine } from "../src/shared/applet-store/consent-sheet.tsx";
import { plainFailure } from "../src/shared/software/failure-words.ts";
import { parseReleases, parseSizes, parseStats } from "../src/shared/software/flathub-parse.ts";
import type { AppDetails } from "../src/shared/software/flathub-types.ts";
import { cannotReach, describeReach, type FlatpakPermissions, parsePermissions } from "../src/shared/software/flatpak-permissions.ts";

const none: FlatpakPermissions = { shared: [], sockets: [], devices: [], filesystems: [], sessionBus: { talk: [], own: [] }, systemBus: { talk: [], own: [] } };

test("Flathub's summary permissions are read strictly; an answer without them is not known, never nothing", () => {
  expect(parsePermissions({ metadata: {} })).toBeNull();
  expect(parsePermissions("nope")).toBeNull();
  const parsed = parsePermissions({
    metadata: { permissions: { shared: ["network", 3], filesystems: ["xdg-download", "home:ro"], "session-bus": { talk: ["org.freedesktop.Flatpak"] } } },
  });
  expect(parsed).toEqual({
    ...none,
    shared: ["network"],
    filesystems: ["xdg-download", "home:ro"],
    sessionBus: { talk: ["org.freedesktop.Flatpak"], own: [] },
  });
  expect(parseSizes({ download_size: 10, metadata: { permissions: { shared: ["network"] } } }).permissions?.shared).toEqual(["network"]);
});

test("what a Flatpak reaches, in the lines applets and Settings use; broad access leads and is named", () => {
  const reach = describeReach({
    ...none,
    shared: ["network", "ipc"],
    sockets: ["wayland", "x11", "pulseaudio"],
    devices: ["dri", "all"],
    filesystems: ["xdg-download:ro", "host", "!home", "xdg-config/foo"],
    sessionBus: { talk: ["org.freedesktop.Notifications", "org.freedesktop.Flatpak", "com.example.Other"], own: [] },
  });
  expect(reach.broad).toEqual([
    "Read and change all your files",
    "Use every device: cameras, microphones, USB and game controllers",
    "Run commands outside its sandbox",
  ]);
  expect(reach.lines.slice(0, 3)).toEqual(reach.broad);
  expect(reach.lines).toContain("Read files in Downloads");
  expect(reach.lines).toContain(REACH.network);
  expect(reach.lines).toContain(REACH.notifications);
  expect(reach.lines).toContain("Talk to one other app");
  // Wayland is there, so X11 is only the fallback: not worth a line.
  expect(reach.lines.some((line) => line.includes("X11"))).toBe(false);
  expect(describeReach({ ...none, filesystems: ["home:ro"] }).broad).toEqual([]);
  // Where Flatpak apps keep their data: its own folder is no reach of note, another app's is said in words, never as a path.
  const mpv = { ...none, filesystems: ["~/.var/app/io.mpv.Mpv/config/mpv/scripts", "~/.var/app/org.videolan.VLC/data:ro"] };
  expect(describeReach(mpv, "io.mpv.Mpv").lines).toEqual(["Read another app's settings and data"]);
  expect(describeReach(mpv).lines.some((line) => line.includes(".var"))).toBe(false);
  expect(cannotReach({ ...none, filesystems: ["~/.var/app/io.mpv.Mpv/config"] }, "io.mpv.Mpv")).toBe(
    "It can't read your files or use the network, except files you open with it.",
  );
  expect(cannotReach(none)).toBe("It can't read your files or use the network, except files you open with it.");
  expect(cannotReach({ ...none, shared: ["network"] })).toBe("It can't read your files, except the ones you open with it.");
});

test("Settings' Privacy & Security and the trust card say a permission the same way", () => {
  const words = PORTAL_TABLES.flatMap((table) => Object.values(table.entries ?? {}));
  expect(words).toContain(REACH.camera);
  expect(words).toContain(REACH.background);
  expect(words).toContain(REACH.notifications);
});

const app = (over: Partial<AppDetails> = {}): AppDetails => ({
  id: "org.example.App",
  name: "App",
  summary: "Does things",
  developer: "Alex Kim",
  icon: null,
  verified: true,
  category: null,
  license: "GPL-3.0",
  installsLastMonth: 1500,
  updatedAt: null,
  description: [],
  screenshots: [],
  homepage: null,
  version: "2.0",
  released: 1762300000,
  runtime: null,
  eol: false,
  downloadSize: null,
  installedSize: null,
  categories: [],
  releases: [{ version: "2.0", released: 1762300000, notes: ["Faster."] }],
  permissions: { ...none, shared: ["network"] },
  ...over,
});

test("the trust card's facts, and when Get asks first", () => {
  const facts = appTrust(app());
  expect(facts.maker).toEqual({ name: "Alex Kim", line: "Verified by Flathub", mark: "verified" });
  expect(facts.reach).toEqual({ lines: [REACH.network], cannot: "It can't read your files, except the ones you open with it.", known: true });
  expect(facts.changed?.heading).toBe("Version 2.0 · Nov 4, 2025");
  expect(facts.users).toBe("1.5K installs last month");
  expect(appTrust(app({ permissions: null, verified: false })).reach.known).toBe(false);
  expect(appTrust(app({ verified: false })).maker.line).toBe("Not verified by Flathub");
  expect(askReasons(app())).toEqual([]);
  expect(askReasons(app({ license: "LicenseRef-proprietary=https://example.com", eol: true })).length).toBe(2);
  expect(askReasons(app({ permissions: { ...none, filesystems: ["home"] } }))).toEqual(["Read and change everything in your home folder"]);
  expect(isProprietary("LicenseRef-proprietary")).toBe(true);
  expect(installsWords(1)).toBe("1 install last month");
});

test("releases: stable ones, newest first, notes as plain paragraphs; the install count", () => {
  const releases = parseReleases([
    { version: "1.0", timestamp: "100" },
    { version: "2.0-beta", timestamp: "300", type: "development" },
    { version: "2.0", timestamp: 200, description: "<p>New <em>things</em>.</p>" },
  ]);
  expect(releases).toEqual([
    { version: "2.0", released: 200, notes: ["New things."] },
    { version: "1.0", released: 100, notes: [] },
  ]);
  expect(parseStats({ installs_last_month: 42 })).toBe(42);
  expect(parseStats({ installs_last_month: "lots" })).toBeNull();
});

test("a failure in plain words, the tool's text kept as details", () => {
  expect(plainFailure("error: Failed to install: No space left on device")).toEqual({
    message: "There isn't enough free space. Make some room, then try again.",
    details: "error: Failed to install: No space left on device",
  });
  expect(plainFailure("Could not resolve host: dl.flathub.org").message).toContain("network");
  expect(plainFailure("the package is x 1.0, not what the index lists").message).toContain("to keep you safe");
  expect(plainFailure("").details).toBeNull();
  expect(failureOf({ kind: "install", name: "VLC" }, "boom").title).toBe("“VLC” wasn’t installed");
  expect(failureOf({ kind: "update", name: "apps" }, "boom").title).toBe("Your apps weren’t updated");
  expect(failureOf({ kind: "system-update", name: "System" }, "boom").title).toBe("The system wasn’t updated");
});

const op = (over: Partial<Operation> = {}): Operation => ({
  key: "install:org.videolan.VLC",
  kind: "install",
  id: "org.videolan.VLC",
  name: "VLC",
  status: "running",
  progress: { fraction: 0.42, label: "" },
  ...over,
});

test("the state chip: one word per action, “…” when a sheet comes first, progress while busy", () => {
  expect(chipLabel(appChip({ kind: "get" }))).toBe("Get");
  expect(chipLabel(appChip({ kind: "get" }, true))).toBe("Get…");
  expect(chipLabel(appChip({ kind: "busy", operation: op() }))).toBe("Installing 42%");
  expect(chipLabel(appChip({ kind: "busy", operation: op({ status: "queued" }) }))).toBe("Waiting");
  expect(queueLine([])).toBeNull();
  expect(queueLine([op(), op({ key: "b", status: "queued" }), op({ key: "c", status: "queued" })])).toBe("Installing VLC 42% · 2 waiting");
  expect(queueLine([op({ kind: "system-update", id: undefined, progress: null })])).toBe("Updating the system…");
});

test("a narrow toolbar's queue line keeps the progress and gives up the name and the waiting count", () => {
  expect(queueLine([], { short: true })).toBeNull();
  expect(queueLine([op(), op({ key: "b", status: "queued" })], { short: true })).toBe("Installing 42%");
  expect(queueLine([op({ kind: "system-update", id: undefined, progress: null })], { short: true })).toBe("Updating…");
  expect(queueLine([op({ status: "queued" }), op({ key: "b", status: "queued" })], { short: true })).toBe("2 waiting");
});

test("an applet's chip: Get, Update…, Installed as words, and why it can't be had", () => {
  const installed = { manifest: {}, record: {}, dir: "" } as never;
  expect(appletChip({ kind: "get", version: null }, undefined, false)).toEqual({ kind: "unavailable", detail: "Needs a newer Dashi" });
  expect(chipLabel(appletChip({ kind: "update", installed, version: {} as never }, undefined, true))).toBe("Update…");
  expect(chipLabel(appletChip({ kind: "installed", installed }, undefined, false))).toBe("Installed");
  expect(appletChip({ kind: "installed", installed }, op({ subject: "applet" }), false).kind).toBe("busy");
});

test("the applet consent sheet: what is new up front, what was allowed apart, and who vouches for it", () => {
  const manifest = {
    permissions: [{ kind: "network" as const }, { kind: "notifications" as const }],
    commands: [{ id: "a", title: "A", mode: "instant", keywords: [], args: [] }] as never[],
    author: { name: "Netko Labs" },
  };
  expect(splitAsks(manifest)).toEqual({ fresh: [REACH.network, REACH.notifications, "Adds 1 command to the launcher"], kept: [] });
  expect(splitAsks(manifest, ["notifications", "launcher.commands"])).toEqual({
    fresh: [REACH.network],
    kept: [REACH.notifications, "Adds 1 command to the launcher"],
  });
  expect(trustLine(manifest, true, true)).toBe("By Netko Labs · Reviewed by Dashi · Signed by its author");
  expect(trustLine(manifest, undefined, false)).toBe("By Netko Labs · Added by hand, not signed");
});

test("the License row: Flathub's proprietary reference reads Proprietary and links to its terms", () => {
  expect(licenseWords("LicenseRef-proprietary=https://www.spotify.com/us/legal/end-user-agreement/")).toEqual({
    value: "Proprietary",
    link: "https://www.spotify.com/us/legal/end-user-agreement/",
  });
  expect(licenseWords("LicenseRef-proprietary")).toEqual({ value: "Proprietary" });
  expect(licenseWords("LicenseRef-proprietary=javascript:alert(1)")).toEqual({ value: "Proprietary" });
  expect(licenseWords("GPL-2.0-or-later")).toEqual({ value: "GPL-2.0-or-later" });
});
