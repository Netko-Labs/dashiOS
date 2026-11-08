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

import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { type AppletTile, isAppletTile } from "../../control-center/applet-tiles.ts";
import { isThere } from "../../control-center/catalog.ts";
import { type Controls, useControls } from "../../control-center/controls.tsx";
import { PUZZLE } from "../../control-center/glyphs.ts";
import { ControlCenterPanel, type ControlCenterProps, useLayout } from "../../control-center/index.ts";
import { type Layout, type Placed, pack, shown } from "../../control-center/layout.ts";
import { PillButton } from "../../shared/controls/inputs.tsx";
import { useControlColors } from "../../shared/controls/palette.ts";
import { InkFill } from "../../shared/controls/parts.tsx";
import { appletOffers, MINIATURE, miniatureFrame, miniatureHeight } from "../heroes.ts";
import { Caption, Choices, Group, Hero, Item, Page, Setting, Spot } from "../ui.tsx";

export type ControlCenterEditor = Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "embedded">;

/** One tile of the miniature, in the panel's own colors and shapes, smaller. */
function MiniTile({ tile, controls }: { tile: Placed; controls: Controls }) {
  const colors = useControlColors();
  const look = controls.lookOf(tile.id);
  const frame = miniatureFrame(tile);
  const level = controls.levelOf(tile.id);
  const on = look?.on === true && level === null;
  const slider = level !== null && (tile.size === "tall" || tile.size === "flat");
  const battery = tile.id === "battery" ? controls.snapshot.battery : null;
  const words = battery ? `${battery.percent}% · battery` : (look?.title ?? "");
  const radius = on ? 14 : 22;
  return (
    <View
      testID={`cc-mini:${tile.id}`}
      style={{
        position: "absolute",
        ...frame,
        borderRadius: radius,
        backgroundColor: on ? colors.on : colors.off,
        flexDirection: tile.size === "round" ? "column" : "row",
        alignItems: "center",
        justifyContent: tile.size === "round" ? "center" : "flex-start",
        paddingLeft: tile.size === "round" ? 0 : 10,
        overflow: slider ? "hidden" : "visible",
        opacity: look?.dim ? 0.5 : 1,
      }}
    >
      {slider ? (
        <InkFill
          length={Math.round((tile.size === "tall" ? frame.height : frame.width) * Math.min(Math.max(level, 0), 1))}
          total={tile.size === "tall" ? frame.height : frame.width}
          standing={tile.size === "tall"}
          radius={22}
        />
      ) : (
        // A round tile's word is centred across it, a wide tile's starts at its left.
        <View style={{ width: "100%", flexDirection: "row", justifyContent: tile.size === "round" ? "center" : "flex-start" }}>
          <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: "semibold", color: on ? colors.onInk : colors.offInk }}>
            {words}
          </Text>
        </View>
      )}
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
