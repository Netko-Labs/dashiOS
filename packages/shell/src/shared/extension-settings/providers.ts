/**
 * The providers Dashi can sign an extension in to (store-v2 spec § 4.4):
 * where the person says yes (in Helium), where the code becomes a token, and
 * where Dashi asks who they are. Dashi registers one OAuth app of its own per
 * provider and keeps only its client id here: a public value, as every
 * desktop app's is. **No client secret is ever in the package**: the code is
 * bound to this sign-in by PKCE (lib/pkce.ts), which is what a secret would
 * otherwise stand for, and a secret shipped to every computer would be no
 * secret (decisions.md D464).
 *
 * The owner creates GitHub's app (dashi-0.9.0-review/48-launcher-forms/README.md
 * says how) and puts its client id in `GITHUB_CLIENT_ID`;
 * `DASHI_GITHUB_CLIENT_ID` overrides it for a test run. Until then Connect
 * says so, and a token can still be pasted.
 *
 * Claude's and ChatGPT's subscriptions are never providers (@dashi/applet
 * `refusedProvider`, D460).
 */

import { refusedProvider } from "@dashi/applet";

/** Dashi's own GitHub OAuth app's client id (public; not a secret). Empty until the owner registers the app. */
export const GITHUB_CLIENT_ID = "";

export interface Provider {
  /** The host extensions name it by (`account:github.com`). */
  id: string;
  /** What a person calls it. */
  name: string;
  authorize: string;
  token: string;
  /** Who the token belongs to: answers JSON with `login`. */
  user: string;
  clientId: string;
  /** The words a person reads on the account's row: where the key is, what the provider sees. */
  kept: string;
}

/** The provider for `id` as this run has it, or null: not one Dashi knows, or one it never signs in to. */
export function providerFor(id: string, env: Record<string, string | undefined> = process.env): Provider | null {
  if (refusedProvider(id)) return null;
  if (id === "github.com")
    return {
      id,
      name: "GitHub",
      authorize: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      user: "https://api.github.com/user",
      clientId: env.DASHI_GITHUB_CLIENT_ID?.trim() || GITHUB_CLIENT_ID,
      kept: "The key is in your keyring; GitHub sees the app as “Dashi”.",
    };
  return null;
}

/** Whether Dashi can sign in there in this build (its app is registered), or only take a pasted token. */
export const canSignIn = (provider: Provider | null): boolean => provider !== null && provider.clientId !== "";
