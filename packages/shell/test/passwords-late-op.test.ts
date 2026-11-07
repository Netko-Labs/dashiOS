import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPasswords } from "../src/agents/secrets/passwords.ts";

// 1Password's CLI installed during the session works at once: `op` is looked for when a source is needed, not at login.

const dir = mkdtempSync(join(tmpdir(), "dashi-passwords-op-"));
const saved = { config: process.env.XDG_CONFIG_HOME, op: process.env.DASHI_OP, path: process.env.PATH };
afterAll(() => {
  for (const [key, value] of [
    ["XDG_CONFIG_HOME", saved.config],
    ["DASHI_OP", saved.op],
    ["PATH", saved.path],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

test("1Password turned on before op is installed is a source as soon as op is there", () => {
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  process.env.PATH = join(dir, "empty");
  delete process.env.DASHI_OP;
  const passwords = startPasswords();
  passwords.prefs.set({ sources: { dashi: false, "1password": true } });
  expect(passwords.onePasswordReady()).toBe(false);
  expect(passwords.sources()).toHaveLength(0);
  // Installed now, mid-session.
  const op = join(dir, "op");
  writeFileSync(op, "#!/bin/sh\nexit 0\n");
  chmodSync(op, 0o755);
  process.env.DASHI_OP = op;
  expect(passwords.onePasswordReady()).toBe(true);
  expect(passwords.sources().map((source) => source.id)).toEqual(["1password"]);
});
