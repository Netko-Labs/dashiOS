/** Which inks a surface paints with: the mode's, the lock's shift, and house lights. */

import { type InkName, type InkTokens, inkTokens, useDark } from "@dashi/ui";

/** The inks for Dark Mode as it is now (or the lock's wash). */
export function useInks(options: { lock?: boolean; dark?: boolean } = {}): InkTokens {
  const dark = useDark();
  return inkTokens((options.dark ?? dark) ? "dark" : "light", options.lock ? { lock: true } : {});
}

/** One ink as drawn: dimmed while the house lights are down, unless it is the card on air. */
export function inkOf(tokens: InkTokens, name: InkName | null, house: { down: boolean; onAir: boolean }): string {
  if (name === null) return tokens.text.ink;
  return house.down && !house.onAir ? tokens.dimmed[name] : tokens.ink[name];
}
