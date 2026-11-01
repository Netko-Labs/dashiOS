/** A note drawn from its Markdown: headings, quotes, lists, code, and checklists whose boxes can be tapped. */

import { Svg, Text, View } from "@mirinjs/metal";
import { useColors, useSurface } from "@dashi/ui";
import { type Block, parseBlocks } from "./checklist.ts";
import { TICK } from "./glyphs.ts";

const HEADING_SIZE = [0, 22, 19, 16, 15, 14, 14] as const;

function Box({ checked, onPress, testID }: { checked: boolean; onPress: () => void; testID: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        width: 18,
        height: 18,
        marginTop: 1,
        flexShrink: 0,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1.5,
        borderColor: checked ? colors.selection : colors.checkbox,
        backgroundColor: checked ? colors.selection : "#00000000",
      }}
    >
      {checked && <Svg markup={TICK} size={11} color="#ffffff" />}
    </View>
  );
}

function BlockView({ block, onToggle }: { block: Block; onToggle: (line: number) => void }) {
  const colors = useColors();
  const surface = useSurface();
  switch (block.kind) {
    case "heading":
      return (
        <Text style={{ fontSize: HEADING_SIZE[block.level] ?? 14, fontWeight: "bold", color: colors.text, lineHeight: (HEADING_SIZE[block.level] ?? 14) + 8 }}>
          {block.text}
        </Text>
      );
    case "check":
      return (
        <View style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
          <Box checked={block.checked} testID={`check:${block.line}`} onPress={() => onToggle(block.line)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: block.checked ? colors.textMuted : colors.text, textDecorationLine: block.checked ? "line-through" : "none" }}>{block.text}</Text>
          </View>
        </View>
      );
    case "bullet":
      return (
        <View style={{ flexDirection: "row", gap: 9, paddingLeft: block.indent * 18, alignItems: "flex-start" }}>
          <View style={{ width: 18 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: "center" }}>•</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>{block.text}</Text>
          </View>
        </View>
      );
    case "number":
      return (
        <View style={{ flexDirection: "row", gap: 9, paddingLeft: block.indent * 18, alignItems: "flex-start" }}>
          <View style={{ minWidth: 18 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: "right" }}>{block.label}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>{block.text}</Text>
          </View>
        </View>
      );
    case "quote":
      return (
        <View style={{ borderLeftWidth: 3, borderColor: colors.separator, paddingLeft: 12 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted, fontStyle: "italic" }}>{block.text}</Text>
        </View>
      );
    case "code":
      return (
        <View style={{ backgroundColor: surface.field, paddingHorizontal: 10, paddingVertical: 1, borderRadius: 4 }}>
          <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: "monospace", color: colors.text }}>{block.text === "" ? " " : block.text}</Text>
        </View>
      );
    case "rule":
      return <View style={{ height: 1, marginTop: 8, marginBottom: 8, backgroundColor: colors.separator }} />;
    case "blank":
      return <View style={{ height: 8 }} />;
    case "text":
      return <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text }}>{block.text}</Text>;
  }
}

export function Preview({ body, onToggle }: { body: string; onToggle: (line: number) => void }) {
  return (
    <View testID="preview" style={{ flexDirection: "column", gap: 4 }}>
      {parseBlocks(body).map((block, index) => (
        // Lines have no identity beyond their place; the list is replaced whole on every change.
        <BlockView key={index} block={block} onToggle={onToggle} />
      ))}
    </View>
  );
}
