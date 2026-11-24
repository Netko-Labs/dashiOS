/**
 * The sidebar: Favorites, Locations (the computer and its drives, with
 * eject), and the Trash. A chooser shows the same places but the Trash and
 * the eject buttons (it has no ops); Recents only where it offers them.
 * The places scroll in a short window, so the last of them stays in reach,
 * and a narrow window shows them as a rail of glyphs, each named by its
 * tooltip (chrome.ts).
 */

import { RADIUS, SidebarItem, SidebarSection, SPACE, ToolbarButton, useColors } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import { isInside } from "../files/index.ts";
import { useFiles, useFilesState } from "./context.ts";
import { dropLook, useDropTarget } from "./drop.ts";
import { EJECT, sidebarGlyph } from "./glyphs.ts";
import { mount } from "./lib/drives.ts";
import type { Volume } from "./lib/mounts.ts";
import { favorites, folderAt, type GlyphName, type Location, sameLocation } from "./location.ts";

/**
 * A place: the kit's sidebar row (and its rail), in a drop target that lights
 * the one drop look while files over it would go in (CO-9). Its action (Eject)
 * is a toolbar button at the row's end, in the full sidebar only.
 */
function Row({
  id,
  name,
  glyph,
  current,
  onPress,
  action,
  dropInto = null,
  rail = false,
}: {
  id: string;
  name: string;
  glyph: GlyphName;
  current: boolean;
  onPress: () => void;
  action?: { glyph: string; id: string; label: string; onPress: () => void };
  /** The folder files dropped on the row go into, or the Trash. */
  dropInto?: string | "trash" | null;
  /** Only the glyph, centred; the name is the tooltip. */
  rail?: boolean;
}) {
  const colors = useColors();
  const drop = useDropTarget(dropInto);
  return (
    <View testID={`place:${id}:drop`} {...drop.props} style={{ flexShrink: 0, borderRadius: RADIUS.control, ...dropLook(colors, drop.over, RADIUS.control) }}>
      <SidebarItem
        testID={`place:${id}`}
        label={name}
        glyph={sidebarGlyph(glyph)}
        selected={current}
        onPress={onPress}
        rail={rail}
        {...(action
          ? {
              accessory: <ToolbarButton testID={`place:${id}:${action.id}`} glyph={action.glyph} tooltip={action.label} onPress={action.onPress} />,
            }
          : {})}
      />
    </View>
  );
}

const volumeGlyph = (volume: Volume): GlyphName =>
  volume.ejectable ? "usb" : volume.fstype?.startsWith("nfs") || volume.fstype?.startsWith("cifs") ? "network" : "drive";

export function Sidebar({ recents = true, rail = false }: { recents?: boolean; rail?: boolean }) {
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
    <ScrollView testID="places" style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: SPACE.xxs }}>
      <SidebarSection {...(rail ? {} : { title: "Favorites" })}>
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
              rail={rail}
            />
          ))}
      </SidebarSection>
      <SidebarSection {...(rail ? {} : { title: "Locations" })}>
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
            rail={rail}
            {...(volume.ejectable && ops ? { action: { glyph: EJECT, id: "eject", label: "Eject", onPress: () => void ops.ejectVolume(volume) } } : {})}
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
            rail={rail}
          />
        )}
      </SidebarSection>
    </ScrollView>
  );
}
