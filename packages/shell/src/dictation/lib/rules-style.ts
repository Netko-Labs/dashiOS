/**
 * A profile's last touches on the words (compose.ts): the capital a
 * sentence starts with, the full stop at the very end, and an email's
 * greeting on a line of its own. A shell's prompt takes words, not
 * sentences: no capital, no full stop.
 */

import type { Profile } from "../types.ts";

/** The first letter in lower case, unless the word is a name: all capitals, an inner capital, "I", or one the vocabulary writes with a capital. */
export function lowerStart(text: string, names: ReadonlySet<string>): string {
  const first = /^[\p{L}\p{N}'’_-]+/u.exec(text)?.[0];
  if (!first || !/^\p{Lu}\p{Ll}*$/u.test(first.replace(/['’].*$/, "")) || first === "I" || /^I['’]/.test(first)) return text;
  if (names.has(first.toLowerCase())) return text;
  return first.charAt(0).toLowerCase() + text.slice(1);
}

const sentences = (text: string): number => (text.match(/[.!?…](?=\s+\S)/g)?.length ?? 0) + 1;

/** The full stop at the very end, as the profile wants it. A question mark always stays. */
export function finalPeriod(text: string, period: Profile["period"]): string {
  if (period === "keep" || !/[^.]\.$/.test(text)) return text;
  if (period === "drop-single" && (sentences(text) > 1 || text.includes("\n"))) return text;
  return text.slice(0, -1);
}

const GREETING = /^((?:Hi|Hello|Hey|Dear|Hola|Buenos días|Buenas tardes|Buenas noches|Estimad[oa])(?: \p{Lu}[\p{L}'’-]*){1,3})[,.]? +(?=\S)/u;

/** "Hi Alex, thanks for…" → the greeting, a blank line, and the rest starting a sentence. */
export function greeting(text: string): string {
  const found = GREETING.exec(text);
  if (!found?.[1]) return text;
  const rest = text.slice(found[0].length);
  return `${found[1]},\n\n${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}

/** The words as the profile types them; `shell` is a shell's prompt with no agent in it. */
export function applyStyle(text: string, profile: Profile, shell: boolean, names: ReadonlySet<string>): string {
  if (shell) return finalPeriod(lowerStart(text, names), "drop");
  let out = profile.capitals ? text : lowerStart(text, names);
  if (profile.greeting) out = greeting(out);
  return finalPeriod(out, profile.period);
}
