/**
 * What an acting tool says changed, in one set of words for a web page
 * (Dashi's extension sees it: desktop/browser.ts) and a native window (its
 * accessibility tree, read again: window-tree/act.ts), so a model learns one
 * answer: "The page changed around it. A dialog opened: “Sign in”. It is now: …".
 */

import type { PageChanges } from "../../browser/index.ts";

/** The words for `changes` on a `place` ("page" or "window"); `reread` is what to call when nothing could be seen. */
export function changeWords(changes: PageChanges | null, place: "page" | "window" = "page", reread = "read_page"): string {
  if (!changes) return `Dashi couldn't see what the ${place} did: ${reread}.`;
  const parts: string[] = [];
  if (changes.dialog) parts.push(`A dialog opened: “${changes.dialog}”.`);
  if (changes.changed === "none") parts.push(`Nothing in the ${place} changed.`.replace("in the page", "on the page"));
  else parts.push(changes.changed === "near" ? `The ${place} changed around it.` : `The ${place} changed, though not around it.`);
  if (changes.appeared) parts.push(`New text: “${changes.appeared}”.`);
  if (!changes.still) parts.push(`The element is gone from the ${place} now.`);
  else if (changes.now) parts.push(`It is now: ${changes.now}.`);
  if (changes.focus) parts.push(`The keyboard is on: ${changes.focus}.`);
  return parts.join(" ");
}
