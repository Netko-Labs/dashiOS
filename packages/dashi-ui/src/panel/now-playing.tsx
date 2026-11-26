/**
 * Control Center's Now Playing tile (design.html CC-7, decisions.md D765): a pill `GLASS.nowPlaying.height`
 * tall on a fill, the sleeve a disc (the cover, content: never the accent; a neutral disc with a note
 * when there is none), the title over the artist and the player, Pause or Play and Next in ink. A press
 * on the tile opens the player; its two buttons work in place. It is a reading and a remote, never "on".
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { GlyphButton } from "../glyph-button.tsx";
import { Picture } from "../picture.tsx";
import { GLASS, OPACITY, pill, SPACE, TYPE, WEIGHT } from "../theme/index.ts";
import { useControlColors } from "./colors.ts";

/** Its measures: the pill's height and the sleeve's disc (GLASS.nowPlaying), the note on an empty sleeve. */
export const NOW_PLAYING = { ...GLASS.nowPlaying, note: 18 } as const;

/** What it shows: the track, who and where from, whether it plays, and the cover's file (none: a disc). */
export interface NowPlayingLook {
  testID: string;
  title: string;
  /** "Harbour Lights · Helium": the artist and the player. */
  detail: string;
  playing: boolean;
  /** The cover as a local file; null without one. */
  cover: string | null;
}

export interface NowPlayingGlyphs {
  play: string;
  pause: string;
  next: string;
  /** The empty sleeve's mark. */
  note: string;
}

export function NowPlayingTile({
  look,
  glyphs,
  onOpen,
  onPlayPause,
  onNext,
}: {
  look: NowPlayingLook;
  glyphs: NowPlayingGlyphs;
  onOpen: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}) {
  const colors = useControlColors();
  const sleeve = { width: NOW_PLAYING.sleeve, height: NOW_PLAYING.sleeve, borderRadius: pill(NOW_PLAYING.sleeve) } as const;
  const empty = (
    <View style={{ ...sleeve, alignItems: "center", justifyContent: "center", backgroundColor: colors.knobOff }}>
      <Svg markup={glyphs.note} size={NOW_PLAYING.note} color={colors.offInk} />
    </View>
  );
  return (
    <View
      testID={look.testID}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${look.title}, ${look.detail}`}
      style={{
        flex: 1,
        height: NOW_PLAYING.height,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        paddingLeft: SPACE.xs + SPACE.xxs,
        paddingRight: SPACE.s,
        borderRadius: pill(NOW_PLAYING.height),
        backgroundColor: colors.off,
      }}
    >
      {look.cover ? <Picture source={look.cover} style={sleeve} fallback={empty} /> : empty}
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>
          {look.title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.offInk, opacity: OPACITY.soft }}>
          {look.detail}
        </Text>
      </View>
      <GlyphButton
        testID={`${look.testID}-play`}
        glyph={look.playing ? glyphs.pause : glyphs.play}
        label={look.playing ? "Pause" : "Play"}
        size="large"
        onPress={onPlayPause}
      />
      <GlyphButton testID={`${look.testID}-next`} glyph={glyphs.next} label="Next" size="large" onPress={onNext} />
    </View>
  );
}
