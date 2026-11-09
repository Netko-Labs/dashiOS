/**
 * The page strip in the sidebar: a thumbnail per page of a PDF, or per
 * picture in the open picture's folder, the open one marked; a click goes
 * there. Only the rows near the strip's window are drawn (a PDF may have
 * thousands of pages), each at its own page's shape, and the strip scrolls
 * itself to keep the open one in view as you move. Metal has no scroll offset
 * to set, so the scroll is ours, as on the document surface.
 */

import { useColors, useSurface } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState } from "react";
import { LINE_PX } from "./document.ts";
import { clampScroll, type PageBox, visiblePages } from "./layout.ts";

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
/** How far the rows fade under the window controls once the strip is scrolled, in bands. */
const FADE = { bands: 5, band: 3 } as const;
/** The label under a thumbnail, the gap between rows, and the room above the first and below the last. */
const LABEL = 18;
const GAP = 10;
const PAD = 6;
/** The marked frame around a thumbnail. */
const FRAME = 4;

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
  const colors = useColors();
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
      style={{ flex: 1, position: "relative", overflow: "hidden", marginLeft: -10, marginRight: -10 }}
    >
      {shown.map((index) => {
        const item = items[index];
        const row = rows[index];
        if (!item || !row) return null;
        const marked = index === current;
        const thumb = row.height - FRAME * 2 - LABEL;
        return (
          <View
            key={item.key}
            testID={`${testID}:${index + 1}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            {...(marked ? { accessibilityState: { selected: true } } : {})}
            onPress={() => onPick(index)}
            style={{ position: "absolute", left: 0, right: 0, top: row.top - held, height: row.height, alignItems: "center" }}
          >
            <View
              style={{
                width: thumbWide + FRAME * 2,
                height: thumb + FRAME * 2,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                borderWidth: 2,
                borderColor: marked ? colors.selection : "#00000000",
                hoverBackgroundColor: marked ? "#00000000" : colors.button,
              }}
            >
              {item.source !== null ? (
                <Image source={item.source} resizeMode="contain" style={{ width: thumbWide, height: thumb, borderRadius: 2 }} />
              ) : (
                // A page not drawn yet: the card ground, quiet in both modes.
                <View
                  style={{ width: thumbWide, height: thumb, backgroundColor: surface.card, borderRadius: 2, borderWidth: 1, borderColor: colors.separator }}
                />
              )}
            </View>
            {/* One line, centred, with an ellipsis when it is longer than the thumbnail is wide. */}
            <View style={{ height: LABEL, justifyContent: "center", paddingHorizontal: 4, width: thumbWide + FRAME * 2 }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: 11, fontWeight: marked ? "semibold" : "normal", color: marked ? colors.accentInk : colors.textMuted, textAlign: "center" }}
              >
                {item.label}
              </Text>
            </View>
          </View>
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
