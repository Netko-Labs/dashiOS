/**
 * Appearance: Light, Dark, or Auto (dark in the evening), as small previews to pick from, the same
 * switch as Control Center's Dark Mode tile, the accent color, and how round
 * windows are (settings.json `appearance.cornerRadius`; the shell follows the
 * file, so a pick shows on the open windows at once).
 */

import { darkColors, lightColors, type Palette, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type FlagsStore, useFlags } from "../../control-center/flags.ts";
import { CORNER_NAMES, type CornerName, DEFAULT_CORNERS } from "../../corners.ts";
import { Switch } from "../../wifi/switch.tsx";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row, useSurface } from "../ui.tsx";

const CORNER_LABELS: Record<CornerName, string> = { none: "None", small: "Small", medium: "Medium", large: "Large" };
const CORNER_OPTIONS = CORNER_NAMES.map((value) => ({ value, label: CORNER_LABELS[value] }));

/** A miniature desktop: a menu bar, a window with two lines of text. */
function MiniDesktop({ palette }: { palette: Palette }) {
  const ground = palette === darkColors ? "#1e1e20" : "#f5f5f7";
  return (
    <View style={{ width: 126, height: 78, backgroundColor: "#3E8A72" }}>
      <View style={{ height: 8, backgroundColor: palette.menuBar }} />
      <View
        style={{ position: "absolute", left: 18, top: 20, width: 82, height: 40, borderRadius: 5, padding: 6, gap: 4, backgroundColor: ground, shadow: "sm" }}
      >
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: palette.text }} />
        <View style={{ width: 60, height: 3, borderRadius: 2, backgroundColor: palette.textMuted }} />
        <View style={{ width: 50, height: 3, borderRadius: 2, backgroundColor: palette.textMuted }} />
      </View>
    </View>
  );
}

/** A preview to pick from: one palette, or (`auto`) light on the left and dark on the right. */
function Preview({
  palette,
  label,
  selected,
  testID,
  onPress,
}: {
  palette: Palette | "auto";
  label: string;
  selected: boolean;
  testID: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <View testID={testID} onPress={onPress} style={{ flexDirection: "column", alignItems: "center", gap: 6 }}>
      <View style={{ width: 132, height: 84, borderRadius: 10, padding: 3, borderWidth: 2, borderColor: selected ? colors.selection : "#00000000" }}>
        <View style={{ flex: 1, borderRadius: 7, overflow: "hidden", backgroundColor: "#3E8A72" }}>
          {palette === "auto" ? (
            <View style={{ flex: 1, flexDirection: "row" }}>
              <View style={{ width: 63, height: 78, overflow: "hidden" }}>
                <MiniDesktop palette={lightColors} />
              </View>
              <View style={{ width: 63, height: 78, overflow: "hidden" }}>
                <View style={{ position: "absolute", left: -63, top: 0 }}>
                  <MiniDesktop palette={darkColors} />
                </View>
              </View>
            </View>
          ) : (
            <MiniDesktop palette={palette} />
          )}
        </View>
      </View>
      <Text style={{ fontSize: 12, fontWeight: selected ? "semibold" : "normal", color: colors.text }}>{label}</Text>
    </View>
  );
}

/**
 * Light, Dark, and Auto as previews to pick from. Light and Dark are Control Center's Dark Mode
 * switch; Auto (settings.json `appearance.auto`) lets the shell flip it by the time of day.
 */
export function AppearancePreviews({ flags, settings }: { flags: FlagsStore; settings: SettingsStore }) {
  const { dark } = useFlags(flags);
  const { appearance } = useSettings(settings).data;
  const auto = appearance.auto === true;
  const pick = (next: boolean) => {
    settings.patch("appearance", { auto: undefined });
    flags.set({ dark: next });
  };
  return (
    <View style={{ flexDirection: "row", gap: 20, padding: 16, paddingBottom: 12 }}>
      <Preview testID="appearance-light" palette={lightColors} label="Light" selected={!auto && !dark} onPress={() => pick(false)} />
      <Preview testID="appearance-dark" palette={darkColors} label="Dark" selected={!auto && dark} onPress={() => pick(true)} />
      <Preview testID="appearance-auto" palette="auto" label="Auto" selected={auto} onPress={() => settings.patch("appearance", { auto: true })} />
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
      onChange={(cornerRadius) => settings.patch("appearance", { cornerRadius })}
    />
  );
}

export function AppearancePane({ flags, settings }: { flags: FlagsStore; settings: SettingsStore }) {
  const colors = useColors();
  const surface = useSurface();
  const { dark } = useFlags(flags);
  const { appearance } = useSettings(settings).data;
  return (
    <Page title="Appearance">
      <Group>
        <AppearancePreviews flags={flags} settings={settings} />
      </Group>
      <Group>
        <Row label="Dark Mode" detail="Menus, the Dock, and apps that follow the system switch together.">
          <Switch testID="appearance-dark-mode" on={dark} onChange={(on) => flags.set({ dark: on })} />
        </Row>
        <Row label="Accent color" detail="Selections, switches, and sliders.">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              testID="appearance-accent"
              style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.selection, borderWidth: 2, borderColor: surface.card, shadow: "sm" }}
            />
            <Text style={{ fontSize: 12, color: colors.textMuted }}>Kombu</Text>
          </View>
        </Row>
        <Row stack label="Window corners" detail="How round windows are, app content included.">
          <CornerChoices settings={settings} />
        </Row>
        <Row label="Reduce motion" detail="Windows open, close, minimize, and move without animation.">
          <Switch
            testID="appearance-reduce-motion"
            on={appearance.reduceMotion === true}
            onChange={(reduceMotion) => settings.patch("appearance", { reduceMotion })}
          />
        </Row>
      </Group>
      <Caption>Dark Mode is the same switch as in Control Center. Auto turns it on at 7 PM and off at 7 AM.</Caption>
    </Page>
  );
}
