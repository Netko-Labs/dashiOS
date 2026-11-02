/** Screenshots: the first one large, the others as a strip of thumbnails; a click on a thumbnail shows that one large. */

import { Image, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Screenshot } from "../../src/software/flathub-types.ts";
import { useColors, useSurface } from "@dashi/ui";
import { useImage } from "./hooks.ts";

const BIG_HEIGHT = 320;

function Big({ shot }: { shot: Screenshot }) {
  const colors = useColors();
  const surface = useSurface();
  const [width, setWidth] = useState(600);
  const file = useImage(shot.large);
  return (
    <View
      testID="shot-big"
      onLayout={(bounds) => setWidth(Math.max(200, Math.floor(bounds.width)))}
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
      {file ? (
        <Image source={file} resizeMode="contain" style={{ width: Math.max(width - 2, 100), height: BIG_HEIGHT - 2 }} />
      ) : (
        <Text style={{ fontSize: 12, color: colors.textDisabled }}>Loading…</Text>
      )}
    </View>
  );
}

function Thumb({ shot, chosen, onPress, index }: { shot: Screenshot; chosen: boolean; onPress: () => void; index: number }) {
  const colors = useColors();
  const surface = useSurface();
  const file = useImage(shot.thumb);
  return (
    <View
      testID={`shot:${index}`}
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
        borderWidth: chosen ? 2 : 1,
        borderColor: chosen ? colors.selection : colors.separator,
      }}
    >
      {file && <Image source={file} resizeMode="contain" style={{ width: 114, height: 70 }} />}
    </View>
  );
}

export function Gallery({ shots }: { shots: readonly Screenshot[] }) {
  const [index, setIndex] = useState(0);
  const colors = useColors();
  const shot = shots[Math.min(index, shots.length - 1)];
  if (!shot) return null;
  return (
    <View testID="gallery" style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      <Big shot={shot} />
      {shot.caption !== null && <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>{shot.caption}</Text>}
      {shots.length > 1 && (
        <View style={{ flexDirection: "row", gap: 8, overflow: "scroll-x", flexShrink: 0 }}>
          {shots.map((each, i) => (
            <Thumb key={each.large} shot={each} chosen={i === index} index={i} onPress={() => setIndex(i)} />
          ))}
        </View>
      )}
    </View>
  );
}
