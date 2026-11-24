/**
 * The Wallpaper pane's Live section: Dashi's own animated wallpapers and
 * videos the person adds, then "Pause on battery" and the frame rate.
 * Choosing one writes `kind` and its item to `appearance.wallpaper`; the
 * shell sends it to the compositor, which draws or plays it (wallpaper/live/).
 */

import { statSync } from "node:fs";
import { PictureChoice, RADIUS, SPACE, TYPE } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { type ReactNode, useMemo, useState } from "react";
import { Button, Caption, Group, useSurface } from "../../../shared/cards/index.ts";
import type { PhotoChooser } from "../../../wallpaper/chooser.ts";
import { isVideoPath } from "../../../wallpaper/live/choice.ts";
import { chosenRef, type LiveTile, patchFor, shaderTiles, videoTiles, withVideo } from "../../../wallpaper/live/tiles.ts";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Setting } from "../setting.tsx";
import { Failure } from "./parts.tsx";

/** A wallpaper's tile: its picture 148 × 83 at radius 5, in a grid 12 apart, 14 in from its card. */
const TILE = { width: 148, height: 83, gap: SPACE.inset, inset: SPACE.button } as const;

/**
 * What Wallpaper and its Live section say when the desktop's file chooser
 * doesn't answer (SE-A30): never a typed path; the one thing to do.
 */
export const NO_CHOOSER = "The file chooser isn't running. Log out and in again to start it, then try again.";

/** A wallpaper to pick: its picture (or a play mark while a video has none yet), its name under it, the one ring when chosen (CO-9). */
export function WallpaperTile({
  testID,
  title,
  image,
  selected,
  onPress,
}: {
  testID: string;
  title: string;
  image: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <PictureChoice testID={testID} label={title} caption={title} chosen={selected} radius={RADIUS.row} width={TILE.width + 2 * SPACE.s} onPress={onPress}>
      <View
        style={{
          width: TILE.width,
          height: TILE.height,
          borderRadius: RADIUS.row,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: surface.field,
        }}
      >
        {image !== null ? (
          <Image source={image} resizeMode="cover" style={{ width: TILE.width, height: TILE.height }} />
        ) : (
          <Text style={{ fontSize: TYPE.title.size, color: colors.textMuted }}>▶</Text>
        )}
      </View>
    </PictureChoice>
  );
}

/** Wallpapers as one Tab stop, entered at the chosen tile; the arrows move between tiles, Space or Return picks one (KB-1). */
export function TileGrid({ children }: { children: ReactNode }) {
  return (
    <View focusGroup accessibilityRole="listbox" style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE.gap, padding: TILE.inset }}>
      {children}
    </View>
  );
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The saved videos that are still there. They are looked up when the list changes, not on every draw (a look at the disk each). */
export function useVideoTiles(videos: readonly string[], exists: (path: string) => boolean = isFile): LiveTile[] {
  const saved = videos.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is the key; `exists` is read when it changes
  return useMemo(() => videoTiles(saved === "" ? [] : saved.split("\n"), exists), [saved]);
}

/** Why `typed` cannot be a video wallpaper, or null when it can. */
export function videoProblem(typed: string, exists: (path: string) => boolean = isFile): string | null {
  const path = typed.trim();
  if (path === "") return "Type the full path of a video.";
  if (!path.startsWith("/")) return "The path must start with /.";
  if (!isVideoPath(path)) return "Only MP4, WebM, MKV, and MOV videos can be used.";
  return exists(path) ? null : "There is no such file.";
}

export function LiveSection({ settings, chooser }: { settings: SettingsStore; chooser: PhotoChooser }) {
  const _colors = useColors();
  const { wallpaper } = useSettings(settings).data;
  const chosen = chosenRef(wallpaper);
  const videos = wallpaper.videos ?? [];
  const clips = useVideoTiles(videos);
  const [note, setNote] = useState<string | null>(null);

  const choose = (ref: string) => {
    const patch = patchFor(ref);
    if (patch) settings.patch("wallpaper", patch);
  };
  const adopt = (path: string): boolean => {
    const problem = videoProblem(path);
    setNote(problem);
    if (problem !== null) return false;
    settings.patch("wallpaper", { videos: withVideo(videos, path.trim()), video: path.trim(), kind: "video" });
    return true;
  };
  const addVideo = () => {
    setNote(null);
    chooser
      .choose("video")
      .then((path) => {
        if (path !== null) adopt(path);
      })
      .catch(() => setNote(NO_CHOOSER));
  };

  const shaders = shaderTiles();
  const grid = (tiles: LiveTile[], testID: string) => (
    <Group testID={testID}>
      <TileGrid>
        {tiles.map((tile) => (
          <WallpaperTile
            key={tile.ref}
            testID={`live:${tile.ref}`}
            title={tile.title}
            image={tile.image}
            selected={tile.ref === chosen}
            onPress={() => choose(tile.ref)}
          />
        ))}
      </TileGrid>
    </Group>
  );

  return (
    <>
      <Caption above>Live</Caption>
      {grid(shaders, "live-shaders")}
      {clips.length > 0 && (
        <>
          <Caption above>Videos</Caption>
          {grid(clips, "live-videos")}
        </>
      )}
      <Group>
        <Setting id="wallpaper/add-video">
          <Button testID="live-add-video" label="Add video…" onPress={addVideo} />
        </Setting>
        <Setting id="wallpaper/pause-on-battery" control="live-pause-battery" />
        <Setting id="wallpaper/frame-rate" stack={false} control="live-fps" />
      </Group>
      {note !== null && <Failure testID="live-note">{note}</Failure>}
    </>
  );
}
