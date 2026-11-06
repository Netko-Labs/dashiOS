/**
 * Where Claude's key comes from. First the vault: a token item named
 * "anthropic" for api.anthropic.com ("Tokens that stay home",
 * docs/secrets.md), asked through `token(name, host)` when the vault client
 * has it; dashi-secretd answers only for a host the item lists. Without one,
 * the session's ANTHROPIC_API_KEY, which is where Claude's own tools look
 * today. The key is used for the request and dropped: never logged, never
 * shown, never sent to the model.
 */

import { ANTHROPIC_HOST } from "./claude.ts";

/** The vault item's name for Claude's key. */
export const ANTHROPIC_TOKEN = "anthropic";

/** The part of the vault client this needs; absent while the vault has no tokens. */
export interface TokenSource {
  token(name: string, host?: string): Promise<string | null>;
}

/** Where the key is, as Settings says it. */
export type KeyPlace = "vault" | "environment" | "none";

/** The vault's token API, if the client given has one (an older vault client doesn't). */
export function tokenSource(vault: unknown): TokenSource | null {
  if (typeof vault !== "object" || vault === null) return null;
  const token = (vault as { token?: unknown }).token;
  return typeof token === "function"
    ? { token: (name, host) => Promise.resolve(token.call(vault, name, host)).then((value) => (typeof value === "string" ? value : null)) }
    : null;
}

export interface ModelKeys {
  /** The key and where it came from; null when there is none. */
  anthropic(): Promise<{ key: string; place: Exclude<KeyPlace, "none"> } | null>;
}

export function modelKeys(vault: TokenSource | null, env: Record<string, string | undefined> = process.env): ModelKeys {
  return {
    async anthropic() {
      try {
        const kept = await vault?.token(ANTHROPIC_TOKEN, ANTHROPIC_HOST);
        if (kept) return { key: kept, place: "vault" };
      } catch {
        // The vault is locked or has no such item: the session's key, if any.
      }
      const fromEnv = env.ANTHROPIC_API_KEY?.trim();
      return fromEnv ? { key: fromEnv, place: "environment" } : null;
    },
  };
}

/** Where the key is, for Settings, without handing it out. */
export async function keyPlace(keys: ModelKeys): Promise<KeyPlace> {
  return (await keys.anthropic())?.place ?? "none";
}
