/**
 * The shell's passwords: Dashi's vault, 1Password (through its CLI, when
 * installed), the sources setting, and the login sources made from them,
 * shared by the agents' broker and Settings › Passwords.
 */

import { type TokenRef, token } from "../tokens/index.ts";
import { dashiSource } from "./lib/dashi-source.ts";
import { type OpRunner, onePasswordSource, opRunner, saveToOnePassword } from "./lib/onepassword.ts";
import { PasswordPrefsStore } from "./lib/preferences.ts";
import { fileUsedStore } from "./lib/used.ts";
import type { LoginSource, SourceId } from "./sources.ts";
import { type NewLogin, Vault } from "./vault.ts";

export interface Passwords {
  vault: Vault;
  prefs: PasswordPrefsStore;
  /** The enabled sources, in order. */
  sources(): readonly LoginSource[];
  /** Whether 1Password's CLI is there to ask. */
  onePasswordReady(): boolean;
  /** Save a new login where Settings says (Dashi or 1Password). */
  save(login: NewLogin): Promise<void>;
  /**
   * Token `name` in the vault, as the placeholder and environment an agent
   * started through dashi-agent holds (a model key: `ANTHROPIC_API_KEY=dashi:anthropic`);
   * never the token. Null when it isn't there or the vault doesn't answer.
   */
  token(name: string): Promise<TokenRef | null>;
}

/** `op`, 1Password's CLI, where it is installed. */
function findOp(): string | null {
  return process.env.DASHI_OP || Bun.which("op", { PATH: process.env.PATH ?? "" }) || null;
}

export function startPasswords(): Passwords {
  const vault = new Vault();
  const prefs = new PasswordPrefsStore();
  // `op` is looked for when it's needed, not once at login: installed during the session, it works at once.
  let run: OpRunner | null = null;
  const opNow = (): OpRunner | null => {
    if (!run) {
      const op = findOp();
      if (op) run = opRunner(op);
    }
    return run;
  };
  const dashi = dashiSource(vault);
  let onePassword: LoginSource | null = null;
  const source = (id: SourceId): LoginSource | null => {
    if (id === "dashi") return dashi;
    const runner = opNow();
    if (!runner) return null;
    onePassword ??= onePasswordSource(runner, fileUsedStore());
    return onePassword;
  };
  return {
    vault,
    prefs,
    sources: () => prefs.enabled().flatMap((id) => source(id) ?? []),
    onePasswordReady: () => opNow() !== null,
    token: (name) => token(name, vault.tokens),
    async save(login) {
      if (prefs.getSnapshot().saveTo === "1password") {
        const runner = opNow();
        if (!runner) throw new Error("1Password's CLI (op) isn't installed.");
        await saveToOnePassword(runner, login);
        return;
      }
      await vault.save(login);
    },
  };
}
