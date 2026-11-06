/**
 * Where Claude's key comes from. First the vault: the token item named
 * "anthropic" for api.anthropic.com ("Tokens that stay home",
 * docs/secrets.md; tokens/model-keys.ts names it), asked through the vault
 * client's `forHost`, which dashi-secretd answers only for a host the item
 * lists. Without one, the session's ANTHROPIC_API_KEY, which is where
 * Claude's own tools look today.
 *
 * The launcher's answerer runs in the shell, not in an agent's sandbox, so
 * the key reaches the Anthropic client here and nowhere else: never logged,
 * never shown, never sent to the model, never in an agent's environment
 * (agents started through dashi-agent hold `dashi:anthropic` instead).
 */

import type { VaultTokens } from "../secrets/vault.ts";
import { hostListed } from "../tokens/swap.ts";
import { ANTHROPIC_HOST } from "./claude.ts";

/** The vault item's name for Claude's key (tokens/model-keys.ts `MODEL_KEYS`). */
export const ANTHROPIC_TOKEN = "anthropic";

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

export interface ModelKeys {
  /** The key and where it came from; null when there is none. */
  anthropic(): Promise<{ key: string; place: Exclude<KeyPlace, "none"> } | null>;
  /** Where the key is, without asking the vault for it. */
  place(): Promise<KeyPlace>;
}

export function modelKeys(vault: TokenSource | null, env: Record<string, string | undefined> = process.env): ModelKeys {
  const fromEnv = () => env.ANTHROPIC_API_KEY?.trim() || null;
  return {
    async anthropic() {
      try {
        const kept = await vault?.token(ANTHROPIC_TOKEN, ANTHROPIC_HOST);
        if (kept) return { key: kept, place: "vault" };
      } catch {
        // The vault is locked or has no such item: the session's key, if any.
      }
      const key = fromEnv();
      return key ? { key, place: "environment" } : null;
    },
    async place() {
      try {
        if (await vault?.holds(ANTHROPIC_TOKEN, ANTHROPIC_HOST)) return "vault";
      } catch {
        // Not answering: as if it weren't there.
      }
      return fromEnv() ? "environment" : "none";
    },
  };
}

/** Where the key is, for Settings, without handing it out. */
export const keyPlace = (keys: ModelKeys): Promise<KeyPlace> => keys.place();
