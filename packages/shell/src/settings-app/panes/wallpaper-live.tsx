/**
 * The Wallpaper pane's Live section: Dashi's own animated wallpapers,
 * Wallpaper Engine's items from Steam, and videos the person adds, then
 * "Pause on battery" and the frame rate. Choosing one writes `kind` and its
 * item to `appearance.wallpaper`; the shell starts it (wallpaper/live/).
 */

import { Image, Text, TextInput, View } from "@mirinjs/metal";
import { statSync } from "node:fs";
import { useState } from "react";
import { useColors } from "@dashi/ui";
import { Switch } from "../../wifi/switch.tsx";
import type { PhotoChooser } from "../../wallpaper/chooser.ts";
import { FRAME_RATES, isVideoPath } from "../../wallpaper/live/choice.ts";
import {
  chosenRef,
  engineHint,
  engineTiles,
  type LiveScan,
  type LiveTile,
  patchFor,
  shaderTiles,
  videoTiles,
  withVideo,
} from "../../wallpaper/live/tiles.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Row, useSurface } from "../ui.tsx";

const TILE = { width: 148, height: 83 };

function LiveTileView({ tile, selected, onPress }: { tile: LiveTile; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const surface = useSurface();
  const blocked = tile.problem !== null;
  return (
    <View
      testID={`live:${tile.ref}`}
      onPress={blocked ? undefined : onPress}
      style={{ flexDirection: "column", alignItems: "center", gap: 5, width: TILE.width + 8, opacity: blocked ? 0.5 : 1 }}
    >
      <View style={{ padding: 2, borderRadius: 9, borderWidth: 2, borderColor: selected ? colors.selection : "#00000000" }}>
        <View style={{ width: TILE.width, height: TILE.height, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: surface.field }}>
          {tile.image !== null ? (
            <Image source={tile.image} resizeMode="cover" style={{ width: TILE.width, height: TILE.height }} />
          ) : (
            <Text style={{ fontSize: 22, color: colors.textMuted }}>▶</Text>
          )}
        </View>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: selected ? "semibold" : "normal", color: colors.text }}>
        {tile.title}
      </Text>
      {tile.problem !== null && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {tile.problem}
        </Text>
      )}
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

/** Why `typed` cannot be a video wallpaper, or null when it can. */
export function videoProblem(typed: string, exists: (path: string) => boolean = isFile): string | null {
  const path = typed.trim();
  if (path === "") return "Type the full path of a video.";
  if (!path.startsWith("/")) return "The path must start with /.";
  if (!isVideoPath(path)) return "Only MP4, WebM, MKV, and MOV videos can be used.";
  return exists(path) ? null : "There is no such file.";
}

export function LiveSection({ settings, chooser, scan }: { settings: SettingsStore; chooser: PhotoChooser; scan: LiveScan }) {
  const colors = useColors();
  const surface = useSurface();
  const { wallpaper } = useSettings(settings).data;
  const chosen = chosenRef(wallpaper);
  const videos = wallpaper.videos ?? [];
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
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
      .catch(() => {
        setTyping(true);
        setNote("There is no file chooser here. Type the path of a video instead.");
      });
  };

  const shaders = shaderTiles();
  const engine = engineTiles(scan);
  const clips = videoTiles(videos, isFile, scan.hasRenderer);
  const hint = engineHint(scan);
  const grid = (tiles: LiveTile[], testID: string) => (
    <Group testID={testID}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 14 }}>
        {tiles.map((tile) => (
          <LiveTileView key={tile.ref} tile={tile} selected={tile.ref === chosen} onPress={() => choose(tile.ref)} />
        ))}
      </View>
    </Group>
  );

  return (
    <>
      <Caption above>Live</Caption>
      {grid(shaders, "live-shaders")}
      {engine.length > 0 && (
        <>
          <Caption above>Wallpaper Engine</Caption>
          {grid(engine, "live-engine")}
        </>
      )}
      {hint !== null && <Caption>{hint}</Caption>}
      {clips.length > 0 && (
        <>
          <Caption above>Videos</Caption>
          {grid(clips, "live-videos")}
        </>
      )}
      <Group>
        <Row label="Add Video…" detail="An MP4 or WebM from your files; it plays muted, in a loop, and stays where it is.">
          <Button testID="live-add-video" label="Add Video…" onPress={addVideo} />
        </Row>
        {typing && (
          <Row stack label="Path of a video" detail="Press Return to use it.">
            <TextInput
              testID="live-video-path"
              value={typed}
              placeholder="/home/you/Videos/loop.mp4"
              autoFocus
              onChangeText={setTyped}
              onSubmitEditing={(text) => {
                if (adopt(text)) setTyped("");
              }}
              style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
            />
          </Row>
        )}
        <Row label="Pause on battery" detail="Live wallpapers also stop while a window covers the screen, and while the screen is locked or off.">
          <Switch testID="live-pause-battery" on={wallpaper.pauseOnBattery ?? true} onChange={(pauseOnBattery) => settings.patch("wallpaper", { pauseOnBattery })} />
        </Row>
        <Row stack label="Frame rate" detail="Higher is smoother and uses more power.">
          <Choices
            testID="live-fps"
            value={wallpaper.fps ?? 30}
            options={FRAME_RATES.map((rate) => ({ value: rate, label: `${rate} fps` }))}
            onChange={(fps) => settings.patch("wallpaper", { fps })}
          />
        </Row>
      </Group>
      {note !== null && (
        <View testID="live-note" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, color: colors.critical }}>{note}</Text>
        </View>
      )}
    </>
  );
}
