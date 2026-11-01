/**
 * The on-screen display, macOS style: a rounded glass square with a big
 * glyph and, for volume and brightness, a bar of 16 segments. It is a Metal
 * overlay surface (no keyboard) a little above the bottom edge's center.
 */

import { render, spawnNativeHost, Svg, Text, View } from "@mirinjs/metal";
import { METAL_HOST } from "../apps.ts";
import { micGlyph, speakerGlyph, SUN } from "../glyphs.ts";
import { useColors } from "@dashi/ui";
import { litSegments, OSD, type OpenOsd, type OsdState, type OsdStore, useOsd } from "./osd-state.ts";

const SEGMENT = { width: 8, height: 6, gap: 2 } as const;

function glyphOf(state: OsdState): string {
  switch (state.kind) {
    case "volume":
      return speakerGlyph(state.level, state.muted);
    case "brightness":
      return SUN;
    case "mic":
      return micGlyph(state.muted);
  }
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
          <Svg markup={glyphOf(state)} size={96} color={colors.text} />
        </View>
        {state.kind === "mic" ? (
          <Text style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>{state.muted ? "Microphone off" : "Microphone on"}</Text>
        ) : (
          <LevelBar lit={lit} />
        )}
      </View>
    </View>
  );
}

/** Opens the HUD as a layer-shell overlay. */
export const openOsdSurface: OpenOsd = (store, onClosed) => {
  const full = OSD.size + OSD.margin * 2;
  const host = spawnNativeHost(METAL_HOST, {
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
