/**
 * Settings › Appearance › Accent color (the accent's design, frames 1 to 3):
 * one card under the themes. Its row (SE-8, a knob like Appearance's other
 * rows) says the pick ("Accent color · Momo") over the swatches; when the
 * guard moved the pick, one line under the row says so, picked → drawn;
 * then the live preview of real controls.
 * A pick is written to settings.json (`appearance.accent`) at once, the shell
 * resolves it into the seed every process paints from, and the whole window
 * repaints with it, this card included.
 */

import { type AccentChoice, accentSentence, choiceName, controlPalette, isAccentHex, KOMBU_SEED, SPACE, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { Group } from "../../../shared/cards/index.ts";
import { type FlagsStore, useFlags } from "../../../shared/control-center/index.ts";
import { wallpaperStill } from "../../../wallpaper/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { AccentPicker } from "./picker.tsx";
import { AccentPreview } from "./preview.tsx";
import { Swatches } from "./swatches.tsx";

/** A colour's sample in the guard's line: a 16 dot and its hex. */
const SAMPLE = { dot: 16 } as const;

function ColorSample({ color, label }: { color: string; label: string }) {
  const colors = useControlColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <View style={{ width: SAMPLE.dot, height: SAMPLE.dot, borderRadius: SAMPLE.dot / 2, backgroundColor: color }} />
      <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{label}</Text>
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
    <View
      testID="accent-guard"
      style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.m, paddingHorizontal: PAGE.inset, paddingVertical: SPACE.inset }}
    >
      <ColorSample color={seed} label={seed.toUpperCase()} />
      <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.muted }}>→</Text>
      <ColorSample color={drawn} label={drawn.toUpperCase()} />
      <View style={{ flexShrink: 1, minWidth: 160 }}>
        <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.muted }}>{sentence}</Text>
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
  const { dark, accent } = useFlags(flags);
  const data = useSettings(settings).data;
  const choice = data.appearance.accent;
  const seed = accent ?? KOMBU_SEED;
  const [picking, setPicking] = useState<{ anchor: Bounds | null } | null>(null);
  const still = wallpaperStill({ ...data.wallpaper, mode: data.wallpaper.mode ?? "fill" });
  const choose = (next: AccentChoice | undefined) => settings.patch("appearance", { accent: next });
  const start = choice && "custom" in choice && isAccentHex(choice.custom) ? choice.custom : seed;
  return (
    <>
      <Group testID="appearance-accent">
        <Setting id="appearance/accent" testID="accent-row" title={`Accent color · ${choiceName(choice)}`} stack>
          <Swatches
            dark={dark}
            choice={choice}
            seed={accent ?? null}
            wallpaper={"image" in still ? still.image : null}
            onChoose={choose}
            onCustom={(anchor) => setPicking({ anchor })}
          />
        </Setting>
        {accentSentence(seed, dark) !== "" && <GuardLine seed={seed} dark={dark} />}
        <View style={{ padding: PAGE.inset }}>
          <AccentPreview />
        </View>
      </Group>
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
    </>
  );
}
