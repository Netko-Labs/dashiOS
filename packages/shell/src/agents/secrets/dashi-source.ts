/** Dashi's vault as a login source (sources.ts). */

import type { Login, LoginSource } from "./sources.ts";
import type { Vault } from "./vault.ts";

export function dashiSource(vault: Pick<Vault, "logins" | "password" | "code">): LoginSource {
  const id = (login: Login): number => {
    const n = Number(login.id);
    if (login.source !== "dashi" || !Number.isInteger(n)) throw new Error("not a login of Dashi's vault");
    return n;
  };
  return {
    id: "dashi",
    async logins(site) {
      return (await vault.logins(site)).map((login) => ({
        source: "dashi",
        id: String(login.id),
        site: login.site,
        account: login.account,
        agents: login.agents,
        hasCode: login.hasCode,
        lastUsed: login.lastUsed,
      }));
    },
    // Always for an agent: the vault refuses a login marked "Never" itself too.
    password: (login) => vault.password(id(login), true),
    code: (login) => vault.code(id(login), true),
  };
}
