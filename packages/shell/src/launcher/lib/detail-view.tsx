/**
 * An extension's detail (store-v2 frames L7, L12): its Markdown, which
 * scrolls (the wheel, the touchpad, and the launcher's keys: detail-scroll.ts),
 * beside its facts column, 200 wide. A table wider than the column scrolls
 * sideways; a rule is a line; a quote has a bar at its left, and GitHub's
 * alerts their word over it in their ink. In the launcher's own type (CO-6).
 */

import type { ViewNode } from "@dashi/applet";
import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { leastWidth, type Table, TableView } from "../../shared/markdown/index.ts";
import type { Tone } from "../row-model.ts";
import { type Alert, inline, type MarkdownBlock, markdownBlocks } from "./detail-markdown.ts";
import { detailScroll } from "./detail-scroll.ts";
import type { Measures } from "./measures.ts";
import { toneInk } from "./row-view.tsx";
import { type DetailPart, toneOf } from "./tree-rows.ts";

/** In a detail's table a column keeps at most this many letters of a word whole, so four columns fit beside the facts. */
const DETAIL_WHOLE_WORD = 12;
/** The facts column's width. */
const FACTS = 200;

/** Each alert's word, and its ink: a note and an important one the accent, a tip moss, a warning broth, a caution ume (D376). */
const ALERT: Readonly<Record<Alert, { word: string; tone: Tone }>> = {
  note: { word: "Note", tone: "accent" },
  tip: { word: "Tip", tone: "moss" },
  important: { word: "Important", tone: "accent" },
  warning: { word: "Warning", tone: "broth" },
  caution: { word: "Caution", tone: "ume" },
};

const prop = (node: ViewNode, name: string): string => {
  const value = node.p[name];
  return typeof value === "string" ? value : "";
};

function Quote({ block, m }: { block: Extract<MarkdownBlock, { kind: "quote" }>; m: Measures }) {
  const colors = useColors();
  const alert = block.alert ? ALERT[block.alert] : null;
  const ink = alert ? toneInk(colors, alert.tone) : colors.separator;
  return (
    <View testID="launcher:detail:quote" style={{ flexDirection: "column", gap: 2, borderLeftWidth: 3, borderColor: ink, paddingLeft: 10 }}>
      {alert && <Text style={{ fontSize: m.title, fontWeight: "semibold", color: ink }}>{alert.word}</Text>}
      {block.text !== "" && <Text style={{ fontSize: m.title, color: alert ? colors.text : colors.textMuted }}>{block.text}</Text>}
    </View>
  );
}

/** A table as wide as the column, its cells wrapping; one wider than that at its least scrolls sideways, as GitHub's does. */
function DetailTable({ table, m }: { table: Table; m: Measures }) {
  const [room, setRoom] = useState(0);
  const letter = m.detail * 0.58;
  const width = Math.max(room, leastWidth(table, letter, DETAIL_WHOLE_WORD, inline));
  return (
    <View
      testID="launcher:detail:table-scroll"
      onLayout={(bounds) => setRoom(Math.floor(bounds.width))}
      style={{ flexShrink: 0, overflow: width > room ? "scroll-x" : "hidden" }}
    >
      <TableView testID="launcher:detail:table" table={table} cellText={inline} size={m.detail} letter={letter} wholeWord={DETAIL_WHOLE_WORD} width={width} />
    </View>
  );
}

/** One block of a detail's Markdown. */
function Block({ block, m }: { block: MarkdownBlock; m: Measures }) {
  const colors = useColors();
  if (block.kind === "rule")
    return <View testID="launcher:detail:rule" style={{ flexShrink: 0, height: 1, backgroundColor: colors.separator, marginTop: 4, marginBottom: 4 }} />;
  if (block.kind === "quote") return <Quote block={block} m={m} />;
  if (block.kind === "table") return <DetailTable table={block.table} m={m} />;
  return (
    <Text
      style={{
        fontSize: block.kind === "h1" ? m.title + 4 : block.kind === "h2" ? m.title + 1 : block.kind === "code" ? m.detail : m.title,
        color: colors.text,
        ...(block.kind === "h1" || block.kind === "h2" ? { fontWeight: "semibold" } : {}),
        ...(block.kind === "code" ? { fontFamily: "monospace", backgroundColor: colors.button } : {}),
      }}
    >
      {block.kind === "li" ? `•  ${block.text}` : block.text}
    </Text>
  );
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
      <View
        testID="launcher:detail:scroll"
        ref={detailScroll.attach}
        onScroll={detailScroll.scrolled}
        scrollEventThrottle={50}
        style={{ flex: 1, minWidth: 0, overflow: "scroll" }}
      >
        <View style={{ flexDirection: "column", gap: 6, paddingBottom: 8 }}>
          {blocks.map((block, at) => (
            // Blocks have no ids of their own, and the order is the document's.
            <Block key={at} block={block} m={m} />
          ))}
        </View>
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
