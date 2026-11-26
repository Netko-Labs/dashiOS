/**
 * The on-screen display, macOS style: a rounded glass square with a big
 * glyph and, for volume and brightness, a bar of 16 segments. It is a Metal
 * overlay surface (no keyboard) a little above the bottom edge's center.
 * Regular glass, square 28 or a pill, its segments ink, an off one the ink
 * at 20 % (frost-objects board 11, D781).
 */

import { Frosted, pill, RADIUS, SHADOW, SPACE, TYPE, useColors, WEIGHT, withAlpha } from "@dashi/ui";
import { type NativeHostOptions, render, Svg, Text, View } from "@mirinjs/metal";
import { type BottomStack, bottomStack } from "../../capsule/index.ts";
import { batteryGlyph, micGlyph, SUN, speakerGlyph, trackpadGlyph } from "../../glyphs.ts";
import { keyboardLightGlyph, modeGlyph } from "../../laptop/index.ts";
import { spawnShellHost } from "../../shared/metal/index.ts";
import { litSegments, type OpenOsd, OSD, type OsdState, type OsdStore, useOsd } from "../osd-state.ts";

const SEGMENT = { width: 8, height: 6, gap: SPACE.xxs } as const;
/** A segment is the glass's primary ink, lit; an off one takes this much of it. */
const SEGMENT_OFF = 0.2;

/** The segments' colours on the glass: lit, and off. */
function useSegmentInks(): { on: string; off: string } {
  const colors = useColors();
  return { on: colors.text, off: withAlpha(colors.text, SEGMENT_OFF) };
}

function glyphOf(state: OsdState): string {
  switch (state.kind) {
    case "volume":
      return speakerGlyph(state.level, state.muted);
    case "brightness":
      return SUN;
    case "mic":
      return micGlyph(state.muted);
    case "power":
      return batteryGlyph(state.percent, state.charge);
    case "mode":
      return modeGlyph(state.mode);
    case "trackpad":
      return trackpadGlyph(state.on);
    case "keyboard-light":
      return keyboardLightGlyph(state.level > 0);
  }
}

/** The words under a HUD that shows no level. */
function caption(state: OsdState): string | null {
  if (state.kind === "mic") return state.muted ? "Microphone off" : "Microphone on";
  if (state.kind === "power") return `${state.charge === true ? "Charging" : "Plugged In"} · ${state.percent}%`;
  if (state.kind === "mode") return state.label;
  if (state.kind === "trackpad") return state.on ? "Trackpad on" : "Trackpad off";
  return null;
}

function LevelBar({ lit }: { lit: number }) {
  const ink = useSegmentInks();
  return (
    <View style={{ flexDirection: "row", gap: SEGMENT.gap }}>
      {Array.from({ length: OSD.segments }, (_, index) => (
        <View
          // The segments never reorder.
          key={index}
          style={{
            width: SEGMENT.width,
            height: SEGMENT.height,
            backgroundColor: index < lit ? ink.on : ink.off,
          }}
        />
      ))}
    </View>
  );
}

export function OsdPanel({ store }: { store: OsdStore }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Frosted
        level="regular"
        testID="osd"
        style={{
          width: OSD.size,
          height: OSD.size,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: SPACE.xl,
          // The soft family (RA-2): 28; a HUD over the desktop floats on lg (DE-1).
          borderRadius: RADIUS.panel,
          shadow: SHADOW.lg,
        }}
      >
        <OsdBody store={store} />
      </Frosted>
    </View>
  );
}

/** What the square shows, on its glass: the glyph, and the words or the level. */
function OsdBody({ store }: { store: OsdStore }) {
  const colors = useColors();
  const state = useOsd(store);
  const lit = litSegments(state);
  return (
    <>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {/* The battery is twice as wide as it is tall; the other glyphs are square. */}
        {state.kind === "power" ? (
          <Svg markup={glyphOf(state)} width={112} height={56} color={colors.text} />
        ) : (
          <Svg markup={glyphOf(state)} size={96} color={colors.text} />
        )}
      </View>
      {caption(state) !== null ? (
        <Text style={{ fontSize: TYPE.panel.name.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{caption(state)}</Text>
      ) : (
        <LevelBar lit={lit} />
      )}
    </>
  );
}

/** The small indicator's measures: the capsule's height, a glyph, the level. */
export const SMALL_OSD = { height: 31, width: 196, glyph: 15, segment: 6, gap: SPACE.xxs, margin: SPACE.inset, above: 8 } as const;

/** The indicator drawn small, for while the capsule or the card has the bottom centre (pill-v2 README, "Where it sits"): one row, above it. */
export function SmallOsdPanel({ store }: { store: OsdStore }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Frosted
        level="regular"
        testID="osd-small"
        style={{
          height: SMALL_OSD.height,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.m,
          paddingLeft: SPACE.inset,
          paddingRight: SPACE.inset,
          borderRadius: pill(SMALL_OSD.height),
          shadow: SHADOW.lg,
        }}
      >
        <SmallOsdBody store={store} />
      </Frosted>
    </View>
  );
}

/** The small row's glyph, and its words or its level. */
function SmallOsdBody({ store }: { store: OsdStore }) {
  const colors = useColors();
  const ink = useSegmentInks();
  const state = useOsd(store);
  const lit = litSegments(state);
  const words = caption(state);
  return (
    <>
      <Svg markup={glyphOf(state)} size={SMALL_OSD.glyph} color={colors.text} />
      {words !== null ? (
        <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{words}</Text>
      ) : (
        <View style={{ flexDirection: "row", gap: SMALL_OSD.gap }}>
          {Array.from({ length: OSD.segments }, (_, index) => (
            // The segments never reorder.
            <View
              key={index}
              style={{
                width: SMALL_OSD.segment,
                height: SMALL_OSD.segment,
                borderRadius: RADIUS.thumb,
                backgroundColor: index < lit ? ink.on : ink.off,
              }}
            />
          ))}
        </View>
      )}
    </>
  );
}

/** The indicator's surface: the square above the Dock's strip, or the small row above whatever has the bottom centre (`stack`). */
export function osdSurface(stack: BottomStack | null): { width: number; height: number; small: boolean; surface: NonNullable<NativeHostOptions["surface"]> } {
  if (!stack) {
    const full = OSD.size + OSD.margin * 2;
    // Above the Dock's strip; the shadow's margin is part of the surface.
    return { width: full, height: full, small: false, surface: { layer: "overlay", anchor: ["bottom"], margin: { bottom: 36 }, namespace: "dashi.osd" } };
  }
  return {
    width: SMALL_OSD.width + SMALL_OSD.margin * 2,
    height: SMALL_OSD.height + SMALL_OSD.margin * 2,
    small: true,
    surface: {
      layer: "overlay",
      anchor: ["bottom"],
      // From the screen's own edge, as the capsule is measured.
      exclusiveZone: -1,
      margin: { bottom: Math.round(stack.top + SMALL_OSD.above - SMALL_OSD.margin) },
      namespace: "dashi.osd",
      ...(stack.output === undefined ? {} : { output: stack.output }),
    },
  };
}

/** Opens the HUD as a layer-shell overlay. */
export const openOsdSurface: OpenOsd = (store, onClosed) => {
  // The capsule and the indicator never sit on each other: while one is up, the indicator is small and above it.
  const { width, height, small, surface } = osdSurface(bottomStack.getSnapshot());
  const host = spawnShellHost({ title: "On-screen display", appId: "dev.dashi.shell", width, height, surface });
  const root = render(small ? <SmallOsdPanel store={store} /> : <OsdPanel store={store} />, host);
  host.onClose(onClosed);
  return () => {
    root.unmount();
    host.close();
  };
};
