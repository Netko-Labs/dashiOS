/**
 * The segmented control (UI-2): one of a few, side by side, in one Tab stop
 * where the arrows move and Space or Return picks. Two looks (TK-2). The
 * window look is a sunk track 26 at radius 8, the chosen segment raised one
 * step in at radius 6 with shadow sm; a segment may be a glyph, named for
 * screen readers by its label. The panel look is Settings' pills: a hairline
 * track, pills 32 tall whose chosen one wears the "on" with the tighter
 * corner (on the spring), and, folded past five (folded.tsx), a "More" pill
 * in the same track.
 */

import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { createContext, useContext } from "react";
import type { Look } from "./button.tsx";
import type { Choice } from "./choices.tsx";
import { useControlState } from "./control-state.tsx";
import { CHEVRON_DOWN } from "./glyphs.ts";
import { useControlColors, useSpring } from "./panel/index.ts";
import { CLEAR, SHADOW, SPACE, TYPE, useColors, useSurface, WEIGHT } from "./theme/index.ts";

/** The window look's measures: a track 26 tall at radius 8, 2 in; a segment one step in at 6; a glyph 16. */
export const SEGMENTED_WINDOW = { height: 26, inset: 2, trackRadius: 8, segmentRadius: 6, padding: SPACE.inset, glyph: 16 } as const;
/** The panel look's: 4 in, 4 apart; a pill 32 tall, 12 in (9 with six or more), radius 16, 11 when chosen. */
export const SEGMENTED = { padding: 4, gap: 4, height: 32, radius: 16, chosenRadius: 11, inset: 12, tightInset: 9, tightFrom: 6 } as const;

/** A folded row's last pill (folded.tsx): "More" and a chevron; never chosen, washed while its menu is open. */
export interface MorePill {
  open: boolean;
  onPress: (bounds: Bounds | undefined) => void;
  onLayout: (bounds: Bounds) => void;
}

export interface SegmentedProps<T extends string | number> {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
  /** Keyboard focus is in it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  /** The window look: every segment this wide; by default each fits its label. */
  segmentWidth?: number;
  look?: Look;
  /** The panel look, folded: a "More" pill at the end of the track. */
  more?: MorePill;
}

/** How a row of pills was laid out: whether it took more than one line, and how wide it was. */
export interface PillsLaid {
  wrapped: boolean;
  width: number;
}

/** Told, as the panel's pills are laid out, whether they wrapped and how wide they were (a Settings row then puts them under its words). */
export const PillsWrapped = createContext<((laid: PillsLaid) => void) | null>(null);

/** Whether a row of pills `height` tall took more than one line. */
export const pillsWrapped = (height: number): boolean => height > SEGMENTED.height + 2 * SEGMENTED.padding + 1;

export function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  return props.look === "panel" ? <PanelTrack {...props} /> : <WindowTrack {...props} />;
}

function WindowTrack<T extends string | number>({ options, value, onChange, testID, segmentWidth, disabled, focused }: SegmentedProps<T>) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const m = SEGMENTED_WINDOW;
  return (
    <View
      testID={testID}
      focusGroup
      accessibilityRole="tablist"
      data-focused={state.focused}
      style={{
        flexDirection: "row",
        flexShrink: 0,
        height: m.height,
        padding: m.inset,
        gap: m.inset,
        borderRadius: m.trackRadius,
        backgroundColor: colors.button,
        opacity: state.opacity,
      }}
    >
      {options.map((option) => (
        <WindowSegment
          key={String(option.value)}
          option={option}
          chosen={option.value === value}
          width={segmentWidth}
          testID={`${testID}:${option.value}`}
          onPress={disabled ? undefined : () => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** One segment: raised when chosen, a wash under the pointer, deeper while held. */
function WindowSegment<T>({
  option,
  chosen,
  width,
  testID,
  onPress,
}: {
  option: Choice<T>;
  chosen: boolean;
  width?: number;
  testID: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const state = useControlState({ disabled: onPress === undefined });
  const rest = chosen ? surface.card : CLEAR;
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="tab"
      accessibilityLabel={option.label}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      onPointer={state.onPointer}
      style={{
        ...(width !== undefined ? { width } : { paddingHorizontal: SEGMENTED_WINDOW.padding }),
        borderRadius: SEGMENTED_WINDOW.segmentRadius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed && !chosen ? colors.pressed : rest,
        hoverBackgroundColor: onPress === undefined || chosen ? rest : state.pressed ? colors.pressed : colors.button,
        ...(chosen ? { shadow: SHADOW.sm } : {}),
        focusRingColor: colors.focusRing,
      }}
    >
      {option.glyph !== undefined ? (
        <Svg markup={option.glyph} size={SEGMENTED_WINDOW.glyph} color={chosen ? colors.text : colors.textMuted} />
      ) : (
        <Text
          numberOfLines={1}
          style={{ fontSize: TYPE.secondary.size, fontWeight: chosen ? WEIGHT.semibold : WEIGHT.regular, color: colors.text, textAlign: "center" }}
        >
          {option.label}
        </Text>
      )}
    </View>
  );
}

function PanelTrack<T extends string | number>({ options, value, onChange, testID, disabled, focused, more }: SegmentedProps<T>) {
  const colors = useControlColors();
  const report = useContext(PillsWrapped);
  const state = useControlState({ disabled, focused });
  return (
    <View
      testID={testID}
      focusGroup
      accessibilityRole="group"
      data-focused={state.focused}
      {...(report ? { onLayout: (laid: { width: number; height: number }) => report({ wrapped: pillsWrapped(laid.height), width: laid.width }) } : {})}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        flexShrink: 1,
        gap: SEGMENTED.gap,
        padding: SEGMENTED.padding,
        borderRadius: SEGMENTED.radius + SEGMENTED.padding,
        backgroundColor: colors.line,
        opacity: state.opacity,
        focusRingColor: colors.focus,
      }}
    >
      {options.map((option) => (
        <PanelPill
          key={String(option.value)}
          option={option}
          chosen={option.value === value}
          tight={options.length >= SEGMENTED.tightFrom}
          testID={`${testID}:${option.value}`}
          {...(disabled ? {} : { onPress: () => onChange(option.value) })}
        />
      ))}
      {more && <MoreSegment testID={`${testID}:more`} more={more} disabled={disabled === true} />}
    </View>
  );
}

function PanelPill<T>({
  option,
  chosen,
  testID,
  onPress,
  tight,
}: {
  option: Choice<T>;
  chosen: boolean;
  testID: string;
  onPress?: () => void;
  tight: boolean;
}) {
  const colors = useControlColors();
  const { selectionPressed } = useColors();
  const state = useControlState({ disabled: onPress === undefined });
  const radius = useSpring(chosen ? SEGMENTED.chosenRadius : SEGMENTED.radius);
  const fill = chosen ? (state.pressed ? selectionPressed : colors.on) : state.pressed ? colors.lit : CLEAR;
  const ink = chosen ? colors.onInk : colors.offInk;
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={{ selected: chosen }}
      onPointer={state.onPointer}
      {...(onPress ? { onPress } : {})}
      style={{
        height: SEGMENTED.height,
        paddingHorizontal: tight ? SEGMENTED.tightInset : SEGMENTED.inset,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
        hoverBackgroundColor: chosen ? fill : colors.knobOff,
      }}
    >
      {option.glyph !== undefined ? (
        <Svg markup={option.glyph} size={SEGMENTED_WINDOW.glyph} color={ink} />
      ) : (
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: ink }}>
          {option.label}
        </Text>
      )}
    </View>
  );
}

function MoreSegment({ testID, more, disabled }: { testID: string; more: MorePill; disabled: boolean }) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="button"
      accessibilityLabel="More choices"
      accessibilityState={{ expanded: more.open, disabled }}
      {...(disabled ? {} : { onPress: (event: { bounds?: Bounds }) => more.onPress(event.bounds) })}
      onLayout={more.onLayout}
      style={{
        height: SEGMENTED.height,
        paddingLeft: SEGMENTED.inset,
        // The chevron's own drawing keeps room at its side: one step less, so the pill looks even.
        paddingRight: SEGMENTED.inset - SPACE.xxs,
        borderRadius: SEGMENTED.radius,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACE.xxs,
        backgroundColor: more.open ? colors.knobOff : CLEAR,
        hoverBackgroundColor: disabled ? CLEAR : colors.knobOff,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>
        More
      </Text>
      <Svg markup={CHEVRON_DOWN} size={SPACE.inset} color={colors.muted} />
    </View>
  );
}
