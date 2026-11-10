import { expect, test } from "bun:test";
import { ANTHROPIC_TOKEN, keyPlace, modelKeys, vaultTokenSource } from "../src/agents/ask/keys.ts";
import { ANTHROPIC_HOST } from "../src/agents/ask/lib/claude.ts";

test("Claude's key: the vault's token item for api.anthropic.com first, else ANTHROPIC_API_KEY, else none", async () => {
  const asked: Array<[string, string]> = [];
  const handed: Uint8Array[] = [];
  const tokens = {
    forHost: async (name: string, host: string) => {
      asked.push([name, host]);
      if (name !== ANTHROPIC_TOKEN || host !== ANTHROPIC_HOST) throw new Error("not for that host");
      const token = new TextEncoder().encode("from-vault");
      handed.push(token);
      return { token, headers: ["x-api-key: {}", "Authorization: Bearer {}"] };
    },
    list: async () => [{ id: 1, name: ANTHROPIC_TOKEN, hosts: [ANTHROPIC_HOST], headers: ["x-api-key: {}"], lastUsed: null }],
  };
  const keys = modelKeys(vaultTokenSource(tokens), { ANTHROPIC_API_KEY: "from-env" });
  expect(await keys.anthropic()).toEqual({ key: "from-vault", place: "vault" });
  expect(asked).toEqual([["anthropic", "api.anthropic.com"]]);
  // The vault's bytes are wiped once read.
  expect(handed[0]?.every((byte) => byte === 0)).toBe(true);
  // Settings learns where the key is without the vault handing it out.
  expect(await keyPlace(keys)).toBe("vault");
  expect(asked).toHaveLength(1);

  // No such item (or it lists other hosts), or a locked vault: the session's key.
  const other = {
    forHost: async () => Promise.reject(new Error("no such token")),
    list: async () => [{ id: 2, name: ANTHROPIC_TOKEN, hosts: ["api.example.com"], headers: ["x-api-key: {}"], lastUsed: null }],
  };
  expect(await modelKeys(vaultTokenSource(other), { ANTHROPIC_API_KEY: " from-env " }).anthropic()).toEqual({ key: "from-env", place: "environment" });
  expect(await keyPlace(modelKeys(vaultTokenSource(other), { ANTHROPIC_API_KEY: "from-env" }))).toBe("environment");
  expect(await modelKeys(null, { ANTHROPIC_API_KEY: " from-env " }).anthropic()).toEqual({ key: "from-env", place: "environment" });
  const locked = { forHost: async () => Promise.reject(new Error("locked")), list: async () => Promise.reject(new Error("locked")) };
  expect(await modelKeys(vaultTokenSource(locked), {}).anthropic()).toBeNull();
  expect(await keyPlace(modelKeys(vaultTokenSource(locked), {}))).toBe("none");
});
