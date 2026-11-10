/**
 * Appearance (docs/design.html, "Settings"): its hero is the themes, Light,
 * Dark and Automatic (dark in the evening), as pictures to pick from (the
 * one Dark Mode control here; Control Center's tile is the same switch).
 * Automatic is chosen there and only there; while it is, its hours show as
 * the card's first row ("Dark from 7 PM to 7 AM"). Then how it looks: the
 * text size of the shell's surfaces and GTK apps (`appearance.textSize`,
 * text-size.ts), how round windows are (`appearance.cornerRadius`; the
 * shell follows the file, so a pick shows on the open windows at once), the
 * pointer's size (`appearance.pointerSize`, pointer.ts); and on a card of
 * their own, reducing motion and the ring round the focused window
 * (`appearance.highlightActiveWindow`, appearance/window-style.ts).
 */

import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AUTO_DARK_FROM, AUTO_DARK_TO } from "../appearance/auto.ts";
import { DEFAULT_CORNERS, isCornerName } from "../shared/appearance/corners.ts";
import { type FlagsStore, useFlags } from "../shared/control-center/flags.ts";
import { DARK_CONTROLS, LIGHT_CONTROLS, useControlColors } from "../shared/controls/palette.ts";
import { useSettings } from "./hooks.ts";
import { clockLabel } from "./lib/night.ts";
import { Setting } from "./lib/setting.tsx";
import { CORNER_OPTIONS } from "./registry/appearance.ts";
import { Spot } from "./spot.tsx";
import type { SettingsStore } from "./store.ts";
import { Caption, Choices, Group, Hero, Page } from "./ui.tsx";

/** A theme's picture: its surface, a bar, and a card, in that theme's own tokens. Dark's bar is a hairline's white on the black, as the menu bar's edge reads there. */
const THEME = {
  light: { ground: LIGHT_CONTROLS.surface, bar: "#d9d1e6", card: LIGHT_CONTROLS.off },
  dark: { ground: DARK_CONTROLS.surface, bar: DARK_CONTROLS.line, card: DARK_CONTROLS.off },
} as const;

type Theme = (typeof THEME)[keyof typeof THEME];

/** The picture, 84 tall: a bar along the top, a card under it; `ground` false leaves the ground to its holder (Automatic's halves). */
function ThemePicture({ theme, ground = true }: { theme: Theme; ground?: boolean }) {
  return (
    <View style={{ flex: 1, position: "relative", borderRadius: 14, backgroundColor: ground ? theme.ground : "#00000000" }}>
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
      <View style={{ width: "100%", height: 84, flexDirection: "row" }}>{children}</View>
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
        {/* Metal clips to rectangles, so each half rounds its own outer corners and squares the inner ones with a patch. */}
        <View style={{ flex: 1, flexDirection: "column", overflow: "hidden", alignItems: "flex-start", borderRadius: 14, backgroundColor: THEME.light.ground }}>
          <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 14, backgroundColor: THEME.light.ground }} />
          <View style={{ width: "200%", height: 84, flexDirection: "row" }}>
            <ThemePicture theme={THEME.light} ground={false} />
          </View>
        </View>
        <View style={{ flex: 1, flexDirection: "column", overflow: "hidden", alignItems: "flex-end", borderRadius: 14, backgroundColor: THEME.dark.ground }}>
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, backgroundColor: THEME.dark.ground }} />
          <View style={{ width: "200%", height: 84, flexDirection: "row" }}>
            <ThemePicture theme={THEME.dark} ground={false} />
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

/** Automatic's hours, as its row says them: "Dark from 7 PM to 7 AM". */
export const automaticHours = (): string => `Dark from ${clockLabel(AUTO_DARK_FROM)} to ${clockLabel(AUTO_DARK_TO)}`;

export function AppearancePane({ flags, settings }: { flags: FlagsStore; settings: SettingsStore }) {
  const auto = useSettings(settings).data.appearance.auto === true;
  const hero = (
    <Hero testID="appearance-hero">
      <AppearancePreviews flags={flags} settings={settings} />
    </Hero>
  );
  return (
    <Page title="Appearance">
      {/* The themes are Dark Mode's only control, and Automatic's: a link or the launcher's rows land here (on the hours while Automatic is chosen). */}
      <Spot id="appearance/dark-mode">{auto ? hero : <Spot id="appearance/automatic">{hero}</Spot>}</Spot>
      <Group testID="appearance-look">
        {auto && (
          <Setting
            id="appearance/automatic"
            testID="appearance-automatic-hours"
            title={automaticHours()}
            detail="Automatic's hours. Light the rest of the day."
          />
        )}
        <Setting id="appearance/text-size" detail={null} stack={false} control="appearance-text-size" />
        <Setting id="appearance/window-corners" detail={null} stack={false}>
          <CornerChoices settings={settings} />
        </Setting>
        <Setting id="appearance/pointer-size" detail={null} stack={false} control="appearance-pointer-size" />
      </Group>
      <Group testID="appearance-motion">
        <Setting id="appearance/reduce-motion" detail="Fades instead of springs." control="appearance-reduce-motion" />
        <Setting id="appearance/highlight-active-window" control="appearance-highlight-window" />
      </Group>
      <Caption>Light and Dark are the same choice as Control Center's Dark Mode.</Caption>
    </Page>
  );
}
