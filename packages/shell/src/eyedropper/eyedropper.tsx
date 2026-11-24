/**
 * The eyedropper (Settings › Appearance › Custom…; the accent's design): a
 * clear overlay over one screen with a line that says what to do; a click
 * picks the pixel under the pointer, Esc cancels. The overlay closes first,
 * then the compositor captures that one point (IPC `capture` with a 1 × 1
 * `rect`, a PNG in the runtime folder) and ImageMagick reads its colour.
 * Nothing is kept: the file is removed as soon as it is read.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { CAPTURE_AREA, CLEAR, HIT_AREA, RADIUS, SPACE, TYPE } from "@dashi/ui";
import { type NativeHostOptions, Text, View } from "@mirinjs/metal";
import { KeyCatcher, type OpenOverlay } from "../overlay.tsx";

export interface Point {
  x: number;
  y: number;
}

const SURFACE: NonNullable<NativeHostOptions["surface"]> = {
  layer: "overlay",
  anchor: ["top", "bottom", "left", "right"],
  exclusiveZone: -1,
  keyboard: "exclusive",
  namespace: "dashi.eyedropper",
};

/** The compositor needs about a frame to stop drawing a surface whose client exited. */
const SETTLE_MS = 60;

function Dropper({ onDone }: { onDone: (at: Point | null) => void }) {
  return (
    <View
      style={{ flex: 1, alignItems: "center", backgroundColor: HIT_AREA }}
      onPointer={(event) => {
        if (event.phase === "up") onDone({ x: event.x, y: event.y });
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onDone(null)} />
      <View
        style={{
          marginTop: 48,
          paddingLeft: SPACE.inset,
          paddingRight: SPACE.inset,
          paddingTop: SPACE.s,
          paddingBottom: SPACE.s,
          borderRadius: RADIUS.sheet,
          backgroundColor: CAPTURE_AREA.labelGround,
        }}
      >
        <Text style={{ fontSize: TYPE.body.size, color: CAPTURE_AREA.labelInk }}>Click a colour to use it. Esc cancels.</Text>
      </View>
    </View>
  );
}

export interface EyedropperDeps {
  open: OpenOverlay;
  /** The screen to cover: its name and where its corner is. */
  screen(): Promise<{ output?: string; origin: Point }>;
  /** Save a 1 × 1 capture of the global point to `path`. */
  capture(path: string, at: Point): Promise<unknown>;
  /** The packed RGB of a picture file; null when it cannot be read. */
  read(path: string): Promise<Uint8Array | null>;
  /** Where the capture is written (the runtime folder). */
  dir: string;
}

const hex2 = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, "0");

/** One colour from the screen as `#RRGGBB`, or null when cancelled or unreadable. A second call while one is open gives null. */
export function eyedropper(deps: EyedropperDeps): () => Promise<string | null> {
  let busy = false;
  return async () => {
    if (busy) return null;
    busy = true;
    try {
      const screen = await deps.screen();
      const chosen: { at: Point | null } = { at: null };
      let closed: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const overlay = deps.open(
        { title: "Eyedropper", width: 1, height: 1, surface: { ...SURFACE, ...(screen.output === undefined ? {} : { output: screen.output }) } },
        <Dropper
          onDone={(point) => {
            chosen.at = point;
            overlay.close();
          }}
        />,
        () => closed(),
      );
      await done;
      await overlay.exited;
      const point = chosen.at;
      if (point === null) return null;
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      const path = join(deps.dir, `dashi-eyedropper-${process.pid}.png`);
      try {
        await deps.capture(path, { x: Math.round(point.x + screen.origin.x), y: Math.round(point.y + screen.origin.y) });
        const rgb = await deps.read(path);
        return rgb && rgb.length >= 3 ? `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`.toUpperCase() : null;
      } finally {
        rmSync(path, { force: true });
      }
    } catch (error) {
      console.error("dashi-shell: the eyedropper picked nothing:", error);
      return null;
    } finally {
      busy = false;
    }
  };
}
