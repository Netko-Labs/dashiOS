import type { TokenSummary } from "../../src/agents/secrets/vault.ts";
import type { TokenSource } from "../../src/agents/tokens/proxy.ts";

export const asked: Array<[string, string]> = [];
export const ANTHROPIC_HEADERS = ["x-api-key: {}", "Authorization: Bearer {}"];
export const items: TokenSummary[] = [
  { id: 1, name: "github", hosts: ["api.github.test"], headers: ["Authorization: Bearer {}"], lastUsed: null },
  { id: 2, name: "anthropic", hosts: ["api.anthropic.com"], headers: ANTHROPIC_HEADERS, lastUsed: null },
];
export const source: TokenSource = {
  list: async () => items,
  forHost: async (name, host) => {
    asked.push([name, host]);
    if (name === "github" && host === "api.github.test") return { token: new TextEncoder().encode("ghp_real"), headers: ["Authorization: Bearer {}"] };
    if (name === "anthropic" && host === "api.anthropic.com") return { token: new TextEncoder().encode("sk-ant-real"), headers: ANTHROPIC_HEADERS };
    throw new Error(`${name} isn't for that host`);
  },
};
