/**
 * A checklist item, as Notes draws it and a launcher detail (a pull request's
 * `- [ ] If you want to rebase…`) draws it too: the box in place of `[ ]` or
 * `[x]`, open or done, from the type's own glyphs (Inter has both).
 */

/** The box a checklist item is drawn with: open, and done. */
export const TASK_BOX = { open: "□", done: "■" } as const;

/** A list item's words that start with a box (`[ ] …`, `[x] …`): whether it is done, and the words after it; null for any other. */
export function taskOf(words: string): { done: boolean; text: string } | null {
  const box = /^\[([ xX])\](?:\s+|$)/.exec(words);
  return box ? { done: box[1] !== " ", text: words.slice(box[0].length) } : null;
}
