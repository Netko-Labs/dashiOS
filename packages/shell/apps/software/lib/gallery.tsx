/**
 * Screenshots, for an app or an applet alike: the chosen one large (a click
 * shows it at the window's full size), the others as a strip of thumbnails.
 * The strip is one Tab stop and the arrow keys move through it, the large
 * one following; a thumbnail under the pointer lightens. The thumbnails are
 * a list to pick one from (options in a listbox): the chosen one wears the
 * accent's edge, as a chosen thing does. A picture on its way is a spinner,
 * not a word.
 */

import { MEDIA_SCRIM, RADIUS, SPACE, Spinner, TYPE, useColors, useSurface } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { useImage } from "./hooks.ts";
import { useActions } from "./parts.tsx";

const BIG_HEIGHT = 320;
/** A thumbnail in the strip. */
const THUMB = { width: 120, height: 76 } as const;

export interface Shot {
  caption: string | null;
  thumb: string;
  large: string;
}

type Source = "flathub" | "applets";

function Big({ shot, source }: { shot: Shot; source: Source }) {
  const colors = useColors();
  const surface = useSurface();
  const actions = useActions();
  const [width, setWidth] = useState(600);
  const file = useImage(shot.large, source);
  // The press is the picture's whole area; its frame is drawn inside.
  return (
    <View
      testID="shot-big"
      onLayout={(bounds) => setWidth(Math.max(200, Math.floor(bounds.width)))}
      {...(file ? { onPress: () => actions.showPicture(file), accessibilityRole: "button" as const, accessibilityLabel: "Show full size" } : {})}
      style={{ height: BIG_HEIGHT, flexShrink: 0 }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: RADIUS.card,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: surface.field,
          borderWidth: 1,
          borderColor: colors.separator,
        }}
      >
        {file ? <Image source={file} resizeMode="contain" style={{ width: Math.max(width - 2, 100), height: BIG_HEIGHT - 2 }} /> : <Spinner />}
      </View>
    </View>
  );
}

function Thumb({ shot, chosen, onPress, index, source }: { shot: Shot; chosen: boolean; onPress: () => void; index: number; source: Source }) {
  const colors = useColors();
  const surface = useSurface();
  const file = useImage(shot.thumb, source);
  return (
    // The focusable view doesn't clip, so its ring (drawn just outside it) shows; the picture is clipped inside.
    <View
      testID={`shot:${index}`}
      focusable
      accessibilityRole="option"
      accessibilityLabel={shot.caption ?? `Screenshot ${index + 1}`}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      style={{ width: THUMB.width, height: THUMB.height, flexShrink: 0, borderRadius: RADIUS.control }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: RADIUS.control,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: surface.field,
          hoverBackgroundColor: colors.tileHover,
          borderWidth: chosen ? 2 : 1,
          borderColor: chosen ? colors.selection : colors.separator,
        }}
      >
        {file && <Image source={file} resizeMode="contain" style={{ width: THUMB.width - 6, height: THUMB.height - 6 }} />}
      </View>
    </View>
  );
}

/** Room around the thumbnails for the focus ring (2 px out, 2 px wide), which the scrolling strip would clip; given back at the sides only. */
const RING_ROOM = SPACE.xs;

export function Gallery({ shots, source = "flathub" }: { shots: readonly Shot[]; source?: Source }) {
  const [index, setIndex] = useState(0);
  const colors = useColors();
  const shot = shots[Math.min(index, shots.length - 1)];
  if (!shot) return null;
  return (
    <View testID="gallery" style={{ flexShrink: 0, flexDirection: "column", gap: SPACE.m }}>
      <Big shot={shot} source={source} />
      {/* One line: a wrapping caption here is measured far taller than it draws (mirin), which pushed About down. */}
      {shot.caption !== null && (
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted, textAlign: "center" }}>
          {shot.caption}
        </Text>
      )}
      {shots.length > 1 && (
        <View
          focusGroup
          selectsOnFocus
          accessibilityRole="listbox"
          style={{
            flexDirection: "row",
            gap: SPACE.m,
            overflow: "scroll-x",
            flexShrink: 0,
            padding: RING_ROOM,
            marginLeft: -RING_ROOM,
            marginRight: -RING_ROOM,
          }}
        >
          {shots.map((each, i) => (
            <Thumb key={each.large} shot={each} chosen={i === index} index={i} source={source} onPress={() => setIndex(i)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** A screenshot at the window's full size, over everything; a click or Esc puts it back. */
export function PictureView({ file, onClose }: { file: string; onClose: () => void }) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  return (
    <View testID="picture:scrim" occlude style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: MEDIA_SCRIM }}>
      {/* The press covers the whole scrim; the scrim itself is only its ground. */}
      <View
        testID="picture"
        onPress={onClose}
        onLayout={(bounds) => setSize({ width: Math.max(100, Math.floor(bounds.width)), height: Math.max(100, Math.floor(bounds.height)) })}
        accessibilityRole="button"
        accessibilityLabel="Close the picture"
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <Image source={file} resizeMode="contain" style={{ width: size.width - 2 * SPACE.xl, height: size.height - 2 * SPACE.xl }} />
      </View>
    </View>
  );
}
