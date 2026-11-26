/** Which inks a surface paints with: the mode's, and house lights. */

import { type InkName, type InkTokens, inkTokens, useDark } from "@dashi/ui";

/** The inks for Dark Mode as it is now, or for the mode asked. */
export function useInks(options: { dark?: boolean } = {}): InkTokens {
  const dark = useDark();
  return inkTokens((options.dark ?? dark) ? "dark" : "light");
}

/** One ink as drawn: dimmed while the house lights are down, unless it is the card on air. */
export function inkOf(tokens: InkTokens, name: InkName | null, house: { down: boolean; onAir: boolean }): string {
  if (name === null) return tokens.text.ink;
  return house.down && !house.onAir ? tokens.dimmed[name] : tokens.ink[name];
}
