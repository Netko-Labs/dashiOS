/**
 * Displays' hero (docs/design.html, "Settings"): the display at its real
 * shape, framed in ink, showing the wallpaper, with its facts under it
 * ("Built-in · 2880 × 1800 · 16:10", "Looks like 1646 × 1029 at 175% ·
 * 120 Hz"). With several displays each is drawn, side by side at its own
 * shape, and a press chooses the one the cards below change (the chosen one
 * ringed, PictureChoice); while
 * arranging, the hero is the arrangement to drag (arrangement.tsx).
 */

import { PictureChoice, RADIUS, SPACE, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import type { Monitor } from "../../../display-config/monitors.ts";
import { displayHero, type HeroPlace } from "../heroes.ts";

/** The box a display is drawn in: 220 × 138 at most, smaller when several share the hero; its 3 ink frame at radius 12. */
const BOX = { width: 220, height: 138 } as const;
const SEVERAL = { width: 170, height: 106 } as const;
const FRAME = { width: 3, radius: RADIUS.sheet } as const;

/** One display's picture: its shape, framed in ink, showing the wallpaper; its facts under it. */
function Picture({ monitor, wallpaper, box, place }: { monitor: Monitor; wallpaper: string; box: { width: number; height: number }; place: HeroPlace }) {
  const colors = useControlColors();
  const hero = displayHero(monitor, box, place);
  return (
    <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.s }}>
      <View
        style={{
          width: hero.shape.width,
          height: hero.shape.height,
          borderRadius: FRAME.radius,
          borderWidth: FRAME.width,
          borderColor: colors.text,
          // Any sliver the picture leaves is the frame's ink, not a light line.
          backgroundColor: colors.text,
          overflow: "hidden",
        }}
      >
        <Image source={wallpaper} resizeMode="cover" style={{ width: hero.shape.width - 2 * FRAME.width, height: hero.shape.height - 2 * FRAME.width }} />
      </View>
      <View testID={`display-hero-caption:${monitor.name}`}>
        <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>{hero.caption}</Text>
      </View>
    </View>
  );
}

/** A display in the hero: alone, its picture; with others, a picture to pick, the chosen one ringed (CO-9, SE-A19). */
function Screen({
  monitor,
  wallpaper,
  chosen,
  box,
  place,
  onChoose,
}: {
  monitor: Monitor;
  wallpaper: string;
  chosen: boolean;
  box: { width: number; height: number };
  place: HeroPlace;
  onChoose?: () => void;
}) {
  const picture = <Picture monitor={monitor} wallpaper={wallpaper} box={box} place={place} />;
  if (!onChoose) {
    return (
      <View testID={`display-hero:${monitor.name}`} accessibilityLabel={displayHero(monitor, box, place).label}>
        {picture}
      </View>
    );
  }
  return (
    <PictureChoice
      testID={`display-hero:${monitor.name}`}
      label={displayHero(monitor, box, place).label}
      chosen={chosen}
      radius={FRAME.radius}
      onPress={onChoose}
    >
      {picture}
    </PictureChoice>
  );
}

export function DisplayHero({
  monitors,
  chosen,
  rateRow,
  wallpaper,
  onChoose,
}: {
  monitors: readonly Monitor[];
  chosen: string;
  /** The chosen display's cards have a Refresh rate row (so its rate isn't said here too). */
  rateRow: boolean;
  wallpaper: string;
  onChoose: (name: string) => void;
}) {
  const on = monitors.filter((monitor) => monitor.enabled && monitor.mode);
  const several = on.length > 1;
  const box = several ? SEVERAL : BOX;
  return (
    <View
      testID="displays-hero"
      focusGroup
      {...(several ? { accessibilityRole: "listbox" as const } : {})}
      style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: SPACE.xl, paddingTop: SPACE.gap, paddingBottom: SPACE.s }}
    >
      {on.map((monitor) => (
        <Screen
          key={monitor.name}
          monitor={monitor}
          place={{ several, rateRow: rateRow && monitor.name === chosen, all: monitors }}
          wallpaper={wallpaper}
          chosen={!several || monitor.name === chosen}
          box={box}
          {...(several ? { onChoose: () => onChoose(monitor.name) } : {})}
        />
      ))}
    </View>
  );
}
