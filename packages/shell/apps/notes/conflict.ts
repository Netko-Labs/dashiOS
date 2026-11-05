/**
 * What a save does when the file may have changed under the editor (a sync
 * tool, another editor, an agent). Three versions of the note, each as its
 * file's text: `base`, what the file held when the editor last read or wrote
 * it; `disk`, what it holds now (null when it can't be read); `mine`, what
 * is typed. Only one side changed: that side wins. Both changed, and
 * differently: neither is written over. The disk's version stays the note,
 * and what was typed is saved beside it as "Title (conflict)". Pure.
 */

export type SaveOutcome =
  /** Nothing changed on either side. */
  | "nothing"
  /** Both sides made the same change: nothing to write. */
  | "same"
  /** Only the file changed: the editor takes it. */
  | "theirs"
  /** Only the typing changed: write it. */
  | "ours"
  /** Both changed, differently: keep both. */
  | "conflict";

export function saveOutcome(versions: { base: string; disk: string | null; mine: string }): SaveOutcome {
  const { base, disk, mine } = versions;
  // Unreadable now: there is nothing to compare with, so the save goes ahead and says what went wrong.
  if (disk === null) return mine === base ? "nothing" : "ours";
  if (disk === mine) return disk === base ? "nothing" : "same";
  if (mine === base) return "theirs";
  if (disk === base) return "ours";
  return "conflict";
}

/** The title of the copy that keeps what was typed: "Groceries (conflict)"; an untitled note's is "Untitled (conflict)". */
export function conflictTitle(title: string): string {
  return `${title.trim() || "Untitled"} (conflict)`;
}

/** The quiet line that says what happened. */
export function conflictNotice(title: string, copy: string): string {
  return `“${title.trim() || "Untitled"}” changed on disk while you were typing. Your version is saved as “${copy}”.`;
}
