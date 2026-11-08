/**
 * "…"'s popover (menubar-status.tsx): the status items that didn't fit in
 * the bar, in a row of tiles under it, in the bar's order. Each works as it
 * does in the bar: an app's or applet's icon activates or opens its menu
 * (the menu takes the popover's place, under the tile), Wi-Fi opens Control
 * Center on its Wi-Fi page, Sound and the moon open Control Center.
 */

import { useColors } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { MOON } from "./control-center/glyphs.ts";
import { type ExtrasStore, type MenuBarExtra, useExtras } from "./extras/index.ts";
import { ExtraItem, TILE } from "./extras/view.tsx";
import { networkGlyph, speakerGlyph } from "./glyphs.ts";
import { KeyCatcher } from "./overlay.tsx";
import { type SystemStore, useSystem } from "./system/store.ts";

export const OVERFLOW = { padding: 6, gap: 4, radius: 12 } as const;

export interface OverflowActions {
  /** An extra's menu, its right edge at `right` (it replaces the row). */
  menu(extra: MenuBarExtra, right: number): void;
  activate(extra: MenuBarExtra, x: number, y: number): void;
  /** Control Center, on its Wi-Fi page or its main one. */
  controlCenter(page: "wifi" | "main"): void;
}

function GlyphTile({ testID, markup, onPress }: { testID: string; markup: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{ width: TILE, height: TILE, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}
    >
      <Svg markup={markup} size={16} color={colors.text} />
    </View>
  );
}

export function OverflowRow({
  keys,
  right,
  extras,
  system,
  openKey,
  actions,
  onClose,
}: {
  /** The hidden items' keys (menubar.tsx's slots: `extra:<key>`, "network", "sound", "dnd"). */
  keys: readonly string[];
  right: number;
  extras: ExtrasStore;
  system: SystemStore;
  /** The extra whose menu is open. */
  openKey: string | null;
  actions: OverflowActions;
  onClose: () => void;
}) {
  const colors = useColors();
  const all = useExtras(extras);
  const { network, volume } = useSystem(system);
  const tiles = keys.flatMap((key) => {
    if (key.startsWith("extra:")) {
      const extra = all.find((each) => `extra:${each.key}` === key);
      return extra
        ? [
            <ExtraItem
              key={key}
              extra={extra}
              tile
              open={openKey === extra.key}
              onMenu={(each, at) => actions.menu(each, at)}
              onActivate={(each, x, y) => {
                actions.activate(each, x, y);
                onClose();
              }}
            />,
          ]
        : [];
    }
    if (key === "network" && network)
      return [
        <GlyphTile
          key={key}
          testID="overflow-network"
          markup={networkGlyph(network)}
          onPress={() => actions.controlCenter(network.kind === "wired" ? "main" : "wifi")}
        />,
      ];
    if (key === "sound" && volume)
      return [<GlyphTile key={key} testID="overflow-volume" markup={speakerGlyph(volume.level, volume.muted)} onPress={() => actions.controlCenter("main")} />];
    if (key === "dnd") return [<GlyphTile key={key} testID="overflow-dnd" markup={MOON} onPress={() => actions.controlCenter("main")} />];
    return [];
  });
  const width = tiles.length * TILE + Math.max(0, tiles.length - 1) * OVERFLOW.gap + OVERFLOW.padding * 2 + 2;
  return (
    <View
      testID="overflow-row"
      style={{
        position: "absolute",
        top: 4,
        left: Math.max(8, right - width),
        flexDirection: "row",
        gap: OVERFLOW.gap,
        padding: OVERFLOW.padding,
        borderRadius: OVERFLOW.radius,
        borderWidth: 1,
        borderColor: colors.separator,
        backgroundColor: colors.launcher,
        shadow: "xl",
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />
      {tiles}
    </View>
  );
}
