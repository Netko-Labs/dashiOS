/**
 * Screenshots, for an app or an applet alike: the chosen one large (a click
 * shows it at the window's full size), the others as a strip of thumbnails.
 * The strip is one Tab stop and the arrow keys move through it, the large
 * one following; a thumbnail under the pointer lightens. A picture on its
 * way is a spinner, not a word.
 */

import { Spinner, useColors, useSurface } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { useImage } from "./hooks.ts";
import { useActions } from "./parts.tsx";

const BIG_HEIGHT = 320;

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
  return (
    <View
      testID="shot-big"
      onLayout={(bounds) => setWidth(Math.max(200, Math.floor(bounds.width)))}
      {...(file ? { onPress: () => actions.showPicture(file), accessibilityRole: "button" as const, accessibilityLabel: "Show full size" } : {})}
      style={{
        height: BIG_HEIGHT,
        flexShrink: 0,
        borderRadius: 10,
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
  );
}

function Thumb({ shot, chosen, onPress, index, source }: { shot: Shot; chosen: boolean; onPress: () => void; index: number; source: Source }) {
  const colors = useColors();
  const surface = useSurface();
  const file = useImage(shot.thumb, source);
  return (
    <View
      testID={`shot:${index}`}
      focusable
      accessibilityRole="tab"
      accessibilityLabel={shot.caption ?? `Screenshot ${index + 1}`}
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      style={{
        width: 120,
        height: 76,
        flexShrink: 0,
        borderRadius: 8,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: surface.field,
        hoverBackgroundColor: colors.tileHover,
        borderWidth: chosen ? 2 : 1,
        borderColor: chosen ? colors.selection : colors.separator,
      }}
    >
      {file && <Image source={file} resizeMode="contain" style={{ width: 114, height: 70 }} />}
    </View>
  );
}

export function Gallery({ shots, source = "flathub" }: { shots: readonly Shot[]; source?: Source }) {
  const [index, setIndex] = useState(0);
  const colors = useColors();
  const shot = shots[Math.min(index, shots.length - 1)];
  if (!shot) return null;
  return (
    <View testID="gallery" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      <Big shot={shot} source={source} />
      {shot.caption !== null && <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>{shot.caption}</Text>}
      {shots.length > 1 && (
        <View focusGroup selectsOnFocus accessibilityRole="tablist" style={{ flexDirection: "row", gap: 8, overflow: "scroll-x", flexShrink: 0 }}>
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
    <View
      testID="picture"
      occlude
      onPress={onClose}
      onLayout={(bounds) => setSize({ width: Math.max(100, Math.floor(bounds.width)), height: Math.max(100, Math.floor(bounds.height)) })}
      accessibilityRole="button"
      accessibilityLabel="Close the picture"
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#000000cc" }}
    >
      <Image source={file} resizeMode="contain" style={{ width: size.width - 48, height: size.height - 48 }} />
    </View>
  );
}
