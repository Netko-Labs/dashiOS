/**
 * The page strip in the sidebar: a thumbnail per page of a PDF, or per
 * picture in the open picture's folder, the open one chosen in the one
 * selection look (CO-9: its tile washed whole, its label in onSelection, as
 * Files' icon view draws a chosen icon); a click goes
 * there. Only the rows near the strip's window are drawn (a PDF may have
 * thousands of pages), each at its own page's shape, and the strip scrolls
 * itself to keep the open one in view as you move. Metal has no scroll offset
 * to set, so the scroll is ours, as on the document surface.
 */

import { CLEAR, Picture, RADIUS, SPACE, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState } from "react";
import { LINE_PX } from "../document.ts";
import { clampScroll, type PageBox, visiblePages } from "../layout.ts";

/** A thumbnail's width in the widest strip; its height follows its page's shape, held between these (a 4:1 panorama is drawn whole). */
export const THUMB_WIDTH = 150;
export const SHAPE = { least: 0.25, most: 2.5 } as const;
/** A folder picture's shape before its thumbnail says (4:3). */
export const UNKNOWN_SHAPE = 0.75;
/**
 * How wide the strip is: a share of the window, between `least` and `most`;
 * a window narrower than `hideBelow` gives the picture all of it (the View
 * menu's Sidebar still shows it). The thumbnails keep the strip's margins.
 */
export const STRIP = { share: 0.2, least: 132, most: 200, hideBelow: 480, margins: 50 } as const;
/** How far the rows fade under the window controls once the strip is scrolled: 16, in 1-pt bands (thinner than a pixel step shows). */
const FADE = { bands: 16, band: 1 } as const;
/** The label under a thumbnail, the gap between rows, and the room above the first and below the last. */
const LABEL = 18;
const GAP = SPACE.gap;
const PAD = SPACE.s;
/** The tile's room around a thumbnail, where the chosen one's wash shows. */
const FRAME = SPACE.xs;
/** A page not drawn yet: its hairline. */
const HAIRLINE = 1;

export interface StripItem {
  key: string;
  label: string;
  /** The thumbnail, once made. */
  source: string | null;
  /** Height over width. */
  shape: number;
}

/** The strip's width in a window `window` wide (null: not measured yet, the widest); 0 when it gives way. */
export function stripWidth(window: number | null): number {
  if (window === null) return STRIP.most;
  if (window < STRIP.hideBelow) return 0;
  return Math.min(STRIP.most, Math.max(STRIP.least, Math.round(window * STRIP.share)));
}

/** A thumbnail's width in a strip `width` wide. */
export const thumbWidth = (width: number): number => Math.max(40, Math.min(THUMB_WIDTH, width - STRIP.margins));

/** Where each row sits in the strip, top to bottom, its thumbnails `thumbWide` wide. */
export function stripRows(items: readonly StripItem[], thumbWide: number = THUMB_WIDTH): { rows: PageBox[]; height: number } {
  const rows: PageBox[] = [];
  let top = PAD;
  items.forEach((item, index) => {
    const thumb = Math.round(thumbWide * Math.min(Math.max(item.shape, SHAPE.least), SHAPE.most));
    const height = thumb + FRAME * 2 + LABEL;
    rows.push({ page: index + 1, left: 0, top, width: thumbWide + FRAME * 2, height });
    top += height + GAP;
  });
  return { rows, height: items.length === 0 ? 0 : top - GAP + PAD };
}

/** `color` (#rrggbb or #rrggbbaa) at `opacity` of its own alpha; any other form is kept as it is. */
export function faded(color: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  const alpha = Math.round((match[2] ? Number.parseInt(match[2], 16) : 255) * Math.min(1, Math.max(0, opacity)));
  return `#${match[1]}${alpha.toString(16).padStart(2, "0")}`;
}

/** The scroll that brings row `index` whole into a view of `height` at `scroll`, moving as little as it can. */
export function scrollIntoView(row: PageBox | undefined, scroll: number, height: number): number {
  if (!row || height <= 0) return scroll;
  if (row.top - PAD < scroll) return row.top - PAD;
  if (row.top + row.height + PAD > scroll + height) return row.top + row.height + PAD - height;
  return scroll;
}

interface StripRowProps {
  testID: string;
  item: StripItem;
  row: PageBox;
  /** Where it sits in the strip as scrolled. */
  top: number;
  thumbWide: number;
  /** The open one. */
  marked: boolean;
  onPress: () => void;
}

/** One page or picture: its thumbnail and its label under it, on a tile the selection washes whole when it is the open one. */
function StripRow({ testID, item, row, top, thumbWide, marked, onPress }: StripRowProps) {
  const colors = useColors();
  const surface = useSurface();
  const thumb = row.height - FRAME * 2 - LABEL;
  // A page not drawn yet, or a file the host cannot draw: the card ground, quiet in both modes.
  const empty = (
    <View
      style={{
        width: thumbWide,
        height: thumb,
        backgroundColor: surface.card,
        borderRadius: RADIUS.thumb,
        borderWidth: HAIRLINE,
        borderColor: colors.separator,
      }}
    />
  );
  return (
    <View
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      {...(marked ? { accessibilityState: { selected: true } } : {})}
      onPress={onPress}
      style={{ position: "absolute", left: 0, right: 0, top, height: row.height, alignItems: "center" }}
    >
      <View
        testID={`${testID}:tile`}
        style={{
          width: thumbWide + FRAME * 2,
          height: row.height,
          alignItems: "center",
          borderRadius: RADIUS.control,
          backgroundColor: marked ? colors.selectionWash : CLEAR,
          hoverBackgroundColor: marked ? colors.selectionWash : colors.button,
        }}
      >
        <View style={{ height: thumb + FRAME * 2, alignItems: "center", justifyContent: "center" }}>
          {item.source !== null ? (
            <Picture source={item.source} resizeMode="contain" style={{ width: thumbWide, height: thumb, borderRadius: RADIUS.thumb }} fallback={empty} />
          ) : (
            empty
          )}
        </View>
        {/* One line, centred, with an ellipsis when it is longer than the thumbnail is wide. */}
        <View style={{ height: LABEL, justifyContent: "center", paddingHorizontal: SPACE.xs, width: thumbWide + FRAME * 2 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: TYPE.caption.size,
              fontWeight: marked ? WEIGHT.semibold : WEIGHT.regular,
              color: marked ? colors.onSelection : colors.textMuted,
              textAlign: "center",
            }}
          >
            {item.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function Strip({
  items,
  current,
  onPick,
  onVisible,
  width = STRIP.most,
  testID = "strip",
}: {
  items: readonly StripItem[];
  /** The open one's index, or -1. */
  current: number;
  onPick: (index: number) => void;
  /** The indexes on screen (and a little past), for their thumbnails. */
  onVisible: (indexes: number[]) => void;
  /** The strip's width (stripWidth). */
  width?: number;
  testID?: string;
}) {
  const surface = useSurface();
  const [height, setHeight] = useState(0);
  const [scroll, setScroll] = useState(0);
  const thumbWide = thumbWidth(width);
  const { rows, height: content } = useMemo(() => stripRows(items, thumbWide), [items, thumbWide]);
  const held = clampScroll(scroll, content, height);
  const live = useRef(held);
  live.current = held;

  // The open row comes into view when it changes (a key, a click on the page, a new file).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new current row, or a first measure, moves the strip
  useEffect(() => {
    const next = scrollIntoView(rows[current], live.current, height);
    if (next !== live.current) setScroll(next);
  }, [current, height, items.length]);

  const shown = visiblePages(rows, held, height, 0.5).map((page) => page - 1);
  const shownKey = shown.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the list
  useEffect(() => {
    if (height > 0) onVisible(shown);
  }, [shownKey, height]);

  return (
    <View
      testID={testID}
      onLayout={(bounds) => setHeight(bounds.height)}
      onWheel={(wheel) => setScroll((now) => clampScroll(clampScroll(now, content, height) - wheel.dy * LINE_PX, content, height))}
      style={{ flex: 1, position: "relative", overflow: "hidden", marginLeft: -SPACE.gap, marginRight: -SPACE.gap }}
    >
      {shown.map((index) => {
        const item = items[index];
        const row = rows[index];
        if (!item || !row) return null;
        return (
          <StripRow
            key={item.key}
            testID={`${testID}:${index + 1}`}
            item={item}
            row={row}
            top={row.top - held}
            thumbWide={thumbWide}
            marked={index === current}
            onPress={() => onPick(index)}
          />
        );
      })}
      {held > 0 && (
        // Scrolled: the rows fade out under the window controls instead of being sliced there.
        <View testID={`${testID}:fade`} style={{ position: "absolute", left: 0, right: 0, top: 0, flexDirection: "column" }}>
          {Array.from({ length: FADE.bands }, (_, band) => (
            <View key={band} style={{ height: FADE.band, backgroundColor: faded(surface.sidebar, 1 - band / FADE.bands) }} />
          ))}
        </View>
      )}
    </View>
  );
}
