/**
 * What an extension's view draws besides rows (lib/tree-rows.ts makes the
 * data): a grid's cells (an emoji or a picture, its title under it) and a
 * detail's Markdown with its facts column, 200 wide (store-v2 frames L7,
 * L12). In the launcher's own type, ink and selection (CO-6).
 */

import type { ViewNode } from "@dashi/applet";
import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Row } from "../row-model.ts";
import { type Measures, PANEL, SURFACE } from "./measures.ts";
import { toneInk } from "./row-view.tsx";
import { type DetailPart, toneOf } from "./tree-rows.ts";

/** A grid line is two rows tall: the picture, and its title under it. */
export const GRID_LINE_ROWS = 2;
/** The facts column's width. */
const FACTS = 200;

const prop = (node: ViewNode, name: string): string => {
  const value = node.p[name];
  return typeof value === "string" ? value : "";
};

export function GridCells({
  rows,
  columns,
  selected,
  m,
  onPress,
  onHover,
}: {
  rows: readonly Row[];
  columns: number;
  selected: string | null;
  m: Measures;
  onPress(row: Row): void;
  onHover(row: Row): void;
}) {
  const colors = useColors();
  const width = Math.floor((SURFACE.width - 2 * (PANEL.padding + 1)) / columns);
  const height = m.row * GRID_LINE_ROWS;
  const lines: Row[][] = [];
  for (let at = 0; at < rows.length; at += columns) lines.push(rows.slice(at, at + columns));
  return (
    <>
      {lines.map((line) => (
        <View key={line[0]?.id} style={{ flexDirection: "row", height }}>
          {line.map((row) => {
            const isSelected = row.id === selected;
            return (
              <View
                key={row.id}
                testID={`launcher:cell:${row.id}`}
                onPress={() => onPress(row)}
                onHoverChange={(hovered) => {
                  if (hovered) onHover(row);
                }}
                style={{
                  width,
                  height,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  ...(isSelected ? { backgroundColor: colors.selectionWash, borderWidth: 2, borderColor: colors.selectionBar } : {}),
                }}
              >
                <Text style={{ fontSize: Math.round(m.row * 0.8) }}>{"text" in row.icon ? row.icon.text : ""}</Text>
                <View style={{ maxWidth: width - 8 }}>
                  <Text numberOfLines={1} style={{ fontSize: m.small, color: isSelected ? colors.onSelection : colors.textMuted }}>
                    {row.title}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </>
  );
}

/** A small Markdown: headings, paragraphs, lists, code blocks; inline marks are dropped, links show their words. */
export function markdownBlocks(markdown: string): { kind: "h1" | "h2" | "p" | "li" | "code"; text: string }[] {
  const blocks: { kind: "h1" | "h2" | "p" | "li" | "code"; text: string }[] = [];
  const inline = (text: string): string =>
    text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|`)/g, "")
      .replace(/<[^>]+>/g, "");
  let code: string[] | null = null;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code) blocks.push({ kind: "code", text: code.join("\n") });
      code = code ? null : [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) blocks.push({ kind: (heading[1] ?? "#").length === 1 ? "h1" : "h2", text: inline(heading[2] ?? "") });
    else if (/^[-*+]\s+/.test(trimmed)) blocks.push({ kind: "li", text: inline(trimmed.replace(/^[-*+]\s+/, "")) });
    else blocks.push({ kind: "p", text: inline(trimmed) });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks.slice(0, 80);
}

function Fact({ node, m }: { node: ViewNode; m: Measures }) {
  const colors = useColors();
  if (node.t === "Separator") return <View style={{ height: 1, backgroundColor: colors.separator, marginTop: 4, marginBottom: 4 }} />;
  const value =
    node.t === "TagList" ? (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {node.c.map((tag) => (
          <View
            key={tag.i}
            style={{
              paddingLeft: 6,
              paddingRight: 6,
              height: Math.round(m.small * 1.6),
              borderRadius: 5,
              justifyContent: "center",
              backgroundColor: colors.button,
            }}
          >
            <Text style={{ fontSize: m.small, color: toneInk(colors, toneOf(tag)) }}>{prop(tag, "text")}</Text>
          </View>
        ))}
      </View>
    ) : (
      <Text numberOfLines={1} style={{ fontSize: m.detail, color: node.t === "Link" ? colors.accentInk : colors.text }}>
        {prop(node, "text")}
      </Text>
    );
  return (
    <View style={{ flexDirection: "column", gap: 2, marginBottom: 6 }}>
      <Text style={{ fontSize: m.small, fontWeight: "semibold", color: colors.textMuted }}>{prop(node, "title")}</Text>
      {value}
    </View>
  );
}

export function DetailBody({ detail, height, m }: { detail: DetailPart; height: number; m: Measures }) {
  const colors = useColors();
  const blocks = markdownBlocks(detail.markdown);
  return (
    <View testID="launcher:detail" style={{ flexDirection: "row", height, gap: 12, paddingLeft: 12, paddingRight: 8, paddingTop: 6 }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 6, overflow: "hidden" }}>
        {blocks.map((block, at) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no ids of their own, and the order is the document's
            key={at}
            style={{
              fontSize: block.kind === "h1" ? m.title + 4 : block.kind === "h2" ? m.title + 1 : block.kind === "code" ? m.detail : m.title,
              color: colors.text,
              ...(block.kind === "h1" || block.kind === "h2" ? { fontWeight: "semibold" } : {}),
              ...(block.kind === "code" ? { fontFamily: "monospace", backgroundColor: colors.button } : {}),
            }}
          >
            {block.kind === "li" ? `•  ${block.text}` : block.text}
          </Text>
        ))}
      </View>
      {detail.facts.length > 0 && (
        <View style={{ width: FACTS, flexDirection: "column", borderLeftWidth: 1, borderColor: colors.separator, paddingLeft: 12 }}>
          {detail.facts.map((node) => (
            <Fact key={node.i} node={node} m={m} />
          ))}
        </View>
      )}
    </View>
  );
}
