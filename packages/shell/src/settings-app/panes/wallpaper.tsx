/**
 * Wallpaper: a grid of the bundled wallpapers and the photos the person
 * added, how the picture fills the screen (Fill, Fit, or Center), and "Add
 * Photo…", which opens the desktop's file chooser through the portal. Where
 * there is no portal (a development run) a path field takes its place.
 * All of it is settings.json `appearance.wallpaper`, which the shell sends
 * to the compositor as it changes (wallpaper/sync.ts). Below the pictures is
 * the Live section (wallpaper-live.tsx).
 */

import { Image, Text, TextInput, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { useColors } from "@dashi/ui";
import { DEFAULT_WALLPAPER_MODE, selectedRef, type WallpaperMode } from "../../wallpaper/catalog.ts";
import type { PhotoChooser } from "../../wallpaper/chooser.ts";
import { scanLive } from "../../wallpaper/live/tiles.ts";
import { pathFor, photoProblem, type WallpaperTile, wallpaperTiles, withPhoto } from "../../wallpaper/tiles.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Page, Row, useSurface } from "../ui.tsx";
import { LiveSection } from "./wallpaper-live.tsx";

const MODE_OPTIONS: ReadonlyArray<{ value: WallpaperMode; label: string }> = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "center", label: "Center" },
];

const TILE = { width: 148, height: 83 };

function Tile({ tile, selected, onPress }: { tile: WallpaperTile; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <View testID={`wallpaper:${tile.ref}`} onPress={onPress} style={{ flexDirection: "column", alignItems: "center", gap: 5, width: TILE.width + 8 }}>
      <View style={{ padding: 2, borderRadius: 9, borderWidth: 2, borderColor: selected ? colors.selection : "#00000000" }}>
        <View style={{ width: TILE.width, height: TILE.height, borderRadius: 6, overflow: "hidden" }}>
          <Image source={tile.image} resizeMode="cover" style={{ width: TILE.width, height: TILE.height }} />
        </View>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: selected ? "semibold" : "normal", color: colors.text }}>
        {tile.title}
      </Text>
    </View>
  );
}

export function WallpaperPane({ settings, chooser, home }: { settings: SettingsStore; chooser: PhotoChooser; home?: string }) {
  const colors = useColors();
  const surface = useSurface();
  const { wallpaper } = useSettings(settings).data;
  const mode = wallpaper.mode ?? DEFAULT_WALLPAPER_MODE;
  // A picture is selected only while no live wallpaper is.
  const selected = wallpaper.kind === undefined || wallpaper.kind === "picture" ? selectedRef({ path: wallpaper.path, mode }) : null;
  // Steam is looked at when the pane opens, not on every redraw.
  const scan = useMemo(() => scanLive(home), [home]);
  const tiles = wallpaperTiles(wallpaper.photos ?? []);
  // The path field takes over when there is no chooser to ask.
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const choose = (ref: string) => settings.patch("wallpaper", { path: pathFor(ref), kind: "picture" });
  const adopt = (path: string): boolean => {
    const problem = photoProblem(path);
    setNote(problem);
    if (problem !== null) return false;
    settings.patch("wallpaper", { photos: withPhoto(wallpaper.photos ?? [], path.trim()), path: path.trim(), kind: "picture" });
    return true;
  };
  const addPhoto = () => {
    setNote(null);
    chooser
      .choose()
      .then((path) => {
        if (path !== null) adopt(path);
      })
      .catch(() => {
        setTyping(true);
        setNote("There is no file chooser here. Type the path of a photo instead.");
      });
  };

  return (
    <Page title="Wallpaper">
      <Group testID="wallpaper-grid">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 14 }}>
          {tiles.map((tile) => (
            <Tile key={tile.ref} tile={tile} selected={tile.ref === selected} onPress={() => choose(tile.ref)} />
          ))}
        </View>
      </Group>
      <Group>
        <Row label="Add Photo…" detail="A PNG or JPEG from your files; it stays where it is.">
          <Button testID="wallpaper-add" label="Add Photo…" onPress={addPhoto} />
        </Row>
        {typing && (
          <Row stack label="Path of a photo" detail="Press Return to use it.">
            <TextInput
              testID="wallpaper-path"
              value={typed}
              placeholder="/home/you/Pictures/photo.jpg"
              autoFocus
              onChangeText={setTyped}
              onSubmitEditing={(text) => {
                if (adopt(text)) setTyped("");
              }}
              style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
            />
          </Row>
        )}
        <Row stack label="Picture" detail="Fill covers the screen and crops what does not fit; Fit shows all of the picture; Center leaves it at its size.">
          <Choices testID="wallpaper-mode" value={mode} options={MODE_OPTIONS} onChange={(next) => settings.patch("wallpaper", { mode: next })} />
        </Row>
      </Group>
      {note !== null && (
        <View testID="wallpaper-note" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, color: colors.critical }}>{note}</Text>
        </View>
      )}
      <LiveSection settings={settings} chooser={chooser} scan={scan} />
      <Caption>The lock screen shows the still wallpaper behind its tint, never a live one.</Caption>
    </Page>
  );
}
