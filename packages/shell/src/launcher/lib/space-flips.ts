/** Space on a row with a switch (launcher/lib/commands.ts): whether it flips the switch or types a space. */

import { startsWithCommand } from "../ranking/commands.ts";
import type { Row } from "../row-model.ts";

/**
 * Whether Space flips the selected row's switch rather than typing a space:
 * when the row has a switch and a space can't be the next letter of its
 * name or words ("wif" then Space flips Wi-Fi; "dark" then Space types on
 * to "dark mode"; "dark mode" then Space flips it). Never in words that
 * start with a command's verb ("turn on dark", "turn on dark mode", which
 * may go on "and email alexk"): that is a sentence being typed, and Return
 * flips it (ranking/commands.ts).
 */
export function spaceFlips(row: Row | undefined, query: string): boolean {
  if (row?.control?.kind !== "switch" || query.trim() === "" || startsWithCommand(query)) return false;
  const typed = `${query.toLowerCase()} `;
  const words = [row.title, ...(row.item?.keywords ?? [])].map((word) => word.toLowerCase());
  return !words.some((word) => word.startsWith(typed));
}
