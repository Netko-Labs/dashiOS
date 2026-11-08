/**
 * Control Center's laptop row (docs/0.4.0.html, Laptop features B): tiles
 * that appear only on laptops, for the power mode, the graphics card, and
 * the keyboard light (fans come from ASUS Control later). A click opens the
 * tile's page with every choice (laptop-pages.tsx): Automatic and each mode,
 * each level of the light, each graphics mode. A click never steps a setting
 * blindly: stepping the mode left Automatic, and the light only knew off and
 * full. A tile for something the machine lacks is left out, and with none the
 * row is not there.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { cardState, shownMode, useGraphics } from "../graphics/controller.ts";
import { GRAPHICS_LABEL } from "../graphics/policy.ts";
import { graphicsGlyph, keyboardLightGlyph, modeGlyph } from "../laptop/glyphs.ts";
import type { Laptop } from "../laptop/start.ts";
import { keyboardLight, lightLabel, useLaptop } from "../laptop/store.ts";
import { useModes } from "../power/modes/store.ts";
import { MODE_SHORT } from "../power/modes/types.ts";

/** The pages the row's tiles open. */
export type LaptopPage = "laptop-mode" | "laptop-light" | "graphics";

function LaptopTile({
  testID,
  glyph,
  label,
  detail,
  on,
  onOpen,
}: {
  testID: string;
  glyph: string;
  label: string;
  detail: string;
  on: boolean;
  onOpen: () => void;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onOpen}
      onContextMenu={onOpen}
      // The other tiles' shape (panel.tsx): the circle, then the label and what it is set to.
      style={{
        flex: 1,
        minWidth: 0,
        height: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: 12,
        backgroundColor: colors.tile,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? colors.selection : colors.track,
        }}
      >
        <Svg markup={glyph} size={17} color={on ? "#ffffff" : colors.text} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
          {label}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

export function LaptopRow({ laptop, gap, onPage }: { laptop: Laptop; gap: number; onPage: (page: LaptopPage) => void }) {
  const machine = useLaptop(laptop.store);
  const modes = useModes(laptop.modes);
  const graphics = useGraphics(laptop.graphics);
  if (!machine.laptop) return null;
  const tiles: ReactElement[] = [];
  const effective = modes.effective;
  if (modes.available.length > 0 && effective) {
    tiles.push(
      <LaptopTile
        key="mode"
        testID="cc-power-mode"
        glyph={modeGlyph(effective.mode)}
        label={MODE_SHORT[effective.mode]}
        detail={modes.choice === "automatic" ? "Automatic" : "Power mode"}
        on={effective.mode !== "balanced"}
        onOpen={() => onPage("laptop-mode")}
      />,
    );
  }
  if (graphics.hasCard && (graphics.switchable || graphics.lost)) {
    const mode = shownMode(graphics);
    tiles.push(
      <LaptopTile
        key="graphics"
        testID="cc-graphics"
        glyph={graphicsGlyph(graphics.lost !== null)}
        label={graphics.lost ? "Not responding" : mode ? GRAPHICS_LABEL[mode] : "Graphics"}
        detail={graphics.lost ? "Graphics card" : cardState(graphics) || "Graphics"}
        on={!graphics.lost && mode !== "integrated"}
        onOpen={() => onPage("graphics")}
      />,
    );
  }
  const light = keyboardLight(machine);
  if (light) {
    tiles.push(
      <LaptopTile
        key="light"
        testID="cc-keyboard-light"
        glyph={keyboardLightGlyph(light.level > 0)}
        label={lightLabel(light.level, light.max)}
        detail="Keyboard light"
        on={light.level > 0}
        onOpen={() => onPage("laptop-light")}
      />,
    );
  }
  if (tiles.length === 0) return null;
  return <View style={{ flexDirection: "row", gap }}>{tiles}</View>;
}
