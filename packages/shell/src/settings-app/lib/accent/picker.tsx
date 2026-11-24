/**
 * Custom… (the accent's design frame 2): a popover under its swatch with a
 * saturation and brightness field, a hue strip with the guard's two bands
 * marked under it in grey (the tally's, the agents'), a hex field that has
 * the keyboard, the eyedropper where the shell can sample a pixel, and two
 * dots, Picked and Drawn on Light/Dark. A popover is the app look in
 * Settings too (SE-15): radius 12, shadow xl, the window's Buttons and field,
 * the eyedropper a toolbar button. Use (ink) keeps the colour, Cancel
 * or Esc or a click outside leaves the accent as it was. Drawn in the
 * window's top layer, over the cards, as a row's "More" menu is.
 */

import {
  Button,
  CLEAR,
  controlPalette,
  isAccentHex,
  KNOB,
  RADIUS,
  SHADOW,
  SPACE,
  TextField,
  ToolbarButton,
  TYPE,
  useColors,
  useSurface,
  useWindowLayer,
  WEIGHT,
} from "@dashi/ui";
import { type Bounds, createPortal, Image, type PointerInfo, Text, View } from "@mirinjs/metal";
import { type ReactNode, useMemo, useState } from "react";
import { bandsUnderStrip } from "./bands.ts";
import { FIELD, hexOf, hsvToRgb, hueField, hueStrip, rgbToHsv, STRIP } from "./images.ts";

/** The popover's measures: its padding and width, its handles (18, ringed 2.5), the dots under it, the marks' height. */
const POPOVER = { padding: SPACE.page, gap: SPACE.gap, handle: 18, handleRing: 2.5, dot: 18, marks: 4, dots: 18 } as const;
const WIDTH = FIELD.width + 2 * POPOVER.padding;
const EYEDROPPER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5-2 2-5-5z"/><path d="M14 7l-9 9v3h3l9-9"/></svg>`;

const fraction = (event: PointerInfo, along: "x" | "y"): number => {
  const bounds = event.bounds;
  if (!bounds) return 0;
  const at = along === "x" ? (event.x - bounds.x) / Math.max(1, bounds.width) : (event.y - bounds.y) / Math.max(1, bounds.height);
  return Math.min(1, Math.max(0, at));
};

/** Where the colour is on the field or the strip: a dot in that colour, ringed in the knob's white. */
function Handle({ left, top, color }: { left: number; top: number; color: string }) {
  return (
    <View
      style={{
        position: "absolute",
        left: left - POPOVER.handle / 2,
        top: top - POPOVER.handle / 2,
        width: POPOVER.handle,
        height: POPOVER.handle,
        borderRadius: POPOVER.handle / 2,
        borderWidth: POPOVER.handleRing,
        borderColor: KNOB,
        backgroundColor: color,
        shadow: SHADOW.sm,
      }}
    />
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <View style={{ width: POPOVER.dot, height: POPOVER.dot, borderRadius: POPOVER.dot / 2, backgroundColor: color }} />
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

export interface AccentPickerProps {
  /** The colour it opens on: the custom one in use, else the accent's seed. */
  start: string;
  dark: boolean;
  /** The Custom… swatch, in window pixels; the popover hangs under it. */
  anchor: Bounds | null;
  onUse: (hex: string) => void;
  onCancel: () => void;
  /** The eyedropper: one pixel from the screen, or null when cancelled. Absent, no eyedropper. */
  pick?: (() => Promise<string | null>) | undefined;
}

function Field({ hsv, onChange }: { hsv: { h: number; s: number; v: number }; onChange: (s: number, v: number) => void }) {
  const field = hueField(hsv.h);
  const at = (event: PointerInfo) => onChange(fraction(event, "x"), 1 - fraction(event, "y"));
  return (
    <View testID="accent-field" onPointer={at} style={{ width: FIELD.width, height: FIELD.height, borderRadius: RADIUS.card, overflow: "hidden" }}>
      {field && <Image source={field} resizeMode="cover" style={{ width: FIELD.width, height: FIELD.height }} />}
      <Handle left={hsv.s * FIELD.width} top={(1 - hsv.v) * FIELD.height} color={hexOf(hsvToRgb(hsv.h, hsv.s, hsv.v))} />
    </View>
  );
}

/** The whole strip as stretches, kept or clear, left to right. */
function stretches(bands: readonly { from: number; to: number }[]): { from: number; to: number; kept: boolean }[] {
  const out: { from: number; to: number; kept: boolean }[] = [];
  let at = 0;
  for (const band of bands) {
    if (band.from > at) out.push({ from: at, to: band.from, kept: false });
    out.push({ ...band, kept: true });
    at = band.to;
  }
  if (at < 1) out.push({ from: at, to: 1, kept: false });
  return out;
}

function Strip({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const colors = useColors();
  const strip = hueStrip();
  const bands = useMemo(() => bandsUnderStrip(), []);
  return (
    <View style={{ flexDirection: "column", gap: SPACE.xxs }}>
      <View
        testID="accent-hue"
        onPointer={(event) => onChange(fraction(event, "x") * 359.9)}
        style={{ width: STRIP.width, height: STRIP.height + 8, justifyContent: "center" }}
      >
        <View style={{ width: STRIP.width, height: STRIP.height, borderRadius: STRIP.height / 2, overflow: "hidden" }}>
          {strip && <Image source={strip} resizeMode="cover" style={{ width: STRIP.width, height: STRIP.height }} />}
        </View>
        <Handle left={(hue / 360) * STRIP.width} top={(STRIP.height + 8) / 2} color={hexOf(hsvToRgb(hue, 1, 1))} />
      </View>
      {/* The marks as a row of stretches: each kept band in grey, the gaps clear. */}
      <View style={{ width: STRIP.width, height: POPOVER.marks, flexDirection: "row" }}>
        {stretches(bands).map((part) => (
          <View
            key={part.from}
            style={{
              width: (part.to - part.from) * STRIP.width,
              height: POPOVER.marks,
              borderRadius: RADIUS.thumb,
              backgroundColor: part.kept ? colors.textMuted : CLEAR,
            }}
          />
        ))}
      </View>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
        Marked under the strip: kept for the tally and the agents, drawn quieter or moved.
      </Text>
    </View>
  );
}

/** The popover in the layer `room` (window pixels): under the anchor, right edges together, moved up when the window is too short. */
function Popover({ anchor, room, children }: { anchor: Bounds | null; room: Bounds | null; children: ReactNode }) {
  const [height, setHeight] = useState(0);
  const colors = useColors();
  const surface = useSurface();
  const right = anchor ? anchor.x + anchor.width : (room?.width ?? WIDTH);
  const left = Math.max(8, Math.min(right - WIDTH, (room?.width ?? WIDTH) - WIDTH - 8));
  const below = anchor ? anchor.y + anchor.height + SPACE.s : 60;
  const top = room && height > 0 ? Math.max(8, Math.min(below, room.height - height - 8)) : below;
  return (
    <View
      testID="accent-picker"
      focusTrap
      accessibilityRole="dialog"
      accessibilityLabel="Custom accent"
      onLayout={(bounds) => setHeight((now) => (now === Math.round(bounds.height) ? now : Math.round(bounds.height)))}
      onPress={() => {}}
      style={{
        position: "absolute",
        left: left - (room?.x ?? 0),
        top: top - (room?.y ?? 0),
        width: WIDTH,
        flexDirection: "column",
        gap: POPOVER.gap,
        padding: POPOVER.padding,
        borderRadius: RADIUS.sheet,
        backgroundColor: surface.window,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: SHADOW.xl,
        opacity: height > 0 ? 1 : 0,
      }}
    >
      {children}
    </View>
  );
}

export function AccentPicker({ start, dark, anchor, onUse, onCancel, pick }: AccentPickerProps) {
  const colors = useColors();
  const layer = useWindowLayer();
  const [room, setRoom] = useState<Bounds | null>(null);
  const [hsv, setHsv] = useState(() => rgbToHsv(start));
  const [text, setText] = useState(start.toUpperCase());
  const hex = isAccentHex(text) ? text.toUpperCase() : hexOf(hsvToRgb(hsv.h, hsv.s, hsv.v));
  const moveTo = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    setText(hexOf(hsvToRgb(next.h, next.s, next.v)));
  };
  const typed = (value: string) => {
    const tidy = value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
    setText(tidy.toUpperCase());
    if (isAccentHex(tidy)) setHsv(rgbToHsv(tidy));
  };
  const drawn = controlPalette(dark, hex).on;
  const node = (
    // The window's layer: a press outside the popover is a Cancel.
    <View
      testID="accent-picker-outside"
      onPress={onCancel}
      onLayout={(bounds) => setRoom((now) => (now && now.width === bounds.width && now.height === bounds.height ? now : bounds))}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
    >
      <Popover anchor={anchor} room={room}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>Custom accent</Text>
        <Field hsv={hsv} onChange={(s, v) => moveTo({ ...hsv, s, v })} />
        <Strip hue={hsv.h} onChange={(h) => moveTo({ ...hsv, h })} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <View style={{ flex: 1 }}>
            <TextField
              value={text}
              onChangeText={typed}
              testID="accent-hex"
              autoFocus
              onSubmit={() => onUse(hex)}
              onKeyPress={(key) => {
                if (key === "Escape") onCancel();
              }}
            />
          </View>
          {pick && (
            <ToolbarButton
              testID="accent-eyedropper"
              glyph={EYEDROPPER}
              tooltip="Pick a color from the screen"
              onPress={() => {
                void pick().then((picked) => picked && typed(picked));
              }}
            />
          )}
        </View>
        <View style={{ flexDirection: "row", gap: POPOVER.dots }}>
          <Dot color={hex} label="Picked" />
          <Dot color={drawn} label={dark ? "Drawn on Dark" : "Drawn on Light"} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: SPACE.m }}>
          <Button label="Cancel" onPress={onCancel} testID="accent-cancel" />
          <Button label="Use" primary onPress={() => onUse(hex)} testID="accent-use" />
        </View>
      </Popover>
    </View>
  );
  return layer === null ? node : createPortal(node, layer);
}
