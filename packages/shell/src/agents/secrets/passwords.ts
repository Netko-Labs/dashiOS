/**
 * The shell's passwords: Dashi's vault, 1Password (through its CLI, when
 * installed), the sources setting, and the login sources made from them,
 * shared by the agents' broker and Settings › Passwords.
 */

import { dashiSource } from "./dashi-source.ts";
import { onePasswordSource, opRunner, saveToOnePassword } from "./onepassword.ts";
import { PasswordPrefsStore } from "./preferences.ts";
import type { LoginSource, SourceId } from "./sources.ts";
import { fileUsedStore } from "./used.ts";
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
}

/** `op`, 1Password's CLI, where it is installed. */
function findOp(): string | null {
  return process.env.DASHI_OP || Bun.which("op") || null;
}

export function startPasswords(): Passwords {
  const vault = new Vault();
  const prefs = new PasswordPrefsStore();
  const op = findOp();
  const run = op ? opRunner(op) : null;
  const all: Partial<Record<SourceId, LoginSource>> = { dashi: dashiSource(vault), ...(run ? { "1password": onePasswordSource(run, fileUsedStore()) } : {}) };
  return {
    vault,
    prefs,
    sources: () => prefs.enabled().flatMap((id) => all[id] ?? []),
    onePasswordReady: () => run !== null,
    async save(login) {
      if (prefs.getSnapshot().saveTo === "1password") {
        if (!run) throw new Error("1Password's CLI (op) isn't installed.");
        await saveToOnePassword(run, login);
        return;
      }
      await vault.save(login);
    },
  };
}
