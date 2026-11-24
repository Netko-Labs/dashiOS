/**
 * The accent's swatches (Settings › Appearance, the accent's design frame 1):
 * Kombu and the five presets, a gap, then Custom… and Wallpaper. Each preset
 * is drawn with the fill it will really have in this mode, so a swatch
 * cannot promise a colour it will not show; the chosen one is ringed in ink
 * and its name is bold. One Tab stop: the arrows move along it (KB-1).
 */

import { ACCENT_PRESETS, type AccentChoice, controlPalette, KOMBU_SEED } from "@dashi/ui";
import { type Bounds, Image, Text, View } from "@mirinjs/metal";
import { type ReactNode, useRef } from "react";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { rainbowRing } from "./images.ts";

export const SWATCH = { size: 34, cell: 54, ring: 2.5 } as const;

/** Which swatch a choice lights: a preset's id, "custom" or "wallpaper"; no choice is Kombu. */
export const chosenSwatch = (choice: AccentChoice | undefined): string =>
  !choice ? "kombu" : "preset" in choice ? choice.preset : "custom" in choice ? "custom" : "wallpaper";

function Swatch({
  id,
  label,
  chosen,
  onPress,
  onLayout,
  children,
}: {
  id: string;
  label: string;
  chosen: boolean;
  onPress: () => void;
  onLayout?: (bounds: Bounds) => void;
  children: ReactNode;
}) {
  const colors = useControlColors();
  const outer = SWATCH.size + 2 * (SWATCH.ring + 2);
  return (
    <View
      testID={`accent-${id}`}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      {...(onLayout ? { onLayout } : {})}
      style={{ width: SWATCH.cell, flexDirection: "column", alignItems: "center", gap: 4, borderRadius: 10, focusRingColor: colors.focus }}
    >
      <View
        style={{
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: SWATCH.ring,
          borderColor: chosen ? colors.text : "#00000000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
      <View style={{ width: SWATCH.cell, alignItems: "center" }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 11, textAlign: "center", fontWeight: chosen ? "semibold" : "normal", color: chosen ? colors.text : colors.muted }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

const Dot = ({ color, size = SWATCH.size }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
);

export interface SwatchesProps {
  dark: boolean;
  choice: AccentChoice | undefined;
  /** The seed in use now (what Custom… shows inside its ring while a colour is chosen). */
  seed: string | null;
  /** A still of the wallpaper, for its swatch; null draws a neutral dot. */
  wallpaper: string | null;
  onChoose: (choice: AccentChoice | undefined) => void;
  /** Custom… pressed: open the picker under it. */
  onCustom: (bounds: Bounds | null) => void;
}

export function Swatches({ dark, choice, seed, wallpaper, onChoose, onCustom }: SwatchesProps) {
  const colors = useControlColors();
  const chosen = chosenSwatch(choice);
  const ring = rainbowRing();
  const customAt = useRef<Bounds | null>(null);
  return (
    <View testID="accent-swatches" focusGroup accessibilityRole="group" style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap" }}>
      {ACCENT_PRESETS.map((preset) => (
        <Swatch
          key={preset.id}
          id={preset.id}
          label={preset.name}
          chosen={chosen === preset.id}
          onPress={() => onChoose(preset.seed === KOMBU_SEED ? undefined : { preset: preset.id })}
        >
          <Dot color={controlPalette(dark, preset.seed).on} />
        </Swatch>
      ))}
      <View style={{ width: 1, height: SWATCH.size, marginTop: 6, marginLeft: 6, marginRight: 6, backgroundColor: colors.line }} />
      <Swatch
        id="custom"
        label="Custom…"
        chosen={chosen === "custom"}
        onLayout={(bounds) => {
          customAt.current = bounds;
        }}
        onPress={() => onCustom(customAt.current)}
      >
        <View style={{ width: SWATCH.size, height: SWATCH.size, alignItems: "center", justifyContent: "center" }}>
          {ring && <Image source={ring} resizeMode="contain" style={{ width: SWATCH.size, height: SWATCH.size }} />}
          {chosen === "custom" && seed && (
            <View style={{ position: "absolute", left: (SWATCH.size - 16) / 2, top: (SWATCH.size - 16) / 2 }}>
              <Dot color={controlPalette(dark, seed).on} size={16} />
            </View>
          )}
        </View>
      </Swatch>
      <Swatch id="wallpaper" label="Wallpaper" chosen={chosen === "wallpaper"} onPress={() => onChoose({ wallpaper: true })}>
        <View style={{ width: SWATCH.size, height: SWATCH.size, borderRadius: SWATCH.size / 2, overflow: "hidden", backgroundColor: colors.line }}>
          {wallpaper && <Image source={wallpaper} resizeMode="cover" style={{ width: SWATCH.size, height: SWATCH.size, borderRadius: SWATCH.size / 2 }} />}
        </View>
      </Swatch>
    </View>
  );
}
