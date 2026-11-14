/**
 * A sentence that names keys ("Hold ❖Space or the Copilot key to talk"):
 * the one place such a sentence is drawn. Text fonts do not carry ❖ ⌥ ⌃ ⇧,
 * and the font the host falls back to draws them at half the size of the
 * words around them. So the key glyphs are drawn as `Shortcut` draws them,
 * at the size of the text, and the sentence is laid out a word at a time in
 * a row that wraps; a key and the word it is written against ("❖Space")
 * stay one piece. A sentence with no key glyph is a plain `Text`.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { KEY_GLYPHS, shortcutParts } from "./shortcut.tsx";

/** Whether `text` holds a key glyph a font may not carry. */
export const namesKeys = (text: string): boolean => [...text].some((char) => KEY_GLYPHS[char] !== undefined);

/** A glyph's box beside text of `fontSize`: a little over it, since a glyph keeps room at its sides. */
export const keyGlyphSize = (fontSize: number): number => Math.round(fontSize * 1.15);

/** The room between two words, as a space in the text's font takes. */
const SPACE = 0.28;

export interface KeyedTextStyle {
  fontSize: number;
  color: string;
  fontWeight?: "normal" | "medium" | "semibold" | "bold";
  lineHeight?: number;
}

/** `oneLine`: it never wraps (a capsule's line, a chip's): its words stay on one line, cut at the end when they are plain text. */
export function KeyedText({ children, style, testID, oneLine = false }: { children: string; style: KeyedTextStyle; testID?: string; oneLine?: boolean }) {
  if (!namesKeys(children)) {
    const words = (
      <Text {...(oneLine ? { numberOfLines: 1 } : {})} style={style}>
        {children}
      </Text>
    );
    return testID === undefined ? words : <View testID={testID}>{words}</View>;
  }
  const glyph = keyGlyphSize(style.fontSize);
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      accessibilityLabel={children}
      style={{ flexDirection: "row", flexWrap: oneLine ? "nowrap" : "wrap", alignItems: "center", columnGap: style.fontSize * SPACE, rowGap: 0 }}
    >
      {children
        .split(/\s+/)
        .filter(Boolean)
        .map((word, at) =>
          namesKeys(word) ? (
            // Words have no identity beyond their place in the sentence.
            <View key={at} testID="keyed-text:key" style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
              {shortcutParts(word).map((part, index) =>
                KEY_GLYPHS[part] ? (
                  <Svg key={index} markup={KEY_GLYPHS[part] as string} size={glyph} color={style.color} />
                ) : (
                  <Text key={index} style={style}>
                    {part}
                  </Text>
                ),
              )}
            </View>
          ) : (
            <Text key={at} {...(oneLine ? { numberOfLines: 1 } : {})} style={style}>
              {word}
            </Text>
          ),
        )}
    </View>
  );
}
