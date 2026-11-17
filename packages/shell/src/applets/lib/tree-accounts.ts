/**
 * A view's `connect` action (Action.ConnectAccount; store-v2 spec § 4.4), as
 * the shell answers it: already connected says so; a provider Dashi has no
 * app for yet asks for a token in the field instead; the first sign-in asks
 * the one question (D260: secrets and identity); after that it signs in.
 * Signing in is the shell's, in Helium, with PKCE (shared/extension-settings).
 */

import type { AccountGiven, Manifest } from "@dashi/applet";
import type { TreeActed } from "../../actions/index.ts";
import { type AccountRow, canSignIn, type Provider } from "../../shared/extension-settings/index.ts";

/** What a view's session reaches of the extension's accounts (boot/apps.ts binds ExtensionAccounts to the browser). */
export interface SessionAccounts {
  given(manifest: Manifest): Promise<Record<string, AccountGiven>>;
  rows(manifest: Manifest): AccountRow[];
  agreed(manifest: Manifest, provider: string): void;
  connect(manifest: Manifest, provider: Provider): Promise<{ login: string } | { error: string }>;
  paste(manifest: Manifest, provider: Provider, token: string): Promise<{ login: string } | { error: string }>;
}

/** The name an account's token is asked for by, in the field (TreeActed `ask`). */
export const ACCOUNT_ASK = "account:";

/** What choosing `connect` for `provider` comes to before anything signs in. */
export function connectAsked(manifest: Manifest, provider: string, accounts: SessionAccounts | undefined): TreeActed | Provider {
  const row = accounts?.rows(manifest).find((each) => each.id === provider);
  const known = row?.provider ?? null;
  if (!accounts || !known || !row) return { kind: "failed", error: `${manifest.name} can't use a ${provider} account` };
  if (row.login) return { kind: "done", notice: `Connected to ${known.name} as ${row.login}` };
  // No app registered for this build: a token pasted is the way (it is checked with the provider before it is kept).
  if (!canSignIn(known)) return { kind: "ask", name: `${ACCOUNT_ASK}${provider}`, title: `${known.name} token`, secret: true };
  if (!row.asked) return { kind: "confirm", provider, question: `Sign in to ${known.name} for ${manifest.name}? ${known.kept}`, yes: "Sign In" };
  return known;
}

/** The provider an extension may sign in to, as its account rows have it (null: it may not, or Dashi doesn't know it). */
export const providerOf = (manifest: Manifest, provider: string, accounts: SessionAccounts | undefined): Provider | null =>
  accounts?.rows(manifest).find((each) => each.id === provider)?.provider ?? null;

/** Signs in (the browser opens) and says how it went when it is done; the launcher closes meanwhile. */
export function startSignIn(
  manifest: Manifest,
  provider: Provider,
  accounts: SessionAccounts,
  done: (outcome: { login: string } | { error: string }) => void,
): TreeActed {
  accounts.agreed(manifest, provider.id);
  void accounts.connect(manifest, provider).then(done, (error: unknown) => done({ error: String(error) }));
  return { kind: "done", close: true, notice: `Sign in to ${provider.name} in Helium` };
}
