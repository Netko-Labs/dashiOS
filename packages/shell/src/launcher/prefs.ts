/**
 * The person's launcher aliases and keys, kept in settings.json
 * (`launcher.aliases`, `launcher.keys`; person-keys.ts) through the Settings
 * store, which follows the file: an edit by hand, or Set alias… in another
 * launcher, shows up here at once, and the keys reach the compositor
 * without restarting the shell (boot/keys.ts listens and sends the keymap).
 */

import type { LauncherSettings } from "../settings-app/types.ts";
import { aliasIndex, keyOf, personRules, withAlias, withKey } from "./person-keys.ts";

/** The part of the Settings store this needs (settings-app/store.ts `SettingsStore`). */
export interface PrefsStore {
  getSnapshot(): { data: { launcher: LauncherSettings } };
  subscribe(listener: () => void): () => void;
  patch(section: "launcher", change: LauncherSettings): void;
}

export interface LauncherPrefsSnapshot {
  /** Folded alias → address. */
  aliases: ReadonlyMap<string, string>;
  aliasOf(address: string): string | undefined;
  /** The key bound to an address, as glyphs. */
  keyOf(address: string): string | undefined;
}

export class LauncherPrefs {
  private snapshot: LauncherPrefsSnapshot;
  private seen: LauncherSettings;

  constructor(private readonly store: PrefsStore) {
    this.seen = store.getSnapshot().data.launcher;
    this.snapshot = this.build(this.seen);
  }

  private build(settings: LauncherSettings): LauncherPrefsSnapshot {
    const aliases = settings.aliases ?? {};
    const keys = settings.keys ?? {};
    return {
      aliases: aliasIndex(aliases),
      aliasOf: (address) => Object.entries(aliases).find(([, target]) => target === address)?.[0],
      keyOf: (address) => keyOf(keys, address),
    };
  }

  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  getSnapshot = (): LauncherPrefsSnapshot => {
    const now = this.store.getSnapshot().data.launcher;
    if (now !== this.seen) {
      this.seen = now;
      this.snapshot = this.build(now);
    }
    return this.snapshot;
  };

  /** The person's keys as keymap rules (keymap-state.ts `setPersonRules`). */
  rules(): ReturnType<typeof personRules> {
    return personRules(this.store.getSnapshot().data.launcher.keys ?? {});
  }

  /** Give `address` this alias, or take its alias away (null). */
  setAlias(address: string, alias: string | null): void {
    const aliases = withAlias(this.store.getSnapshot().data.launcher.aliases ?? {}, address, alias);
    this.store.patch("launcher", { aliases: Object.keys(aliases).length > 0 ? aliases : undefined });
  }

  /** Bind `address` to the chord `when`, or unbind it (null). */
  setKey(address: string, when: string | null): void {
    const keys = withKey(this.store.getSnapshot().data.launcher.keys ?? {}, address, when);
    this.store.patch("launcher", { keys: Object.keys(keys).length > 0 ? keys : undefined });
  }
}
