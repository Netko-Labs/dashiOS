/**
 * Wallpaper: a grid of the bundled wallpapers and the photos the person
 * added, how the picture fills the screen (Fill, Fit, or Center), and "Add
 * photo…", which opens the desktop's file chooser through the portal. Where
 * it doesn't answer, the pane says so and how to get it back (never a typed
 * path, SE-A30).
 * All of it is settings.json `appearance.wallpaper`, which the shell sends
 * to the compositor as it changes (wallpaper/sync.ts). Below the pictures is
 * the Live section (wallpaper-live.tsx).
 */

import { useState } from "react";
import { Button, Caption, Group, useSurface } from "../../../shared/cards/index.ts";
import { DEFAULT_WALLPAPER_MODE, selectedRef } from "../../../wallpaper/catalog.ts";
import type { PhotoChooser } from "../../../wallpaper/chooser.ts";
import { pathFor, photoProblem, wallpaperTiles, withPhoto } from "../../../wallpaper/tiles.ts";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Page } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Failure } from "./parts.tsx";
import { LiveSection, NO_CHOOSER, TileGrid, WallpaperTile } from "./wallpaper-live.tsx";

export function WallpaperPane({ settings, chooser }: { settings: SettingsStore; chooser: PhotoChooser }) {
  const _colors = useColors();
  const _surface = useSurface();
  const { wallpaper } = useSettings(settings).data;
  const mode = wallpaper.mode ?? DEFAULT_WALLPAPER_MODE;
  // A picture is selected only while no live wallpaper is.
  const selected = wallpaper.kind === undefined || wallpaper.kind === "picture" ? selectedRef({ path: wallpaper.path, mode }) : null;
  const tiles = wallpaperTiles(wallpaper.photos ?? []);
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
      .catch(() => setNote(NO_CHOOSER));
  };

  return (
    <Page title="Wallpaper">
      <Group testID="wallpaper-grid">
        <TileGrid>
          {tiles.map((tile) => (
            <WallpaperTile
              key={tile.ref}
              testID={`wallpaper:${tile.ref}`}
              title={tile.title}
              image={tile.image}
              selected={tile.ref === selected}
              onPress={() => choose(tile.ref)}
            />
          ))}
        </TileGrid>
      </Group>
      <Group>
        <Setting id="wallpaper/add-photo">
          <Button testID="wallpaper-add" label="Add photo…" onPress={addPhoto} />
        </Setting>
        <Setting id="wallpaper/picture" stack={false} detail={null} control="wallpaper-mode" />
      </Group>
      {note !== null && <Failure testID="wallpaper-note">{note}</Failure>}
      <LiveSection settings={settings} chooser={chooser} />
      <Caption>The lock screen shows the still wallpaper behind its tint, never a live one.</Caption>
    </Page>
  );
}
