/**
 * The gallery (round five, frame 3): a panel beside the column. On the left
 * every widget there is, Dashi's and then those from extensions, with the
 * sizes each offers in words; on the right the chosen one's ink ("prints in
 * mizu": the ingredient shows only here and on the edit tag, #19), what it
 * shows, and a real preview of each size. A press on a preview adds it in
 * that size. Weather's "May go on air" is here, off by default. It has no
 * buttons of its own: the area's bar (Add · Done) and Esc close it; ↑ ↓
 * choose in the list, ← → pick a size (ringed) and Return adds it.
 * On glass (frost-objects board 22): regular, radius 18; its previews are
 * paper's solid twin (glass under glass, GL-2); the chosen kind wears the
 * neutral pick (ink 10 % and a 3-point ink bar: the accent never paints
 * here, H23); the picked size is ringed in ink (EDIT_RING).
 */

import { CLEAR, Frosted, inkPick, pill, RADIUS, SHADOW, SPACE, Switch, TYPE, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { glyph } from "../shared/inks/index.ts";
import { printsIn } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { SIZE_ORDER, SPANS, sizeWord, span } from "./layout.ts";
import { EDIT_RING } from "./lib/edit-ring.ts";
import { oneRow, WidgetTile } from "./lib/views/widget.tsx";
import type { WidgetInfo, WidgetSize } from "./types.ts";

/** Its width, its list's, and the least its list keeps on a narrow screen; its corner (regular glass, a widget's 18). */
export const GALLERY = { width: 700, list: 240, leastList: 180, radius: RADIUS.inkCard } as const;
/** What the panel takes besides its list and its previews: its padding, the gaps either side of the divider, and the divider. */
const FRAME = 2 * SPACE.page + 2 * SPACE.page + 1;
/** The previews' least: the widest, Wide (four cells), and its ring. */
const PREVIEWS_LEAST = span(SPANS.wide.cols) + SPACE.m;
/** The narrowest the gallery gets: the least list beside a whole Wide preview. */
export const GALLERY_LEAST = FRAME + GALLERY.leastList + PREVIEWS_LEAST;

/** The gallery's width and its list's in `room` points: 700 when it fits; narrower, the list gives way first, never the previews. */
export function galleryFit(room: number): { width: number; list: number } {
  const width = Math.min(GALLERY.width, Math.max(room, GALLERY_LEAST));
  return { width, list: Math.max(GALLERY.leastList, Math.min(GALLERY.list, width - FRAME - PREVIEWS_LEAST)) };
}

/** "Mini – Wide", or "Small · Wide" for two. */
export function sizeRange(sizes: readonly WidgetSize[]): string {
  const sorted = [...sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
  if (sorted.length <= 2) return sorted.map(sizeWord).join(" · ");
  return `${sizeWord(sorted[0] ?? "small")} – ${sizeWord(sorted.at(-1) ?? "small")}`;
}

/** A list row's measures: 32 tall, its ink dot 7 across; the chosen row's bar 3 wide, 6 in from its top and bottom. */
const ROW = { height: 32, dot: 7, dotEdge: 1.2, bar: 3, barInset: 6 } as const;

function ListRow({ info, chosen, onPress }: { info: WidgetInfo; chosen: boolean; onPress: () => void }) {
  const { inks } = useWidgetEnv();
  return (
    <View
      testID={`gallery:${info.kind}`}
      onPress={onPress}
      accessibilityRole="option"
      accessibilityLabel={info.name}
      accessibilityState={{ selected: chosen }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        height: ROW.height,
        paddingLeft: SPACE.inset,
        paddingRight: SPACE.inset,
        borderRadius: RADIUS.control,
        // Chosen in ink, never the accent (CO-9's neutral look, H23): ink at 10 %, a 3-point ink bar.
        backgroundColor: chosen ? inkPick(inks.text.ink).wash : CLEAR,
      }}
    >
      {chosen ? (
        <View
          testID={`gallery-bar:${info.kind}`}
          style={{
            position: "absolute",
            left: 0,
            top: ROW.barInset,
            bottom: ROW.barInset,
            width: ROW.bar,
            borderRadius: RADIUS.thumb,
            backgroundColor: inkPick(inks.text.ink).bar,
          }}
        />
      ) : null}
      <View
        style={{
          width: ROW.dot,
          height: ROW.dot,
          borderRadius: pill(ROW.dot),
          ...(info.ink ? { backgroundColor: inks.ink[info.ink] } : { borderWidth: ROW.dotEdge, borderColor: inks.text.tertiary }),
        }}
      />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: inks.text.ink }}>
          {info.name}
        </Text>
      </View>
      <Text style={{ fontSize: TYPE.panel.detail.size, color: inks.text.tertiary }}>{sizeRange(info.sizes)}</Text>
    </View>
  );
}

/**
 * The sizes a widget's previews show, those up to Wide, smallest first as
 * its line in the list reads ("Small · Wide"): Return adds the first.
 */
export function previewSizes(info: WidgetInfo): WidgetSize[] {
  return info.sizes.filter((size) => SPANS[size].cols <= 4 && SPANS[size].rows <= 2).sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
}

export interface GalleryProps {
  infos: readonly WidgetInfo[];
  /** The widget chosen in the list, and the size picked among its previews (the keys move them: edit-session.tsx). */
  chosen: string | undefined;
  onChoose: (kind: string) => void;
  sizeAt: number;
  onAdd: (info: WidgetInfo, size: WidgetSize) => void;
  mayGoOnAir?: { on: boolean; set(on: boolean): void };
  /** Its width and its list's (`galleryFit`); 700 and 240 without. */
  fit?: { width: number; list: number };
}

export function Gallery({ infos, chosen, onChoose, sizeAt, onAdd, mayGoOnAir, fit = { width: GALLERY.width, list: GALLERY.list } }: GalleryProps) {
  const { inks } = useWidgetEnv();
  const info = infos.find((each) => each.kind === chosen) ?? null;
  const section = (title: string) => (
    <View style={{ marginTop: SPACE.gap, marginBottom: SPACE.xs, marginLeft: SPACE.xs }}>
      <Text style={{ fontSize: TYPE.inks.small.size, fontWeight: WEIGHT.semibold, color: inks.text.secondary }}>{title}</Text>
    </View>
  );
  const rows = (list: readonly WidgetInfo[]) =>
    list.map((each) => <ListRow key={each.kind} info={each} chosen={each.kind === chosen} onPress={() => onChoose(each.kind)} />);
  const theirs = infos.filter((each) => each.kind.startsWith("ext:"));
  return (
    <Frosted
      level="regular"
      testID="widget-gallery"
      style={{ width: fit.width, flexDirection: "row", padding: SPACE.page, gap: SPACE.page, borderRadius: GALLERY.radius, shadow: SHADOW.xl }}
    >
      <View style={{ width: fit.list, flexDirection: "column" }}>
        {section("DASHI")}
        {rows(infos.filter((each) => !each.kind.startsWith("ext:")))}
        {theirs.length > 0 ? section("FROM EXTENSIONS") : null}
        {rows(theirs)}
      </View>
      <View style={{ width: 1, alignSelf: "stretch", backgroundColor: inks.text.hairline }} />
      {info ? <Detail info={info} sizeAt={sizeAt} onAdd={onAdd} {...(mayGoOnAir ? { mayGoOnAir } : {})} /> : null}
    </Frosted>
  );
}

/** The chosen widget: its ink, what it shows, and a real preview of each size it offers (up to Wide). */
function Detail({
  info,
  sizeAt,
  onAdd,
  mayGoOnAir,
}: {
  info: WidgetInfo;
  sizeAt: number;
  onAdd: GalleryProps["onAdd"];
  mayGoOnAir?: GalleryProps["mayGoOnAir"];
}) {
  const { inks } = useWidgetEnv();
  const previews = previewSizes(info);
  return (
    <View style={{ flex: 1, flexDirection: "column", gap: SPACE.gap }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
        <Svg markup={glyph(info.glyph)} size={14} color={info.ink ? inks.ink[info.ink] : inks.text.ink} />
        <Text style={{ fontSize: TYPE.inks.small.size, fontWeight: WEIGHT.semibold, color: inks.text.ink }}>{info.name.toUpperCase()}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: TYPE.panel.detail.size, color: inks.text.tertiary }}>{printsIn(info)}</Text>
        {info.ink ? <View style={{ width: ROW.dot, height: ROW.dot, borderRadius: pill(ROW.dot), backgroundColor: inks.ink[info.ink] }} /> : null}
      </View>
      <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.panel.name.line, color: inks.text.ink }}>{`${info.blurb}. Press a size to add it.`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.button }}>
        {previews.map((size, at) => (
          <View key={size} testID={`add:${info.kind}:${size}`} onPress={() => onAdd(info, size)} style={{ flexDirection: "column", gap: SPACE.s }}>
            {at === Math.min(sizeAt, previews.length - 1) ? (
              <View
                testID={`picked:${info.kind}:${size}`}
                style={{
                  position: "absolute",
                  left: -EDIT_RING.out,
                  top: -EDIT_RING.out,
                  width: span(SPANS[size].cols) + 2 * EDIT_RING.out,
                  height: span(SPANS[size].rows) + 2 * EDIT_RING.out,
                  borderRadius: EDIT_RING.radius(oneRow(size)),
                  borderWidth: EDIT_RING.width,
                  borderColor: inks.text.ink,
                }}
              />
            ) : null}
            <WidgetTile kind={info.kind} size={size} width={span(SPANS[size].cols)} height={span(SPANS[size].rows)} air={false} solid />
            <Text style={{ fontSize: TYPE.panel.detail.size, color: inks.text.secondary }}>{sizeWord(size)}</Text>
          </View>
        ))}
      </View>
      {info.kind === "weather" && mayGoOnAir ? <OnAirRow on={mayGoOnAir.on} set={mayGoOnAir.set} /> : null}
    </View>
  );
}

/** Weather's "May go on air", off by default: the kit's Switch in the inks look (the accent never paints here). */
function OnAirRow({ on, set }: { on: boolean; set(on: boolean): void }) {
  const { inks } = useWidgetEnv();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset, paddingTop: SPACE.gap, borderTopWidth: 1, borderColor: inks.text.hairline }}>
      <View style={{ flex: 1, flexDirection: "column" }}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: inks.text.ink }}>May go on air</Text>
        <Text style={{ fontSize: TYPE.secondary.size, color: inks.text.secondary }}>
          When rain starts within 15 minutes, Weather may take the tally for up to 2 minutes. Off unless you turn it on.
        </Text>
      </View>
      <Switch testID="may-go-on-air" look="inks" on={on} label="May go on air" onChange={set} />
    </View>
  );
}
