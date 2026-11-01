/**
 * The picture area: the picture centred at the chosen scale, dragged to pan
 * when it is larger than the area. Metal has no way to set a scroll offset,
 * no wheel event on a plain view, and no transforms, so the pan and the
 * position are ours: the picture sits in an absolutely placed box inside a
 * clipped one, and a press-and-drag on the area (`onPointer`) moves it.
 */

import { Image, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { darkColors, useColors } from "@dashi/ui";
import type { Size } from "./dimensions.ts";
import { clampPan, type Pan, placement, scaled } from "./zoom.ts";

export interface CanvasProps {
  picture: { source: string; width: number; height: number };
  scale: number;
  pan: Pan;
  onPan: (pan: Pan) => void;
  onArea: (area: Size) => void;
  area: Size;
}

/** The ground behind the picture: a quiet neutral either side of Dark Mode. */
export function useCanvasColor(): string {
  return useColors() === darkColors ? "#161618" : "#e4e4e8";
}

/**
 * While a PDF page is drawn again at a new resolution the old render stays
 * under the new one for a moment, so the page does not blink out.
 */
function useUnderlay(source: string, width: number, height: number): string | null {
  const last = useRef({ source, width, height });
  const [under, setUnder] = useState<string | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = { source, width, height };
    if (before.source === source) return;
    // The same page (same size in points, give or take a pixel of rounding) at another resolution.
    if (Math.abs(before.width - width) < 1.5 && Math.abs(before.height - height) < 1.5) {
      setUnder(before.source);
      const timer = setTimeout(() => setUnder(null), 450);
      return () => clearTimeout(timer);
    }
    setUnder(null);
    return undefined;
  }, [source, width, height]);
  return under;
}

export function Canvas({ picture, scale, pan, onPan, onArea, area }: CanvasProps) {
  const ground = useCanvasColor();
  const shown = scaled(picture, scale);
  const { left, top } = placement(shown, area, pan);
  const drag = useRef<{ x: number; y: number; pan: Pan } | null>(null);
  const under = useUnderlay(picture.source, picture.width, picture.height);
  const box = { position: "absolute", left, top, width: shown.width, height: shown.height } as const;
  return (
    <View
      testID="canvas"
      onLayout={(bounds) => onArea({ width: bounds.width, height: bounds.height })}
      onPointer={(event) => {
        if (event.phase === "down") {
          drag.current = { x: event.x, y: event.y, pan };
        } else if (event.phase === "move" && drag.current) {
          const start = drag.current;
          onPan(clampPan({ x: start.pan.x + event.x - start.x, y: start.pan.y + event.y - start.y }, shown, area));
        } else if (event.phase === "up") {
          drag.current = null;
        }
      }}
      style={{ flex: 1, position: "relative", overflow: "hidden", backgroundColor: ground }}
    >
      {under !== null && (
        <View style={box}>
          <Image source={under} resizeMode="contain" style={{ width: shown.width, height: shown.height }} />
        </View>
      )}
      <View style={box}>
        <Image source={picture.source} resizeMode="contain" style={{ width: shown.width, height: shown.height }} />
      </View>
    </View>
  );
}
