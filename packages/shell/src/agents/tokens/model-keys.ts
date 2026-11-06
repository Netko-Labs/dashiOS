/**
 * Model keys as token items (docs/secrets.md, "Tokens that stay home"): a
 * provider's API key lives in the vault, for that provider's host only, and
 * an answerer run through `dashi-agent` holds the placeholder instead.
 *
 * `token(name)` is what the launcher's answerer asks: whether the vault has
 * that token, and what to put in the agent's environment for it. It never
 * returns the token. Null means "not in the vault (or the vault isn't
 * answering)": fall back to the answerer's own configuration.
 *
 *   const key = await token("anthropic");
 *   spawn(["dashi-agent", "--", "claude", "-p", ask], { env: { ...process.env, ...key?.env } });
 */

import { type TokenSummary, VaultTokens } from "../secrets/vault.ts";
import { DEFAULT_HEADER, placeholder } from "./swap.ts";

export interface ModelKey {
  /** The token item's name, and so its placeholder (`dashi:anthropic`). */
  name: string;
  /** What Settings calls it. */
  label: string;
  hosts: string[];
  header: string;
  /** The variable the provider's tools read their key from. */
  env: string;
  /** The agent that uses it, for Settings: "Key: in your vault. Claude never sees it." */
  agent: string;
}

/** The providers Dashi knows: their API's host, the header their key goes in, and where their tools look for it. */
export const MODEL_KEYS: readonly ModelKey[] = [
  { name: "anthropic", label: "Anthropic key", hosts: ["api.anthropic.com"], header: "x-api-key: {}", env: "ANTHROPIC_API_KEY", agent: "Claude" },
  { name: "openai", label: "OpenAI key", hosts: ["api.openai.com"], header: DEFAULT_HEADER, env: "OPENAI_API_KEY", agent: "Codex" },
];

export const modelKey = (name: string): ModelKey | undefined => MODEL_KEYS.find((key) => key.name === name);

/** A token item the vault holds, as an agent's environment needs it: never the token. */
export interface TokenRef {
  name: string;
  /** `dashi:<name>`: what the agent holds; the proxy swaps it for the token on the way to `hosts`. */
  placeholder: string;
  hosts: string[];
  header: string;
  /** The environment to start the agent with (`ANTHROPIC_API_KEY=dashi:anthropic` for a model key; empty for others). */
  env: Record<string, string>;
}

export function tokenRef(item: Pick<TokenSummary, "name" | "hosts" | "header">): TokenRef {
  const key = modelKey(item.name);
  const held = placeholder(item.name);
  return { name: item.name, placeholder: held, hosts: item.hosts, header: item.header, env: key ? { [key.env]: held } : {} };
}

/** Token `name` from the vault, as a placeholder and its environment; null when the vault doesn't have it or doesn't answer. */
export async function token(name: string, tokens: Pick<VaultTokens, "list"> = new VaultTokens()): Promise<TokenRef | null> {
  try {
    const item = (await tokens.list()).find((each) => each.name === name);
    return item ? tokenRef(item) : null;
  } catch {
    return null;
  }
}
