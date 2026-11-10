import { describe, expect, test } from "bun:test";
import { CA_BUNDLE_VARS, type SandboxEnv, tokenProxyArgs } from "../src/agents/sandbox.ts";
import type { TokenSummary } from "../src/agents/secrets/vault.ts";
import { token } from "../src/agents/tokens/model-keys.ts";

describe("the sandbox's arguments", () => {
  const env: SandboxEnv = { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" };
  const args = tokenProxyArgs(
    env,
    { socket: "/run/user/1000/dashi-tokens/ab/proxy.sock", ca: "/r/ca.pem", bundle: "/r/bundle.pem", key: "k3y", port: 41234 },
    "corp.example",
  );
  const setenv = new Map(args.flatMap((arg, i) => (arg === "--setenv" ? [[args[i + 1], args[i + 2]] as const] : [])));
  test("HTTPS_PROXY is the relay with the sandbox's credentials; local hosts go direct", () => {
    expect(setenv.get("HTTPS_PROXY")).toBe("http://dashi:k3y@127.0.0.1:41234");
    expect(setenv.get("https_proxy")).toBe("http://dashi:k3y@127.0.0.1:41234");
    expect(setenv.get("NO_PROXY")).toBe("localhost,127.0.0.1,::1,corp.example");
  });
  test("the CA is trusted inside the sandbox only, from files bound into its own runtime directory", () => {
    for (const name of CA_BUNDLE_VARS) expect(setenv.get(name)).toBe("/run/user/1000/dashi-tokens/bundle.pem");
    expect(setenv.get("NODE_EXTRA_CA_CERTS")).toBe("/run/user/1000/dashi-tokens/ca.pem");
    expect(args).toEqual(expect.arrayContaining(["--bind", "/run/user/1000/dashi-tokens/ab/proxy.sock", "/run/user/1000/dashi-tokens/proxy.sock"]));
    expect(args).toEqual(expect.arrayContaining(["--ro-bind", "/r/bundle.pem", "/run/user/1000/dashi-tokens/bundle.pem"]));
  });
});

describe("model keys", () => {
  const items: TokenSummary[] = [
    { id: 1, name: "anthropic", hosts: ["api.anthropic.com"], headers: ["x-api-key: {}", "Authorization: Bearer {}"], lastUsed: null },
  ];
  test("token(name) gives the placeholder and the environment, never the key", async () => {
    const ref = await token("anthropic", { list: async () => items });
    expect(ref).toEqual({
      name: "anthropic",
      placeholder: "dashi:anthropic",
      hosts: ["api.anthropic.com"],
      headers: ["x-api-key: {}", "Authorization: Bearer {}"],
      env: { ANTHROPIC_API_KEY: "dashi:anthropic" },
    });
  });
  test("it is null when the vault hasn't the token or doesn't answer", async () => {
    expect(await token("openai", { list: async () => items })).toBeNull();
    expect(
      await token("anthropic", {
        list: async () => {
          throw new Error("locked");
        },
      }),
    ).toBeNull();
  });
});
