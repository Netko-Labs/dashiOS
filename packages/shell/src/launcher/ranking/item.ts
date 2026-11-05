/** What the ranking ranks: anything the launcher can show, described by the words it answers to. */

/** What a row is; on a tie, the kinds earlier in this list come first. */
export const RANK_KINDS = ["app", "setting", "command", "pane", "window", "file", "menu"] as const;
export type RankKind = (typeof RANK_KINDS)[number];

export interface RankItem {
  /** Unique in the index; the id history is kept under (an app id, an address, a file URL). */
  id: string;
  kind: RankKind;
  /** The names it answers to: the one shown first (the person's language), then the others (the English one). */
  names: readonly string[];
  /** Other words it is found by ("browser" for Firefox), in any language. */
  keywords?: readonly string[];
  /** Words it answers to only when no other item matches at all ("settings" for a Settings pane), besides its kind's (intents.ts). */
  fallback?: readonly string[];
  /** One of the shell's own (System Settings): wins a tie over an installed app. */
  own?: boolean;
  /**
   * Text another program chose (a window title, a third-party row): shown,
   * never ranked above an exact match of a name Dashi or an app gave.
   */
  foreign?: boolean;
}

/** What history the ranking reads; RankingMemory is one, a test passes its own. */
export interface RankSignals {
  /** How strongly each id was picked for this query or one it begins (folded; see pickKey). */
  picks(query: string): ReadonlyMap<string, number>;
  /** How often and how lately `id` was opened, from anywhere, as a decayed count. */
  frecency(id: string): number;
}
