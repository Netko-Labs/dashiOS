/**
 * Finding emoji by name: every word typed starts a word of the emoji's name
 * ("thumb up" finds 👍 "thumbs up sign"), in the groups' order. With nothing
 * typed, the first group. At most `LIMIT`: a view is sent whole, and 160
 * cells (20 lines of 8) is plenty to scroll through.
 */

import { type EmojiGroup, GROUPS } from "./emoji-data.ts";

export interface Emoji {
  char: string;
  name: string;
  group: string;
}

export const LIMIT = 160;

export function allEmoji(groups: readonly EmojiGroup[] = GROUPS): Emoji[] {
  return groups.flatMap((group) =>
    group.emoji.split("\n").map((line) => {
      const space = line.indexOf(" ");
      return { char: line.slice(0, space), name: line.slice(space + 1), group: group.name };
    }),
  );
}

export function findEmoji(all: readonly Emoji[], query: string, limit = LIMIT): Emoji[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return all.filter((each) => each.group === all[0]?.group).slice(0, limit);
  const found = all.filter((each) => {
    const own = each.name.split(/[\s-]+/);
    return words.every((word) => own.some((part) => part.startsWith(word)));
  });
  return found.slice(0, limit);
}
