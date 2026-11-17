/**
 * The gallery (round five, frame 3): a panel beside the column. On the left
 * every widget there is, Dashi's and then those from extensions, with the
 * sizes each offers in words; on the right the chosen one's ink ("prints in
 * mizu": the ingredient shows only here and on the edit tag, #19), what it
 * shows, and a real preview of each size. A press on a preview adds it in
 * that size. Weather's "May go on air" is here, off by default. It has no
 * buttons of its own: the area's bar (Add · Done) and Esc close it.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { glyph } from "../shared/inks/index.ts";
import { printsIn } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { SIZE_ORDER, SPANS, sizeWord, span } from "./layout.ts";
import { WidgetTile } from "./lib/views/widget.tsx";
import type { WidgetInfo, WidgetSize } from "./types.ts";

export const GALLERY = { width: 640, list: 240 } as const;

/** "Mini – Wide", or "Small · Wide" for two. */
export function sizeRange(sizes: readonly WidgetSize[]): string {
  const sorted = [...sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
  if (sorted.length <= 2) return sorted.map(sizeWord).join(" · ");
  return `${sizeWord(sorted[0] ?? "small")} – ${sizeWord(sorted.at(-1) ?? "small")}`;
}

function ListRow({ info, chosen, onPress }: { info: WidgetInfo; chosen: boolean; onPress: () => void }) {
  const { inks } = useWidgetEnv();
  const ink = chosen ? inks.paper : inks.text.ink;
  return (
    <View
      testID={`gallery:${info.kind}`}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: 32,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 8,
        backgroundColor: chosen ? inks.text.ink : "#00000000",
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 3.5,
          ...(info.ink ? { backgroundColor: inks.ink[info.ink] } : { borderWidth: 1.2, borderColor: chosen ? inks.paper : inks.text.tertiary }),
        }}
      />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
          {info.name}
        </Text>
      </View>
      <Text style={{ fontSize: 11.5, color: chosen ? inks.paper : inks.text.tertiary }}>{sizeRange(info.sizes)}</Text>
    </View>
  );
}

export interface GalleryProps {
  infos: readonly WidgetInfo[];
  onAdd: (info: WidgetInfo, size: WidgetSize) => void;
  onClose: () => void;
  mayGoOnAir?: { on: boolean; set(on: boolean): void };
}

export function Gallery({ infos, onAdd, onClose, mayGoOnAir }: GalleryProps) {
  const { inks } = useWidgetEnv();
  const [chosen, setChosen] = useState(infos.find((info) => info.kind === "weather")?.kind ?? infos[0]?.kind);
  const info = infos.find((each) => each.kind === chosen) ?? null;
  const section = (title: string) => (
    <View style={{ marginTop: 10, marginBottom: 4, marginLeft: 4 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: inks.text.secondary }}>{title}</Text>
    </View>
  );
  const rows = (list: readonly WidgetInfo[]) =>
    list.map((each) => <ListRow key={each.kind} info={each} chosen={each.kind === chosen} onPress={() => setChosen(each.kind)} />);
  const theirs = infos.filter((each) => each.kind.startsWith("ext:"));
  return (
    <View
      testID="widget-gallery"
      style={{
        width: GALLERY.width,
        flexDirection: "row",
        padding: 18,
        gap: 18,
        borderRadius: 18,
        backgroundColor: inks.paper,
        borderWidth: 1,
        borderColor: inks.text.hairline,
      }}
    >
      <View onKeyDown={(key) => key.key === "Escape" && onClose()} style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0 }} />
      <View style={{ width: GALLERY.list, flexDirection: "column" }}>
        {section("DASHI")}
        {rows(infos.filter((each) => !each.kind.startsWith("ext:")))}
        {theirs.length > 0 ? section("FROM EXTENSIONS") : null}
        {rows(theirs)}
      </View>
      <View style={{ width: 1, alignSelf: "stretch", backgroundColor: inks.text.hairline }} />
      {info ? <Detail info={info} onAdd={onAdd} {...(mayGoOnAir ? { mayGoOnAir } : {})} /> : null}
    </View>
  );
}

/** The chosen widget: its ink, what it shows, and a real preview of each size it offers (up to Wide). */
function Detail({ info, onAdd, mayGoOnAir }: { info: WidgetInfo; onAdd: GalleryProps["onAdd"]; mayGoOnAir?: GalleryProps["mayGoOnAir"] }) {
  const { inks } = useWidgetEnv();
  const previews = info.sizes.filter((size) => SPANS[size].cols <= 4 && SPANS[size].rows <= 2);
  return (
    <View style={{ flex: 1, flexDirection: "column", gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Svg markup={glyph(info.glyph)} size={14} color={info.ink ? inks.ink[info.ink] : inks.text.ink} />
        <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: inks.text.ink }}>{info.name.toUpperCase()}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 11.5, color: inks.text.tertiary }}>{printsIn(info)}</Text>
        {info.ink ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: inks.ink[info.ink] }} /> : null}
      </View>
      <Text style={{ fontSize: 13, lineHeight: 18, color: inks.text.ink }}>{`${info.blurb}. Press a size to add it.`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        {previews.map((size) => (
          <View key={size} testID={`add:${info.kind}:${size}`} onPress={() => onAdd(info, size)} style={{ flexDirection: "column", gap: 6 }}>
            <WidgetTile kind={info.kind} size={size} width={span(SPANS[size].cols)} height={span(SPANS[size].rows)} air={false} />
            <Text style={{ fontSize: 11.5, color: inks.text.secondary }}>{sizeWord(size)}</Text>
          </View>
        ))}
      </View>
      {info.kind === "weather" && mayGoOnAir ? <OnAirSwitch on={mayGoOnAir.on} set={mayGoOnAir.set} /> : null}
    </View>
  );
}

/** Weather's "May go on air", off by default. */
function OnAirSwitch({ on, set }: { on: boolean; set(on: boolean): void }) {
  const { inks } = useWidgetEnv();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, borderTopWidth: 1, borderColor: inks.text.hairline }}>
      <View style={{ flex: 1, flexDirection: "column" }}>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: inks.text.ink }}>May go on air</Text>
        <Text style={{ fontSize: 12, color: inks.text.secondary }}>
          When rain starts within 15 minutes, Weather may take the tally for up to 2 minutes. Off unless you turn it on.
        </Text>
      </View>
      <View
        testID="may-go-on-air"
        onPress={() => set(!on)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          padding: 2,
          backgroundColor: on ? inks.text.ink : inks.text.hairline,
          alignItems: on ? "flex-end" : "flex-start",
        }}
      >
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: inks.paper }} />
      </View>
    </View>
  );
}
