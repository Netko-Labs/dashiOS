/**
 * The accounts an extension may use (applet.json `accounts`; store-v2 spec § 4.4,
 * docs/launcher-extensions.md "Accounts"): a provider and the scopes it asks
 * for there. The shell signs the person in (OAuth with PKCE, in Helium), keeps
 * the token in the Secret Service under the extension's id, and hands it over
 * the channel; the extension never sees a password or a client secret. Each
 * account needs its permission (`account:github.com`), shown before install.
 *
 *   "permissions": ["network:api.github.com", "account:github.com"],
 *   "accounts": [{ "provider": "github.com", "scopes": ["repo"] }]
 */

import { isRefusal, list, type Refusal, record, refuse } from "@dashi/shape/kit";
import { type Permission, refusedProvider } from "./permissions.ts";

export interface AccountWanted {
  provider: string;
  scopes: string[];
}

/** A scope as providers write them: `repo`, `read:org`, `user:email`. */
const SCOPE = /^[a-z][a-z0-9_.:-]{0,39}$/;

function parseAccount(value: unknown, where: string): AccountWanted | Refusal {
  const fields = record(value, where, ["provider", "scopes"]);
  if (isRefusal(fields)) return fields;
  if (typeof fields.provider !== "string") return refuse(`${where}: provider must be a host name`);
  if (refusedProvider(fields.provider)) return refuse(`${where}: Dashi never signs in to ${fields.provider} for an extension`);
  const scopes = list(fields.scopes ?? [], `${where}: scopes`, 12, (scope, at) =>
    typeof scope === "string" && SCOPE.test(scope) ? scope : refuse(`${at} is not a scope`),
  );
  if (isRefusal(scopes)) return scopes;
  return { provider: fields.provider, scopes };
}

/** applet.json's `accounts`: each provider once, and each with its `account:PROVIDER` permission. */
export function parseAccounts(value: unknown, permissions: readonly Permission[]): AccountWanted[] | Refusal {
  const accounts = list(value, "accounts", 4, parseAccount);
  if (isRefusal(accounts)) return accounts;
  const providers = accounts.map((each) => each.provider);
  const twice = providers.find((each, at) => providers.indexOf(each) !== at);
  if (twice) return refuse(`accounts names ${twice} twice`);
  const missing = providers.find((provider) => !permissions.some((each) => each.kind === "account" && each.provider === provider));
  return missing ? refuse(`accounts: ${missing} needs the permission “account:${missing}”`) : accounts;
}

/** The accounts it may use: those it declares, and a bare `account:PROVIDER` permission with no scopes. */
export function accountsOf(manifest: { accounts?: readonly AccountWanted[]; permissions: readonly Permission[] }): AccountWanted[] {
  const declared = [...(manifest.accounts ?? [])];
  for (const permission of manifest.permissions)
    if (permission.kind === "account" && !declared.some((each) => each.provider === permission.provider))
      declared.push({ provider: permission.provider, scopes: [] });
  return declared;
}
