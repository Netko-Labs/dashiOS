/**
 * The picture area: the picture centred at the chosen scale; when it is
 * larger than the area, the wheel and the touchpad move it, and so does a
 * press-and-drag. Metal has no way to set a scroll offset and no transforms,
 * so the pan and the position are ours: the picture sits in an absolutely
 * placed box inside a clipped one.
 */

import { Image, View } from "@mirinjs/metal";
import { useRef } from "react";
import type { Size } from "./dimensions.ts";
import { LINE_PX } from "./document.ts";
import { clampPan, type Pan, placement, scaled } from "./zoom.ts";

export interface CanvasProps {
  picture: { source: string; width: number; height: number };
  scale: number;
  pan: Pan;
  onPan: (pan: Pan) => void;
  onArea: (area: Size) => void;
  area: Size;
  /** The ground behind the picture (`surface.canvas`). */
  ground: string;
}

export function Canvas({ picture, scale, pan, onPan, onArea, area, ground }: CanvasProps) {
  const shown = scaled(picture, scale);
  const { left, top } = placement(shown, area, pan);
  const drag = useRef<{ x: number; y: number; pan: Pan } | null>(null);
  return (
    <View
      testID="canvas"
      onLayout={(bounds) => onArea({ width: bounds.width, height: bounds.height })}
      // Positive dy is toward the top: the picture comes down.
      onWheel={(wheel) => onPan(clampPan({ x: pan.x + wheel.dx * LINE_PX, y: pan.y + wheel.dy * LINE_PX }, shown, area))}
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
      <View style={{ position: "absolute", left, top, width: shown.width, height: shown.height }}>
        <Image source={picture.source} resizeMode="contain" style={{ width: shown.width, height: shown.height }} />
      </View>
    </View>
  );
}
