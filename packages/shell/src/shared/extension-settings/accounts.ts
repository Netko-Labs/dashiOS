/**
 * An extension's connected accounts (store-v2 spec § 4.4; S5's Account row):
 * the token (and a refresh token, when the provider gives one) in the Secret
 * Service under the extension's id (`account <provider>`), never on disk,
 * and beside its data folder, outside its sandbox, only who it is and
 * whether the person already said yes once (`applet-data/<id>.accounts.json`).
 *
 * The first sign-in asks the person once (D260's "secrets and identity");
 * after that Connect just signs in. A pasted token is checked with the
 * provider (who is it?) before it is kept.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type AccountGiven, accountsOf, type Manifest } from "@dashi/applet";
import { isRecord } from "@dashi/shape";
import { type Provider, providerFor } from "./providers.ts";
import { type Secrets, secretTool } from "./secrets.ts";
import { loginOf, type SignedIn, type SignInNeeds, signIn } from "./sign-in.ts";

/** What is known of one provider's account without opening the keyring. */
interface Known {
  login?: string;
  /** The person said yes to signing in here, once. */
  asked?: boolean;
}

/** An account's row as Settings… and the launcher show it. */
export interface AccountRow {
  provider: Provider | null;
  id: string;
  scopes: readonly string[];
  login: string | null;
  asked: boolean;
}

export class ExtensionAccounts {
  constructor(
    private readonly dataRoot: string,
    private readonly secrets: Secrets = secretTool,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private file(id: string): string {
    return join(this.dataRoot, `${id}.accounts.json`);
  }

  private known(id: string): Record<string, Known> {
    const path = this.file(id);
    if (!existsSync(path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(value)) return {};
      const out: Record<string, Known> = {};
      for (const [provider, each] of Object.entries(value))
        if (isRecord(each))
          out[provider] = { ...(typeof each.login === "string" ? { login: each.login } : {}), ...(each.asked === true ? { asked: true } : {}) };
      return out;
    } catch {
      return {};
    }
  }

  private remember(id: string, provider: string, change: Known | null): void {
    const all = this.known(id);
    const next = change === null ? { asked: all[provider]?.asked } : { ...all[provider], ...change };
    const path = this.file(id);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ ...all, [provider]: next }), { mode: 0o600 });
  }

  /** Each account the manifest may use, and who is connected there. */
  rows(manifest: Manifest): AccountRow[] {
    const known = this.known(manifest.id);
    return accountsOf(manifest).map((wanted) => ({
      provider: providerFor(wanted.provider),
      id: wanted.provider,
      scopes: wanted.scopes,
      login: known[wanted.provider]?.login ?? null,
      asked: known[wanted.provider]?.asked === true,
    }));
  }

  /** What the extension is given over the channel: its connected accounts, token and login. */
  async given(manifest: Manifest): Promise<Record<string, AccountGiven>> {
    const out: Record<string, AccountGiven> = {};
    for (const row of this.rows(manifest)) {
      if (!row.login) continue;
      const kept = await this.secrets.get(manifest.id, row.id, "account");
      const token = kept ? tokenOf(kept) : null;
      if (token) out[row.id] = { login: row.login, token };
    }
    return out;
  }

  /** The person said yes to signing in at `provider` for this extension: not asked again. */
  agreed(manifest: Manifest, provider: string): void {
    this.remember(manifest.id, provider, { asked: true });
  }

  /** Keeps a sign-in's tokens; false when the keyring wouldn't. */
  async keep(manifest: Manifest, provider: Provider, signed: SignedIn): Promise<boolean> {
    const { login, ...tokens } = signed;
    const kept = await this.secrets.set(manifest.id, provider.id, `${manifest.name}: ${provider.name} (${login})`, JSON.stringify(tokens), "account");
    if (kept) this.remember(manifest.id, provider.id, { login });
    return kept;
  }

  /** Signs in at `provider` (in Helium, PKCE) for the scopes the manifest asks, and keeps the account. The login, or why not. */
  async connect(manifest: Manifest, provider: Provider, needs: SignInNeeds): Promise<{ login: string } | { error: string }> {
    const scopes = accountsOf(manifest).find((each) => each.provider === provider.id)?.scopes ?? [];
    const signed = await signIn(provider, scopes, { fetch: this.fetcher, ...needs });
    if ("error" in signed) return signed;
    return (await this.keep(manifest, provider, signed)) ? { login: signed.login } : { error: "The keyring wouldn't keep it (is it locked?)." };
  }

  /** A token the person pasted: checked with the provider, then kept as the account. The login, or why not. */
  async paste(manifest: Manifest, provider: Provider, token: string): Promise<{ login: string } | { error: string }> {
    const login = await loginOf(provider, token.trim(), this.fetcher);
    if (!login) return { error: `${provider.name} didn't take that token.` };
    return (await this.keep(manifest, provider, { login, token: token.trim(), scopes: [] }))
      ? { login }
      : { error: "The keyring wouldn't keep it (is it locked?)." };
  }

  /** Forgets the account: the token leaves the keyring; the yes given once stays. */
  async disconnect(manifest: Manifest, provider: string): Promise<void> {
    await this.secrets.clear(manifest.id, provider, "account");
    this.remember(manifest.id, provider, null);
  }
}

/** The access token in what the keyring holds (JSON of the tokens). */
function tokenOf(kept: string): string | null {
  try {
    const value: unknown = JSON.parse(kept);
    return isRecord(value) && typeof value.token === "string" && value.token !== "" ? value.token : null;
  } catch {
    return null;
  }
}
