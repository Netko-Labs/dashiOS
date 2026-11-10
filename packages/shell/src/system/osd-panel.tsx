/**
 * The on-screen display, macOS style: a rounded glass square with a big
 * glyph and, for volume and brightness, a bar of 16 segments. It is a Metal
 * overlay surface (no keyboard) a little above the bottom edge's center.
 */

import { useColors } from "@dashi/ui";
import { render, Svg, Text, View } from "@mirinjs/metal";
import { batteryGlyph, micGlyph, SUN, speakerGlyph } from "../glyphs.ts";
import { keyboardLightGlyph, modeGlyph } from "../laptop/glyphs.ts";
import { spawnShellHost } from "../shared/metal/host.ts";
import { litSegments, type OpenOsd, OSD, type OsdState, type OsdStore, useOsd } from "./osd-state.ts";

const SEGMENT = { width: 8, height: 6, gap: 2 } as const;

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
    case "keyboard-light":
      return keyboardLightGlyph(state.level > 0);
  }
}

/** The words under a HUD that shows no level. */
function caption(state: OsdState): string | null {
  if (state.kind === "mic") return state.muted ? "Microphone off" : "Microphone on";
  if (state.kind === "power") return `${state.charge === true ? "Charging" : "Plugged In"} · ${state.percent}%`;
  if (state.kind === "mode") return state.label;
  return null;
}

function LevelBar({ lit }: { lit: number }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: SEGMENT.gap }}>
      {Array.from({ length: OSD.segments }, (_, index) => (
        <View
          // The segments never reorder.
          key={index}
          style={{
            width: SEGMENT.width,
            height: SEGMENT.height,
            backgroundColor: index < lit ? colors.osdOn : colors.osdOff,
          }}
        />
      ))}
    </View>
  );
}

export function OsdPanel({ store }: { store: OsdStore }) {
  const colors = useColors();
  const state = useOsd(store);
  const lit = litSegments(state);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: OSD.size,
          height: OSD.size,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 26,
          borderRadius: 26,
          backgroundColor: colors.osd,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {/* The battery is twice as wide as it is tall; the other glyphs are square. */}
          {state.kind === "power" ? (
            <Svg markup={glyphOf(state)} width={112} height={56} color={colors.text} />
          ) : (
            <Svg markup={glyphOf(state)} size={96} color={colors.text} />
          )}
        </View>
        {caption(state) !== null ? <Text style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>{caption(state)}</Text> : <LevelBar lit={lit} />}
      </View>
    </View>
  );
}

/** Opens the HUD as a layer-shell overlay. */
export const openOsdSurface: OpenOsd = (store, onClosed) => {
  const full = OSD.size + OSD.margin * 2;
  const host = spawnShellHost({
    title: "On-screen display",
    appId: "dev.dashi.shell",
    width: full,
    height: full,
    // Above the Dock's strip; the shadow's margin is part of the surface.
    surface: { layer: "overlay", anchor: ["bottom"], margin: { bottom: 36 }, namespace: "dashi.osd" },
  });
  const root = render(<OsdPanel store={store} />, host);
  host.onClose(onClosed);
  return () => {
    root.unmount();
    host.close();
  };
};
