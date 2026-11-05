/**
 * The shell's passwords: Dashi's vault, the sources setting, and the login
 * sources made from them, shared by the agents' broker and Settings ›
 * Passwords. 1Password joins as a source when it is turned on (onepassword.ts).
 */

import { dashiSource } from "./dashi-source.ts";
import { PasswordPrefsStore } from "./preferences.ts";
import type { LoginSource, SourceId } from "./sources.ts";
import { Vault } from "./vault.ts";

export interface Passwords {
  vault: Vault;
  prefs: PasswordPrefsStore;
  /** The enabled sources, in order. */
  sources(): readonly LoginSource[];
}

export function startPasswords(extra: Partial<Record<SourceId, LoginSource>> = {}): Passwords {
  const vault = new Vault();
  const prefs = new PasswordPrefsStore();
  const all: Partial<Record<SourceId, LoginSource>> = { dashi: dashiSource(vault), ...extra };
  return {
    vault,
    prefs,
    sources: () => prefs.enabled().flatMap((id) => all[id] ?? []),
  };
}
