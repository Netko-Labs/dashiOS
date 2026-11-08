/**
 * Displays' hero (docs/design.html, "Settings"): the display at its real
 * shape, framed in ink, showing the wallpaper, with its facts under it
 * ("Built-in · 2880 × 1800 · 16:10", "Looks like 1646 × 1029 at 175% ·
 * 120 Hz"). With several displays each is drawn, side by side at its own
 * shape, and a press chooses the one the cards below change; while
 * arranging, the hero is the arrangement to drag (arrangement.tsx).
 */

import { Image, Text, View } from "@mirinjs/metal";
import type { Monitor } from "../../display-config/monitors.ts";
import type { ScreenInfo } from "../../displays.ts";
import { useControlColors } from "../../shared/controls/palette.ts";
import { displayHero } from "../heroes.ts";

/** The box a display is drawn in: 220 × 138 at most, smaller when several share the hero. */
const BOX = { width: 220, height: 138 } as const;

function Screen({
  monitor,
  screen,
  wallpaper,
  chosen,
  box,
  onChoose,
}: {
  monitor: Monitor;
  screen: ScreenInfo | undefined;
  wallpaper: string;
  chosen: boolean;
  box: { width: number; height: number };
  onChoose?: () => void;
}) {
  const colors = useControlColors();
  const hero = displayHero(monitor, screen, box);
  return (
    <View
      testID={`display-hero:${monitor.name}`}
      {...(onChoose ? { focusable: true, onPress: onChoose } : {})}
      accessibilityRole="button"
      accessibilityLabel={hero.facts}
      accessibilityState={{ selected: chosen }}
      style={{ flexDirection: "column", alignItems: "center", gap: 6, borderRadius: 12, opacity: chosen ? 1 : 0.6 }}
    >
      <View
        style={{
          width: hero.shape.width,
          height: hero.shape.height,
          borderRadius: 12,
          borderWidth: 3,
          borderColor: chosen ? colors.text : colors.line,
          // Any sliver the picture leaves is the frame's ink, not a light line.
          backgroundColor: chosen ? colors.text : colors.line,
          overflow: "hidden",
        }}
      >
        <Image source={wallpaper} resizeMode="cover" style={{ width: hero.shape.width - 6, height: hero.shape.height - 6 }} />
      </View>
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.offInk }}>{hero.facts}</Text>
      {hero.looks && <Text style={{ fontSize: 11.5, color: colors.muted }}>{hero.looks}</Text>}
    </View>
  );
}

export function DisplayHero({
  monitors,
  screens,
  chosen,
  wallpaper,
  onChoose,
}: {
  monitors: readonly Monitor[];
  screens: readonly ScreenInfo[];
  chosen: string;
  wallpaper: string;
  onChoose: (name: string) => void;
}) {
  const on = monitors.filter((monitor) => monitor.enabled && monitor.mode);
  const several = on.length > 1;
  const box = several ? { width: 170, height: 106 } : BOX;
  return (
    <View
      testID="displays-hero"
      focusGroup
      style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 24, paddingTop: 10, paddingBottom: 6 }}
    >
      {on.map((monitor) => (
        <Screen
          key={monitor.name}
          monitor={monitor}
          screen={screens.find((screen) => screen.name === monitor.name)}
          wallpaper={wallpaper}
          chosen={!several || monitor.name === chosen}
          box={box}
          {...(several ? { onChoose: () => onChoose(monitor.name) } : {})}
        />
      ))}
    </View>
  );
}
