/**
 * The sandbox for real: bubblewrap with the plan an extension gets
 * (src/applets/lib/sandbox.ts), running a script that tries to read what it
 * didn't declare. It reads its own folder and its own home, and nothing of
 * the person's home, their folders, or the network unless declared.
 * Skipped where bubblewrap can't make a sandbox (a container without user
 * namespaces).
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Manifest, parseManifest } from "@dashi/applet";
import { userFolders } from "../src/applets/launcher.ts";
import { type SandboxPaths, sandboxPlan } from "../src/applets/lib/sandbox.ts";

const bwrap = Bun.which("bwrap");
const works =
  bwrap !== null &&
  Bun.spawnSync([bwrap, "--unshare-all", "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib64", "/lib64", "--", "/usr/bin/true"]).exitCode === 0;

function manifest(permissions: string[]): Manifest {
  const parsed = parseManifest({
    id: "dev.example.peek",
    name: "Peek",
    version: "0.1.0",
    dashi: ">=0.9",
    entry: "main.ts",
    summary: "Tries to read what it shouldn't.",
    author: { name: "Alex Kim" },
    shows: ["launcher"],
    permissions,
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** What the script inside tries: each path, read or listed; whether it worked. */
const SCRIPT = `
import { existsSync, readdirSync, readFileSync } from "node:fs";
const tries = JSON.parse(process.argv[2] ?? "[]");
const out = {};
for (const path of tries) {
  try { out[path] = readdirSync(path).length >= 0 || true; } catch {
    try { readFileSync(path); out[path] = true; } catch { out[path] = false; }
  }
}
console.log(JSON.stringify(out));
`;

function world(): { paths: SandboxPaths; secret: string; documents: string; own: string } {
  const root = mkdtempSync(join(tmpdir(), "dashi-sandbox-"));
  const home = join(root, "home");
  const runtime = join(root, "run");
  const appletDir = join(home, ".local/share/dashi/applets/dev.example.peek");
  const dataDir = join(home, ".local/share/dashi/applet-data/dev.example.peek");
  const socketDir = join(runtime, "dashi-applets/dev.example.peek");
  for (const dir of [appletDir, dataDir, socketDir, join(home, "Documents")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(runtime, "wayland-0"), "");
  writeFileSync(join(appletDir, "main.js"), SCRIPT);
  writeFileSync(join(home, ".ssh-secret"), "the person's own");
  writeFileSync(join(home, "Documents/letter.txt"), "dear Alex");
  writeFileSync(join(dataDir, "mine.txt"), "its own");
  const paths: SandboxPaths = {
    appletDir,
    dataDir,
    home,
    uid: process.getuid?.() ?? 1000,
    runtimeDir: runtime,
    socketDir,
    wayland: "wayland-0",
    bun: process.execPath,
    metalHost: process.execPath,
    appearance: join(home, ".local/state/dashi/control-center.json"),
    sessionBus: null,
    systemBus: "unix:path=/run/dbus/system_bus_socket",
    proxyDir: join(runtime, "proxy"),
    folders: userFolders(home, null),
  };
  return { paths, secret: join(home, ".ssh-secret"), documents: join(home, "Documents/letter.txt"), own: join(home, "mine.txt") };
}

function run(plan: string[], tries: string[]): Record<string, boolean> {
  const args = [...plan, JSON.stringify(tries)];
  const done = Bun.spawnSync([bwrap ?? "bwrap", ...args], { stdout: "pipe", stderr: "pipe" });
  const text = done.stdout.toString().trim();
  if (done.exitCode !== 0 || !text) throw new Error(`the sandbox didn't run: ${done.stderr.toString()}`);
  const parsed: unknown = JSON.parse(text);
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(parsed && typeof parsed === "object" ? parsed : {})) out[key] = value === true;
  return out;
}

describe.skipIf(!works)("an extension in its sandbox", () => {
  test("reads its own home and nothing of the person's: not their files, not Documents it didn't ask for", () => {
    const { paths, secret, documents, own } = world();
    const { bwrap: plan } = sandboxPlan(manifest([]), paths);
    const seen = run(plan, [own, secret, documents, "/etc/passwd", "/etc/resolv.conf"]);
    expect(seen[own]).toBe(true);
    expect(seen[secret]).toBe(false);
    expect(seen[documents]).toBe(false);
    expect(seen["/etc/passwd"]).toBe(false);
    expect(seen["/etc/resolv.conf"]).toBe(false);
  });

  test("files.documents:read gives Documents and only Documents", () => {
    const { paths, secret, documents } = world();
    const { bwrap: plan } = sandboxPlan(manifest(["files.documents:read"]), paths);
    const seen = run(plan, [documents, secret]);
    expect(seen[documents]).toBe(true);
    expect(seen[secret]).toBe(false);
  });

  test("network:HOST is the network, said so on the sheet; no network without it", () => {
    const { paths } = world();
    const without = sandboxPlan(manifest([]), paths).bwrap;
    const host = sandboxPlan(manifest(["network:api.github.com"]), paths).bwrap;
    expect(without).not.toContain("--share-net");
    expect(host).toContain("--share-net");
    expect(run(host, ["/etc/resolv.conf"])["/etc/resolv.conf"]).toBe(true);
  });
});
