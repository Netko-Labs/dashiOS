/**
 * OAuth 2.0 for a native app, by the book (RFC 8252, RFC 7636): the browser
 * comes back to a loopback address Dashi listens on for this one sign-in,
 * `state` ties the answer to the question, and PKCE ties the code to this
 * process: the code is worthless without the verifier only Dashi held. No
 * client secret anywhere (providers.ts).
 */

import { isRecord } from "@dashi/shape";
import type { Provider } from "../providers.ts";

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** A verifier (43 characters of 32 random bytes) and its S256 challenge. */
export function pkcePair(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): {
  verifier: string;
  challenge: string;
} {
  const verifier = base64url(random(32));
  return { verifier, challenge: challengeOf(verifier) };
}

/** RFC 7636's S256: the verifier's SHA-256, base64url without padding. */
export function challengeOf(verifier: string): string {
  return base64url(new Uint8Array(new Bun.CryptoHasher("sha256").update(verifier).digest()));
}

export function randomState(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): string {
  return base64url(random(16));
}

/** Where the browser goes: the provider's yes-or-no page for this sign-in. */
export function authorizeUrl(provider: Provider, at: { redirect: string; scopes: readonly string[]; state: string; challenge: string }): string {
  const url = new URL(provider.authorize);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", at.redirect);
  url.searchParams.set("scope", at.scopes.join(" "));
  url.searchParams.set("state", at.state);
  url.searchParams.set("code_challenge", at.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

/** What the callback came back with: the code, or why not (the person said no, or it isn't this sign-in's). */
export function callbackOf(url: URL, state: string): { code: string } | { error: string } {
  if (url.searchParams.get("state") !== state) return { error: "The answer wasn't for this sign-in." };
  const refused = url.searchParams.get("error");
  if (refused) return { error: refused === "access_denied" ? "You said no on the sign-in page." : `The sign-in page said: ${refused}` };
  const code = url.searchParams.get("code");
  return code ? { code } : { error: "The sign-in page sent no code." };
}

/** The body that turns the code into a token: the client id, the code and the verifier; never a secret. */
export function exchangeBody(provider: Provider, code: string, redirect: string, verifier: string): URLSearchParams {
  return new URLSearchParams({ client_id: provider.clientId, code, redirect_uri: redirect, code_verifier: verifier, grant_type: "authorization_code" });
}

export interface Tokens {
  token: string;
  scopes: string[];
  refresh?: string;
  /** When the token stops working (ms since 1970), if it does. */
  expires?: number;
}

/** The provider's answer to the exchange (or a refresh), parsed; or its words when it said no. */
export function tokensOf(value: unknown, now: number): Tokens | { error: string } {
  if (!isRecord(value)) return { error: "The provider's answer wasn't JSON." };
  if (typeof value.error === "string") return { error: typeof value.error_description === "string" ? value.error_description : value.error };
  if (typeof value.access_token !== "string" || value.access_token === "") return { error: "The provider sent no token." };
  const scopes = typeof value.scope === "string" ? value.scope.split(/[\s,]+/).filter(Boolean) : [];
  return {
    token: value.access_token,
    scopes,
    ...(typeof value.refresh_token === "string" ? { refresh: value.refresh_token } : {}),
    ...(typeof value.expires_in === "number" ? { expires: now + value.expires_in * 1000 } : {}),
  };
}
