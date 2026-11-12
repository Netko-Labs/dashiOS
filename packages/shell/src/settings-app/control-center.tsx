/**
 * Settings › Control Center (docs/design.html, "Settings"): its hero is a
 * named miniature of the panel as it is now (the person's layout, the
 * tiles that are on in green, the sliders at their levels). "Edit the
 * layout" is ink, as green only ever means on, and turns the hero into the
 * same editor the panel becomes on a right-click (control-center/panel.tsx,
 * embedded): remove a tile with its "−", click it to switch its size, drag
 * to move it, add from the list under it (applets' controls under their
 * applet's name); Done keeps it, Cancel or Esc throws the edits away, Reset
 * puts the default back. The sliders' shape is one choice here, and the
 * applets that offer controls are listed with what they offer. The layout
 * is this machine's (control-center/layout-store.ts), so the panel follows
 * at once.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { type AppletTile, isAppletTile } from "../control-center/applet-tiles.ts";
import { isThere } from "../control-center/catalog.ts";
import { type Controls, useControls } from "../control-center/controls.tsx";
import { PUZZLE } from "../control-center/glyphs.ts";
import { ControlCenterPanel, type ControlCenterProps, useLayout } from "../control-center/index.ts";
import { type Layout, type Placed, pack, shown } from "../control-center/layout.ts";
import { Caption, Group } from "../shared/cards/index.ts";
import { PillButton } from "../shared/controls/inputs.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import { InkFill } from "../shared/controls/parts.tsx";
import { appletOffers, MINIATURE, miniatureFrame, miniatureHeight } from "./lib/heroes.ts";
import { Row as Item } from "./lib/row.tsx";
import { Setting } from "./lib/setting.tsx";
import { Spot } from "./spot.tsx";
import { Choices, Hero, Page } from "./ui.tsx";

export type ControlCenterEditor = Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "embedded">;

/** The miniature's glyph and word: 14 and 10.5 SemiBold; a word keeps 8 clear of its tile's edges. */
export const MINI_TILE = { glyph: 14, word: 10.5, inset: 8 } as const;

/** One tile of the miniature, in the panel's own colors and shapes, smaller: its glyph and its word, as the panel draws them. */
function MiniTile({ tile, controls }: { tile: Placed; controls: Controls }) {
  const colors = useControlColors();
  const look = controls.lookOf(tile.id);
  const frame = miniatureFrame(tile);
  const level = controls.levelOf(tile.id);
  const on = look?.on === true && level === null;
  const slider = level !== null && (tile.size === "tall" || tile.size === "flat");
  const battery = tile.id === "battery" ? controls.snapshot.battery : null;
  const words = battery ? `${battery.percent}% · battery` : (look?.title ?? "");
  const round = tile.size === "round";
  const ink = on ? colors.onInk : colors.offInk;
  const radius = on ? 14 : 22;
  const glyph = look?.glyph;
  if (slider) {
    const standing = tile.size === "tall";
    const total = standing ? frame.height : frame.width;
    const fill = Math.round(total * Math.min(Math.max(level, 0), 1));
    // The glyph sits where the panel's chip does (the bottom of a tall slider, the left of a flat one), on the ink or on the track.
    const onInk = fill > 26;
    return (
      <View
        testID={`cc-mini:${tile.id}`}
        style={{ position: "absolute", ...frame, borderRadius: radius, backgroundColor: colors.off, overflow: "hidden", opacity: look?.dim ? 0.5 : 1 }}
      >
        <InkFill length={fill} total={total} standing={standing} radius={22} />
        {glyph && (
          <View
            style={{
              position: "absolute",
              ...(standing ? { left: 0, right: 0, bottom: 8, alignItems: "center" } : { left: 10, top: 0, bottom: 0, justifyContent: "center" }),
            }}
          >
            <Svg markup={glyph} size={MINI_TILE.glyph} color={onInk ? colors.fillInk : colors.offInk} />
          </View>
        )}
      </View>
    );
  }
  return (
    <View
      testID={`cc-mini:${tile.id}`}
      style={{
        position: "absolute",
        ...frame,
        borderRadius: radius,
        backgroundColor: on ? colors.on : colors.off,
        flexDirection: round ? "column" : "row",
        alignItems: "center",
        justifyContent: round ? "center" : "flex-start",
        gap: round ? 2 : 6,
        paddingLeft: round ? MINI_TILE.inset : 10,
        paddingRight: MINI_TILE.inset,
        overflow: "hidden",
        opacity: look?.dim ? 0.5 : 1,
      }}
    >
      {glyph && <Svg markup={glyph} size={MINI_TILE.glyph} color={ink} />}
      {/* A round tile's word is centred across it, a wide tile's follows its glyph. */}
      <View style={{ ...(round ? { alignSelf: "stretch" } : { flex: 1 }), minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: MINI_TILE.word, fontWeight: "semibold", color: ink, textAlign: round ? "center" : "left" }}>
          {words}
        </Text>
      </View>
    </View>
  );
}

/** The panel as it is now, small. */
function Miniature({ editor, controls }: { editor: ControlCenterEditor; controls: Controls }) {
  const colors = useControlColors();
  const layout = useLayout(editor.layout);
  const here = (id: string): boolean => (isAppletTile(id) ? controls.applet(id) !== undefined : isThere(id, controls.snapshot));
  const placed = pack(shown(layout, here));
  return (
    <View
      testID="cc-miniature"
      accessibilityRole="group"
      accessibilityLabel="Control Center as it is now"
      style={{ width: MINIATURE.width, height: miniatureHeight(placed), padding: MINIATURE.padding, borderRadius: 24, backgroundColor: colors.surface }}
    >
      <View style={{ flex: 1, position: "relative" }}>
        {placed.map((tile) => (
          <MiniTile key={tile.id} tile={tile} controls={controls} />
        ))}
      </View>
    </View>
  );
}

/** The sliders' shape across the layout: tall when every slider stands, else flat. */
export function slidersShape(layout: Layout, isSlider: (id: string) => boolean): "tall" | "flat" {
  const sliders = layout.filter((item) => isSlider(item.id));
  return sliders.length > 0 && sliders.every((item) => item.size === "tall") ? "tall" : "flat";
}

/** Every slider in `size`, the rest as they were. */
export function withSliders(layout: Layout, isSlider: (id: string) => boolean, size: "tall" | "flat"): Layout {
  return layout.map((item) => (isSlider(item.id) ? { ...item, size } : item));
}

const NO_TILE_LIST: readonly AppletTile[] = [];
const NO_TILES = { subscribe: () => () => {}, getSnapshot: () => NO_TILE_LIST };

function EditorPane({ editor }: { editor: ControlCenterEditor }) {
  const colors = useControlColors();
  const controls = useControls(editor);
  const layout = useLayout(editor.layout);
  const [editing, setEditing] = useState(false);
  const applets = useSyncExternalStore(editor.applets?.subscribe ?? NO_TILES.subscribe, editor.applets?.getSnapshot ?? NO_TILES.getSnapshot);
  const isSlider = (id: string): boolean => controls.sizesOf(id).includes("tall");
  // The choice is offered while a slider is in the panel now (one whose device is there).
  const here = (id: string): boolean => (isAppletTile(id) ? controls.applet(id) !== undefined : isThere(id, controls.snapshot));
  const hasSliders = shown(layout, here).some((item) => isSlider(item.id));
  return (
    <>
      <Hero testID="cc-hero" padding={18}>
        <View style={{ flex: 1, alignItems: "center" }}>
          {editing ? (
            <View testID="control-center-editor">
              <ControlCenterPanel {...editor} embedded page="main" onPage={() => {}} onClose={() => setEditing(false)} />
            </View>
          ) : (
            <Miniature editor={editor} controls={controls} />
          )}
        </View>
      </Hero>
      <Group testID="cc-settings">
        <Setting id="control-center/edit">
          <PillButton testID="cc-edit" label={editing ? "Editing" : "Edit"} tone="ink" disabled={editing} onPress={() => setEditing(true)} />
        </Setting>
        {hasSliders && (
          <Setting id="control-center/sliders" detail={null}>
            <Choices
              testID="cc-sliders"
              value={slidersShape(layout, isSlider)}
              options={[
                { value: "tall", label: "Tall pair" },
                { value: "flat", label: "Flat" },
              ]}
              onChange={(size) => editor.layout.set(withSliders(layout, isSlider, size))}
            />
          </Setting>
        )}
      </Group>
      {applets.length > 0 && (
        <Spot id="control-center/applets" cards>
          <Group testID="cc-applets">
            {appletOffers(applets).map((offer) => (
              <Item
                key={offer.applet}
                testID={`cc-applet:${offer.applet}`}
                label={offer.applet}
                detail={offer.titles.join(" · ")}
                glyph={applets.find((tile) => tile.appletName === offer.applet)?.glyph ?? PUZZLE}
              >
                <Text style={{ fontSize: 12.5, color: colors.muted }}>{offer.titles.length === 1 ? "1 control" : `${offer.titles.length} controls`}</Text>
              </Item>
            ))}
          </Group>
        </Spot>
      )}
      <Caption>Right-click Control Center to edit it in place too. Tiles for what this computer lacks are left out, and come back where they were.</Caption>
    </>
  );
}

export function ControlCenterPane({ editor }: { editor: ControlCenterEditor | null }) {
  return <Page title="Control Center">{editor ? <EditorPane editor={editor} /> : <Caption>Control Center starts with the menu bar.</Caption>}</Page>;
}
