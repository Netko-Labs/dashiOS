/**
 * The bar's row as the field (docs/night-0.9-contract.md, "bar"): what the
 * bar tells the others, and how a typed task is sent. Tasks themselves are
 * the launcher's Ask tasks (agents/ask/types.ts `TaskView`), which the bar
 * reads as the launcher does; nothing new carries them.
 */

/** The bar's row: at rest (b-01), the field open (b-02, b-03), or showing jobs (b-09, b-10). */
export type BarRowState = { mode: "rest" } | { mode: "field"; text: string } | { mode: "jobs"; count: number };

/** What the others ask of the bar. */
export type BarCommand =
  /** Open the field (a click on the mark does it too). `text` starts it. A tap of the Dashi key opens the launcher, not this. */
  | { do: "open-field"; text?: string }
  /** Dictation while the field is open (b-08): put these words at the field's caret. core sends it only while `bar` is in mode `field`. */
  | { do: "insert"; text: string }
  | { do: "close-field" };

/** A draft longer than this is read whole in the card before it is sent (b-05, b-06). */
export const BAR_DRAFT_CHARS = 120;
