/**
 * A site the person types, read (Work alone's sites use it: agents-alone-parts.tsx). Settings › Agents no
 * longer has "Sites agents may use": no site asks any more (decisions.md D260).
 */

import { siteFromInput } from "../../../agents/sites.ts";

/** What the field holds, read as a site to add: the site, or why it can't be. */
export function siteToAdd(text: string, listed: readonly string[]): { site: string } | { problem: string | null } {
  if (!text.trim()) return { problem: null };
  const site = siteFromInput(text);
  if (!site) return { problem: "Type a site, like bodytech.com.co" };
  if (listed.includes(site)) return { problem: `${site} is on the list` };
  return { site };
}
