/**
 * Where Claude's and GPT's keys come from. First the vault: the token item
 * named "anthropic" for api.anthropic.com, or "openai" for api.openai.com
 * ("Tokens that stay home", docs/secrets.md; tokens/model-keys.ts names
 * them), asked through the vault client's `forHost`, which dashi-secretd
 * answers only for a host the item lists. Without one, the session's
 * ANTHROPIC_API_KEY or OPENAI_API_KEY, which is where the providers' own
 * tools look today.
 *
 * The launcher's answerer runs in the shell, not in an agent's sandbox, so
 * the key reaches the request here and nowhere else: never logged,
 * never shown, never sent to the model, never in an agent's environment
 * (agents started through dashi-agent hold `dashi:anthropic` instead).
 */

import type { VaultTokens } from "../secrets/index.ts";
import { hostListed } from "../tokens/index.ts";
import { ANTHROPIC_HOST } from "./claude.ts";
import { OPENAI_HOST } from "./gpt.ts";

/** The vault item's name for Claude's key (tokens/model-keys.ts `MODEL_KEYS`). */
export const ANTHROPIC_TOKEN = "anthropic";
/** The vault item's name for GPT's key, for api.openai.com. */
export const OPENAI_TOKEN = "openai";

/** The part of the vault this needs. */
export interface TokenSource {
  /** Token `name`'s value for a request to `host`, for the shell's own client; null when the vault hasn't it for that host. */
  token(name: string, host: string): Promise<string | null>;
  /** Whether the vault has token `name` for `host`, without handing it out (Settings asks this). */
  holds(name: string, host: string): Promise<boolean>;
}

/** Where the key is, as Settings says it. */
export type KeyPlace = "vault" | "environment" | "none";

/** The vault's token items (secrets/vault.ts `VaultTokens`) as a TokenSource. */
export function vaultTokenSource(tokens: Pick<VaultTokens, "forHost" | "list">): TokenSource {
  return {
    async token(name, host) {
      const { token } = await tokens.forHost(name, host);
      try {
        const value = new TextDecoder().decode(token).trim();
        return value || null;
      } finally {
        token.fill(0);
      }
    },
    async holds(name, host) {
      return (await tokens.list()).some((item) => item.name === name && hostListed(item.hosts, host));
    },
  };
}

/** The providers an API answerer uses: Claude's and GPT's. */
export type Provider = "anthropic" | "openai";

/** Each provider's token item, host, and the session's variable for its key. */
export const PROVIDERS: Readonly<Record<Provider, { token: string; host: string; env: string }>> = {
  anthropic: { token: ANTHROPIC_TOKEN, host: ANTHROPIC_HOST, env: "ANTHROPIC_API_KEY" },
  openai: { token: OPENAI_TOKEN, host: OPENAI_HOST, env: "OPENAI_API_KEY" },
};

type Found = { key: string; place: Exclude<KeyPlace, "none"> } | null;

export interface ModelKeys {
  /** Claude's key and where it came from; null when there is none. */
  anthropic(): Promise<Found>;
  /** GPT's key (the token item `openai`, else OPENAI_API_KEY); null when there is none. */
  openai(): Promise<Found>;
  /** Where a provider's key is (Claude's by default), without asking the vault for it. */
  place(provider?: Provider): Promise<KeyPlace>;
}

export function modelKeys(vault: TokenSource | null, env: Record<string, string | undefined> = process.env): ModelKeys {
  const fromEnv = (provider: Provider) => env[PROVIDERS[provider].env]?.trim() || null;
  const key = async (provider: Provider): Promise<Found> => {
    const { token, host } = PROVIDERS[provider];
    try {
      const kept = await vault?.token(token, host);
      if (kept) return { key: kept, place: "vault" };
    } catch {
      // The vault is locked or has no such item: the session's key, if any.
    }
    const value = fromEnv(provider);
    return value ? { key: value, place: "environment" } : null;
  };
  return {
    anthropic: () => key("anthropic"),
    openai: () => key("openai"),
    async place(provider = "anthropic") {
      const { token, host } = PROVIDERS[provider];
      try {
        if (await vault?.holds(token, host)) return "vault";
      } catch {
        // Not answering: as if it weren't there.
      }
      return fromEnv(provider) ? "environment" : "none";
    },
  };
}

/** Where a key is, for Settings, without handing it out. */
export const keyPlace = (keys: ModelKeys, provider: Provider = "anthropic"): Promise<KeyPlace> => keys.place(provider);
