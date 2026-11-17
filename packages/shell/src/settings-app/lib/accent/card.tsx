/**
 * Settings › Appearance › Accent colour (the accent's design, frames 1 to 3):
 * one card under the themes. Its row says the pick ("Accent colour · Momo")
 * beside the swatches; when the guard moved the pick, one line under the row
 * says so with picked → drawn chips; then the live preview of real controls.
 * A pick is written to settings.json (`appearance.accent`) at once, the shell
 * resolves it into the seed every process paints from, and the whole window
 * repaints with it, this card included.
 */

import { type AccentChoice, accentSentence, choiceName, isAccentHex, KOMBU_SEED } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type FlagsStore, useFlags } from "../../../shared/control-center/index.ts";
import { controlPalette, useControlColors } from "../../../shared/controls/palette.ts";
import { wallpaperStill } from "../../../wallpaper/index.ts";
import { useSettings } from "../../hooks.ts";
import { Spot } from "../../spot.tsx";
import type { SettingsStore } from "../../store.ts";
import { PAGE } from "../row.tsx";
import { AccentPicker } from "./picker.tsx";
import { AccentPreview } from "./preview.tsx";
import { Swatches } from "./swatches.tsx";

function Chip({ color, label }: { color: string; label: string }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 24,
        paddingLeft: 4,
        paddingRight: 10,
        borderRadius: 12,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color }} />
      <Text style={{ fontSize: 11.5, fontWeight: "semibold", color: colors.text }}>{label}</Text>
    </View>
  );
}

/** The guard's one line: what was picked, what is drawn, and why. Nothing when the pick is drawn as picked. */
function GuardLine({ seed, dark }: { seed: string; dark: boolean }) {
  const colors = useControlColors();
  const sentence = accentSentence(seed, dark);
  if (sentence === "") return null;
  const drawn = controlPalette(dark, seed).on;
  return (
    <View testID="accent-guard" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Chip color={seed} label={seed.toUpperCase()} />
      <Text style={{ fontSize: 15, color: colors.muted }}>→</Text>
      <Chip color={drawn} label={drawn.toUpperCase()} />
      <View style={{ flexShrink: 1, minWidth: 160 }}>
        <Text style={{ fontSize: 12, color: colors.text }}>{sentence}</Text>
      </View>
    </View>
  );
}

export interface AccentCardProps {
  flags: FlagsStore;
  settings: SettingsStore;
  /** The eyedropper (one pixel from the screen); absent, Custom… has only its field and hex. */
  pick?: () => Promise<string | null>;
}

export function AccentCard({ flags, settings, pick }: AccentCardProps) {
  const colors = useControlColors();
  const { dark, accent } = useFlags(flags);
  const data = useSettings(settings).data;
  const choice = data.appearance.accent;
  const seed = accent ?? KOMBU_SEED;
  const [picking, setPicking] = useState<{ anchor: Bounds | null } | null>(null);
  const still = wallpaperStill({ ...data.wallpaper, mode: data.wallpaper.mode ?? "fill" });
  const choose = (next: AccentChoice | undefined) => settings.patch("appearance", { accent: next });
  const start = choice && "custom" in choice && isAccentHex(choice.custom) ? choice.custom : seed;
  return (
    <Spot id="appearance/accent">
      <View
        testID="appearance-accent"
        style={{ flexShrink: 0, flexDirection: "column", gap: 12, padding: 16, borderRadius: PAGE.cardRadius, backgroundColor: colors.off }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 170, flexDirection: "column", gap: 2, paddingTop: 4 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: "semibold", color: colors.text }}>Accent colour</Text>
              <Text style={{ fontSize: 14, color: colors.muted }}>{`· ${choiceName(choice)}`}</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>Selection, switches, links and the active window's ring.</Text>
          </View>
          <Swatches
            dark={dark}
            choice={choice}
            seed={accent ?? null}
            wallpaper={"image" in still ? still.image : null}
            onChoose={choose}
            onCustom={(anchor) => setPicking({ anchor })}
          />
        </View>
        <GuardLine seed={seed} dark={dark} />
        <AccentPreview />
      </View>
      {picking && (
        <AccentPicker
          start={start}
          dark={dark}
          anchor={picking.anchor}
          pick={pick}
          onCancel={() => setPicking(null)}
          onUse={(hex) => {
            setPicking(null);
            choose(hex.toUpperCase() === KOMBU_SEED ? undefined : { custom: hex.toUpperCase() });
          }}
        />
      )}
    </Spot>
  );
}
