/** The sidebar: Favorites, Locations (the computer and its drives, with eject), and the Trash. */

import { Svg, Text, View } from "@mirinjs/metal";
import { SidebarSection, useColors } from "../kit/index.ts";
import { useFiles, useFilesState } from "./context.ts";
import { EJECT, sidebarGlyph } from "./glyphs.ts";
import { favorites, folderAt, type GlyphName, type Location, sameLocation } from "./location.ts";
import type { Volume } from "./mounts.ts";
import { isInside } from "./paths.ts";

function Row({ id, name, glyph, current, onPress, action }: { id: string; name: string; glyph: GlyphName; current: boolean; onPress: () => void; action?: { glyph: string; id: string; onPress: () => void } }) {
  const colors = useColors();
  const ink = current ? "#ffffff" : colors.text;
  return (
    <View
      testID={`place:${id}`}
      onPress={onPress}
      style={{ height: 30, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 8, paddingRight: 4, borderRadius: 7, backgroundColor: current ? colors.selection : "#00000000", hoverBackgroundColor: current ? colors.selection : colors.button }}
    >
      <Svg markup={sidebarGlyph(glyph)} size={16} color={current ? "#ffffff" : colors.selection} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: current ? "semibold" : "normal", color: ink }}>
          {name}
        </Text>
      </View>
      {action && (
        <View testID={`place:${id}:${action.id}`} onPress={action.onPress} style={{ width: 22, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center", hoverBackgroundColor: current ? "#ffffff33" : colors.button }}>
          <Svg markup={action.glyph} size={13} color={current ? "#ffffff" : colors.textMuted} />
        </View>
      )}
    </View>
  );
}

const volumeGlyph = (volume: Volume): GlyphName => (volume.ejectable ? "usb" : volume.fstype?.startsWith("nfs") || volume.fstype?.startsWith("cifs") ? "network" : "drive");

export function Sidebar() {
  const { store, ops } = useFiles();
  const state = useFilesState();
  const { location, volumes } = state;
  const go = (target: Location): void => store.go(target);
  // A volume is "current" while the window is anywhere inside it (the root, only at the root itself).
  const inVolume = (volume: Volume): boolean => volume.mountPoint !== null && location.kind === "folder" && (volume.mountPoint === "/" ? location.path === "/" : isInside(volume.mountPoint, location.path));
  return (
    <>
      <SidebarSection title="Favorites">
        {favorites(store.env.dirs, store.env.home).map((place) => (
          <Row key={place.id} id={place.id} name={place.name} glyph={place.glyph} current={sameLocation(place.location, location)} onPress={() => go(place.location)} />
        ))}
      </SidebarSection>
      <SidebarSection title="Locations">
        {volumes.map((volume) => (
          <Row
            key={volume.id}
            id={`volume:${volume.id}`}
            name={volume.name}
            glyph={volumeGlyph(volume)}
            current={inVolume(volume)}
            onPress={() => (volume.mountPoint ? go(folderAt(volume.mountPoint)) : void ops.mountVolume(volume))}
            {...(volume.ejectable ? { action: { glyph: EJECT, id: "eject", onPress: () => void ops.ejectVolume(volume) } } : {})}
          />
        ))}
        <Row id="trash" name="Trash" glyph="trash" current={location.kind === "trash" || (location.kind === "folder" && isInside(store.env.trash.files, location.path))} onPress={() => go({ kind: "trash" })} />
      </SidebarSection>
    </>
  );
}
