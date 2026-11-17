/**
 * The preview column beside a list (store-v2 frame L11): 236 wide at the
 * list's right, the selected row's preview (row-model.ts `RowPreview`): its
 * words in a block (a copy's text), its picture, or its Markdown, then its
 * facts, each a muted title over its value. In the launcher's own type.
 */

import { useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import type { RowPreview } from "../row-model.ts";
import { markdownBlocks } from "./detail-markdown.ts";
import type { Measures } from "./measures.ts";

/** The column's width (L11). */
export const PREVIEW_WIDTH = 236;

/** How much of a copy's text the block shows: the rest is the row's to paste, not this column's to hold. */
const MOST_TEXT = 600;

function Words({ preview, m }: { preview: RowPreview; m: Measures }) {
  const colors = useColors();
  if (preview.image) return <Image source={preview.image} resizeMode="contain" style={{ width: PREVIEW_WIDTH - 28, height: 132, borderRadius: 6 }} />;
  if (preview.text !== undefined)
    return (
      <View testID="launcher:preview:text" style={{ padding: 8, borderRadius: 6, backgroundColor: colors.button }}>
        <Text style={{ fontSize: m.detail, fontFamily: "monospace", color: colors.text }}>{[...preview.text].slice(0, MOST_TEXT).join("")}</Text>
      </View>
    );
  if (preview.markdown)
    return (
      <View style={{ flexDirection: "column", gap: 4 }}>
        {markdownBlocks(preview.markdown).map((block, at) => (
          // Blocks have no ids of their own; the order is the document's.
          <Text key={at} style={{ fontSize: m.detail, color: colors.text, ...(block.kind === "h1" || block.kind === "h2" ? { fontWeight: "semibold" } : {}) }}>
            {"text" in block ? (block.kind === "li" ? `•  ${block.text}` : block.text) : ""}
          </Text>
        ))}
      </View>
    );
  return null;
}

export function PreviewColumn({ preview, m }: { preview: RowPreview | undefined; m: Measures }) {
  const colors = useColors();
  return (
    <View
      testID="launcher:preview"
      style={{
        width: PREVIEW_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        gap: 10,
        borderLeftWidth: 1,
        borderColor: colors.separator,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 14,
        paddingRight: 12,
        overflow: "hidden",
      }}
    >
      {preview && <Words preview={preview} m={m} />}
      {preview?.facts.map((fact) => (
        <View key={fact.title} style={{ flexDirection: "column", gap: 1 }}>
          <Text style={{ fontSize: m.small, color: colors.textMuted }}>{fact.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: m.detail, color: colors.text }}>
            {fact.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
