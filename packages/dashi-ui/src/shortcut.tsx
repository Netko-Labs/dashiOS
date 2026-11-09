/**
 * Shortcuts written the Mac way ("⇧❖Z"), drawn with SVG glyphs so they never
 * depend on a font having ❖, ⌃, ⌥, ⇧, ⌫, or the arrows.
 */

import { Svg, Text, View } from "@mirinjs/metal";

const stroke = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${d}" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const diamond = (cx: number, cy: number) => `M${cx} ${cy - 2.7}L${cx + 2.7} ${cy}L${cx} ${cy + 2.7}L${cx - 2.7} ${cy}Z`;

/** Modifier and arrow glyphs; anything else is drawn as text. */
export const KEY_GLYPHS: Record<string, string> = {
  "❖": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${[diamond(8, 4.2), diamond(11.8, 8), diamond(8, 11.8), diamond(4.2, 8)].join("")}" fill="#000"/></svg>`,
  "⌃": stroke("M4 9.5L8 5.5L12 9.5"),
  "⌥": stroke("M2.5 5h3.5l4 7h3.5M10 5h3.5"),
  "⇧": stroke("M8 2.5L13 8H10.5V13.5H5.5V8H3Z"),
  "⌫": stroke("M6 4h7.5v8H6L2.5 8ZM8.5 6.5l3 3M11.5 6.5l-3 3"),
  "←": stroke("M12.5 8H3.5M7 4.5L3.5 8L7 11.5"),
  "→": stroke("M3.5 8H12.5M9 4.5L12.5 8L9 11.5"),
  "↑": stroke("M8 12.5V3.5M4.5 7L8 3.5L11.5 7"),
  "↓": stroke("M8 3.5V12.5M4.5 9L8 12.5L11.5 9"),
  "↩": stroke("M12.5 3.5V8.5H3.5M7 5L3.5 8.5L7 12"),
  "⇥": stroke("M2.5 8H11.5M8 4.5L11.5 8L8 11.5M13.5 4V12"),
};

/** Split "⇧❖Z" or "❖Space" into glyphs and key names. */
export function shortcutParts(keys: string): string[] {
  const parts: string[] = [];
  let word = "";
  for (const char of keys) {
    if (KEY_GLYPHS[char]) {
      if (word) parts.push(word);
      word = "";
      parts.push(char);
    } else {
      word += char;
    }
  }
  if (word) parts.push(word);
  return parts;
}

/**
 * The keys as one run: no gap between the parts, since each glyph's drawing
 * already keeps a little room at its sides, so "❖I" reads as one token.
 */
export function Shortcut({ keys, color, size = 13 }: { keys: string; color: string; size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0 }}>
      {shortcutParts(keys).map((part, index) =>
        KEY_GLYPHS[part] ? (
          <Svg key={index} markup={KEY_GLYPHS[part] as string} size={size} color={color} />
        ) : (
          <Text key={index} style={{ fontSize: size, color }}>
            {part}
          </Text>
        ),
      )}
    </View>
  );
}
