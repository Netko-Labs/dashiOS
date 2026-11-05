/**
 * Dashi's decorative tints: the one list for color that only tells things
 * apart (Settings' sidebar tiles, calendar colors, store categories, a
 * letter standing in for a missing icon). Each is named for something in a
 * Japanese kitchen, like the job colors, and none of them is a job color:
 * no kombu (selected), ume (destroy), broth (warning), moss (success), or
 * shiso (agents), so a tint never says something it doesn't mean. White
 * glyphs and text read on every one (at least 3.5:1), in both modes.
 */

export const TINTS = {
  /** 水 · water: a calm blue. */
  mizu: "#3D7AB0",
  /** わかめ · wakame: a sea teal, bluer than kombu. */
  wakame: "#2B8597",
  /** 抹茶 · matcha: an olive green, yellower than moss. */
  matcha: "#6F8A2A",
  /** かぼちゃ · kabocha: pumpkin orange. */
  kabocha: "#C66F22",
  /** 味噌 · miso: amber brown. */
  miso: "#A06C35",
  /** 椎茸 · shiitake: a mushroom brown. */
  shiitake: "#7E5E45",
  /** 海苔 · nori: a slate, blue-gray. */
  nori: "#4A6478",
  /** 胡麻 · goma: sesame, a warm graphite. */
  goma: "#706C66",
} as const;

export type TintName = keyof typeof TINTS;

/** The tints in the order a list takes them in turn (new calendars, letter tiles). */
export const TINT_ORDER: readonly TintName[] = ["mizu", "wakame", "matcha", "kabocha", "miso", "nori", "shiitake", "goma"];

/** The tints' values, in `TINT_ORDER`. */
export const TINT_VALUES: readonly string[] = TINT_ORDER.map((name) => TINTS[name]);

/** A tint picked by `key` that stays the same for the same key (an app's letter tile by its name). */
export function tintFor(key: string): string {
  let sum = 0;
  for (const char of key) sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  return TINT_VALUES[sum % TINT_VALUES.length] ?? TINTS.goma;
}
