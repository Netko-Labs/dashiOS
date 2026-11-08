/**
 * Appearance (docs/design.html, "Settings"): its hero is the themes, Light,
 * Dark and Automatic (dark in the evening), as pictures to pick from (the
 * one Dark Mode control here; Control Center's tile is the same switch).
 * Then how it looks: Automatic's hours, the text size of the shell's
 * surfaces and GTK apps (`appearance.textSize`, text-size.ts), how round
 * windows are (`appearance.cornerRadius`; the shell follows the file, so a
 * pick shows on the open windows at once), the pointer's size
 * (`appearance.pointerSize`, pointer.ts); and on a card of their own,
 * reducing motion and the accent ring round the focused window
 * (`appearance.highlightActiveWindow`, appearance/window-style.ts).
 */

import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type FlagsStore, useFlags } from "../../control-center/flags.ts";
import { DEFAULT_CORNERS, isCornerName } from "../../corners.ts";
import { DARK_CONTROLS, LIGHT_CONTROLS, useControlColors } from "../../shared/controls/palette.ts";
import { useSettings } from "../hooks.ts";
import { CORNER, MOON, POINTER, TEXT } from "../knob-glyphs.ts";
import { CORNER_OPTIONS } from "../registry/look.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Hero, Page, Setting, Spot } from "../ui.tsx";

/** A theme's picture: its surface, a bar, and a card, in that theme's own tokens. */
const THEME = {
  light: { ground: LIGHT_CONTROLS.surface, bar: "#d9d1e6", card: LIGHT_CONTROLS.off },
  dark: { ground: DARK_CONTROLS.surface, bar: "#3a3644", card: DARK_CONTROLS.off },
} as const;

type Theme = (typeof THEME)[keyof typeof THEME];

/** The picture, 84 tall: a bar along the top, a card under it. */
function ThemePicture({ theme }: { theme: Theme }) {
  return (
    <View style={{ flex: 1, position: "relative", backgroundColor: theme.ground }}>
      <View style={{ position: "absolute", left: 10, top: 10, right: 36, height: 10, borderRadius: 5, backgroundColor: theme.bar }} />
      <View style={{ position: "absolute", left: 10, top: 28, width: "60%", height: 38, borderRadius: 10, backgroundColor: theme.card }} />
    </View>
  );
}

/** A theme to pick: its picture and its name, ringed in green when chosen. */
function ThemeChoice({
  label,
  selected,
  testID,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  testID: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const colors = useControlColors();
  return (
    // A Tab stop in the themes' group: the arrows move between them, Space or Return picks one (KB-1).
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: 8,
        borderRadius: 20,
        borderWidth: 2.5,
        borderColor: selected ? colors.on : "#00000000",
      }}
    >
      <View style={{ width: "100%", height: 84, flexDirection: "row", borderRadius: 14, overflow: "hidden" }}>{children}</View>
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.offInk }}>{label}</Text>
    </View>
  );
}

/** Which of Light, Dark, and Automatic is chosen, as Recently changed says it. */
const modeWord = (auto: boolean, dark: boolean): string => (auto ? "Automatic" : dark ? "Dark" : "Light");

/**
 * Light, Dark, and Automatic as pictures to pick from. Light and Dark are Control Center's Dark Mode
 * switch; Automatic (settings.json `appearance.auto`) lets the shell flip it by the time of day.
 */
export function AppearancePreviews({ flags, settings }: { flags: FlagsStore; settings: SettingsStore }) {
  const { dark } = useFlags(flags);
  const { appearance } = useSettings(settings).data;
  const auto = appearance.auto === true;
  const now = modeWord(auto, dark);
  // One choice, one entry in Recently changed: Automatic off and Dark Mode on are "Appearance: Dark".
  const choose = (to: string, change: () => void) =>
    settings.changes.group({ name: "Appearance", menu: "Appearance", from: now, to, row: "appearance/dark-mode" }, change);
  const pick = (next: boolean) =>
    choose(modeWord(false, next), () => {
      settings.patch("appearance", { auto: undefined });
      const from = flags.getSnapshot().dark;
      flags.set({ dark: next });
      settings.changes.record([{ key: "flags.dark", from, to: next }]);
    });
  return (
    // One Tab stop, entered at the chosen theme (KB-1).
    <View testID="appearance-mode" focusGroup accessibilityRole="group" style={{ flex: 1, flexDirection: "row", gap: 12 }}>
      <ThemeChoice testID="appearance-light" label="Light" selected={!auto && !dark} onPress={() => pick(false)}>
        <ThemePicture theme={THEME.light} />
      </ThemeChoice>
      <ThemeChoice testID="appearance-dark" label="Dark" selected={!auto && dark} onPress={() => pick(true)}>
        <ThemePicture theme={THEME.dark} />
      </ThemeChoice>
      <ThemeChoice
        testID="appearance-auto"
        label="Automatic"
        selected={auto}
        onPress={() => choose("Automatic", () => settings.patch("appearance", { auto: true }))}
      >
        <View style={{ flex: 1, flexDirection: "column", overflow: "hidden", alignItems: "flex-start" }}>
          <View style={{ width: "200%", height: 84, flexDirection: "row" }}>
            <ThemePicture theme={THEME.light} />
          </View>
        </View>
        <View style={{ flex: 1, flexDirection: "column", overflow: "hidden", alignItems: "flex-end" }}>
          <View style={{ width: "200%", height: 84, flexDirection: "row" }}>
            <ThemePicture theme={THEME.dark} />
          </View>
        </View>
      </ThemeChoice>
    </View>
  );
}

/** How round windows are, as pills. */
export function CornerChoices({ settings }: { settings: SettingsStore }) {
  const { appearance } = useSettings(settings).data;
  return (
    <Choices
      testID="appearance-corners"
      value={appearance.cornerRadius ?? DEFAULT_CORNERS}
      options={CORNER_OPTIONS}
      onChange={(cornerRadius) => isCornerName(cornerRadius) && settings.patch("appearance", { cornerRadius })}
    />
  );
}

export function AppearancePane({ flags, settings }: { flags: FlagsStore; settings: SettingsStore }) {
  return (
    <Page title="Appearance">
      {/* The themes are Dark Mode's only control: a link or the launcher's Dark Mode row lands here. */}
      <Spot id="appearance/dark-mode">
        <Hero testID="appearance-hero">
          <AppearancePreviews flags={flags} settings={settings} />
        </Hero>
      </Spot>
      <Group testID="appearance-look">
        <Setting id="appearance/automatic" glyph={MOON} control="appearance-automatic" />
        <Setting id="appearance/text-size" glyph={TEXT} detail={null} stack={false} control="appearance-text-size" />
        <Setting id="appearance/window-corners" glyph={CORNER} detail={null} stack={false}>
          <CornerChoices settings={settings} />
        </Setting>
        <Setting id="appearance/pointer-size" glyph={POINTER} detail={null} stack={false} control="appearance-pointer-size" />
      </Group>
      <Group testID="appearance-motion">
        <Setting id="appearance/reduce-motion" detail="Fades instead of springs." control="appearance-reduce-motion" />
        <Setting id="appearance/highlight-active-window" control="appearance-highlight-window" />
      </Group>
      <Caption>Light and Dark are the same choice as Control Center's Dark Mode.</Caption>
    </Page>
  );
}
