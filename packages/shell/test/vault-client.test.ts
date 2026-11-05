// The shell's vault client against a real dashi-secretd (a development one,
// run as you on a socket of its own; built by `cargo build -p dashi-secretd`).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashiSource } from "../src/agents/secrets/dashi-source.ts";
import { Vault, vaultCall } from "../src/agents/secrets/vault.ts";
import { TEST_LOGIN } from "./fixtures/sign-in-site/server.ts";
import { base32, totp } from "./fixtures/sign-in-site/totp.ts";

const binary = join(import.meta.dir, "../../../target/debug/dashi-secretd");
const dir = mkdtempSync(join(tmpdir(), "dashi-vault-"));
const socket = join(dir, "socket");
let daemon: ReturnType<typeof Bun.spawn> | null = null;

beforeAll(async () => {
  if (!existsSync(binary)) return;
  daemon = Bun.spawn([binary, "--dev", "--state", join(dir, "state"), "--socket", socket], { stderr: "ignore" });
  for (let i = 0; i < 50 && !existsSync(socket); i++) await Bun.sleep(20);
  await vaultCall({ op: "unlock", user: process.getuid?.() ?? 0, password: btoa("test password") }, socket);
});
afterAll(() => daemon?.kill());

test.skipIf(!existsSync(binary))("logins go in, come back without secrets, and are typed only from the vault", async () => {
  const vault = new Vault(socket);
  expect((await vault.status()).unlocked).toBe(true);
  const id = await vault.save({ site: TEST_LOGIN.site, account: TEST_LOGIN.account, password: TEST_LOGIN.password, totp: base32(TEST_LOGIN.totp) });
  const listed = await vault.logins(`http://${TEST_LOGIN.site}:8443/`);
  expect(listed).toEqual([{ id, site: TEST_LOGIN.site, account: TEST_LOGIN.account, agents: "ask", hasCode: true, lastUsed: null }]);
  expect(JSON.stringify(listed)).not.toContain(TEST_LOGIN.password);
  const source = dashiSource(vault);
  const [login] = await source.logins(TEST_LOGIN.site);
  if (!login) throw new Error("no login");
  expect(new TextDecoder().decode(await source.password(login))).toBe(TEST_LOGIN.password);
  // The vault's code is the site's code.
  const code = await source.code(login);
  const now = Math.floor(Date.now() / 1000);
  expect([await totp(TEST_LOGIN.totp, now - 1), await totp(TEST_LOGIN.totp, now)]).toContain(code);
  // Marked "Never", agents get nothing, from the vault itself.
  await vault.setAgents(id, "never");
  await expect(source.password({ ...login, agents: "ask" })).rejects.toThrow("never");
  await vault.remove(id);
  expect(await vault.logins()).toEqual([]);
});
