/**
 * The sidebar: Favorites, Locations (the computer and its drives, with
 * eject), and the Trash. A chooser shows the same places but the Trash and
 * the eject buttons (it has no ops); Recents only where it offers them.
 */

import { rowLook, SelectionBar, SidebarSection, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useFiles, useFilesState } from "./context.ts";
import { mount } from "./drives.ts";
import { useDropTarget } from "./drop.ts";
import { EJECT, sidebarGlyph } from "./glyphs.ts";
import { favorites, folderAt, type GlyphName, type Location, sameLocation } from "./location.ts";
import type { Volume } from "./mounts.ts";
import { isInside } from "./paths.ts";

function Row({
  id,
  name,
  glyph,
  current,
  onPress,
  action,
  dropInto = null,
}: {
  id: string;
  name: string;
  glyph: GlyphName;
  current: boolean;
  onPress: () => void;
  action?: { glyph: string; id: string; onPress: () => void };
  /** The folder files dropped on the row go into, or the Trash. */
  dropInto?: string | "trash" | null;
}) {
  const colors = useColors();
  const drop = useDropTarget(dropInto);
  const look = rowLook(colors, current);
  return (
    <View
      testID={`place:${id}`}
      onPress={onPress}
      {...drop.props}
      style={{
        height: 30,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingLeft: 8,
        paddingRight: 4,
        borderRadius: 7,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
        ...(drop.over ? { borderWidth: 2, borderColor: colors.selection } : {}),
      }}
    >
      {current && <SelectionBar rowHeight={30} />}
      {/* Kombu marks the selected row only; a glyph is muted at rest and ink on the wash (CO-2). */}
      <Svg markup={sidebarGlyph(glyph)} size={16} color={look.glyph} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: current ? "semibold" : "normal", color: look.ink }}>
          {name}
        </Text>
      </View>
      {action && (
        <View
          testID={`place:${id}:${action.id}`}
          onPress={action.onPress}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            alignItems: "center",
            justifyContent: "center",
            hoverBackgroundColor: colors.button,
          }}
        >
          <Svg markup={action.glyph} size={13} color={look.glyph} />
        </View>
      )}
    </View>
  );
}

const volumeGlyph = (volume: Volume): GlyphName =>
  volume.ejectable ? "usb" : volume.fstype?.startsWith("nfs") || volume.fstype?.startsWith("cifs") ? "network" : "drive";

export function Sidebar({ recents = true }: { recents?: boolean }) {
  const { store, ops } = useFiles();
  const state = useFilesState();
  const { location, volumes } = state;
  const go = (target: Location): void => store.go(target);
  // A volume is "current" while the window is anywhere inside it (the root, only at the root itself).
  const inVolume = (volume: Volume): boolean =>
    volume.mountPoint !== null &&
    location.kind === "folder" &&
    (volume.mountPoint === "/" ? location.path === "/" : isInside(volume.mountPoint, location.path));
  return (
    <>
      <SidebarSection title="Favorites">
        {favorites(store.env.dirs, store.env.home)
          .filter((place) => recents || place.location.kind !== "recents")
          .map((place) => (
            <Row
              key={place.id}
              id={place.id}
              name={place.name}
              glyph={place.glyph}
              current={sameLocation(place.location, location)}
              onPress={() => go(place.location)}
              dropInto={place.location.kind === "folder" ? place.location.path : null}
            />
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
            onPress={() => {
              if (volume.mountPoint) go(folderAt(volume.mountPoint));
              else if (ops) void ops.mountVolume(volume);
              else void mount(volume, store.env.run).then((result) => ("path" in result ? go(folderAt(result.path)) : store.say(result.error, true)));
            }}
            dropInto={volume.mountPoint}
            {...(volume.ejectable && ops ? { action: { glyph: EJECT, id: "eject", onPress: () => void ops.ejectVolume(volume) } } : {})}
          />
        ))}
        {ops && (
          <Row
            id="trash"
            name="Trash"
            glyph="trash"
            current={location.kind === "trash" || (location.kind === "folder" && isInside(store.env.trash.files, location.path))}
            onPress={() => go({ kind: "trash" })}
            dropInto="trash"
          />
        )}
      </SidebarSection>
    </>
  );
}
