/**
 * ⇧❖4: drag out an area of the screen to capture, as on macOS. A clear
 * overlay covers the screen; dragging draws the selection with its size,
 * and letting go captures that area (screenshots.ts, IPC `capture` with a
 * `rect`). Space captures the focused window instead; Esc, or a click
 * without a drag, cancels. The overlay closes before the capture, so it
 * isn't in the picture. Nothing here is glass (GL-6): a capture shows what it
 * takes, so outside the area is a black wash, inside it is clear, and its
 * size and keys sit on solid chips (frost-objects 26; decisions.md D815).
 */

import { CAPTURE_AREA, HIT_AREA, KeySink, RADIUS, SPACE, TYPE } from "@dashi/ui";
import { type NativeHostOptions, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Output } from "../compositor/index.ts";
import { screensOf } from "../displays.ts";
import { choosePrimary } from "../menubar/menubars.ts";
import type { OpenOverlay } from "../overlay.tsx";

export interface Point {
  x: number;
  y: number;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A drag shorter than this either way is a click, not an area. */
export const MIN_DRAG = 4;

/** The area between two corners, in whole pixels; null for a click. */
export function areaBetween(start: Point, end: Point): Area | null {
  const x = Math.round(Math.min(start.x, end.x));
  const y = Math.round(Math.min(start.y, end.y));
  const width = Math.round(Math.max(start.x, end.x)) - x;
  const height = Math.round(Math.max(start.y, end.y)) - y;
  return width < MIN_DRAG || height < MIN_DRAG ? null : { x, y, width, height };
}

const SURFACE: NonNullable<NativeHostOptions["surface"]> = {
  layer: "overlay",
  anchor: ["top", "bottom", "left", "right"],
  // Over the menu bar and the Dock: the whole screen is fair game.
  exclusiveZone: -1,
  keyboard: "exclusive",
  namespace: "dashi.screenshot",
};

export type Choice = { kind: "area"; area: Area } | { kind: "window" } | { kind: "cancel" };

function Selector({ onDone }: { onDone: (choice: Choice) => void }) {
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const selection = start && end ? areaBetween(start, end) : null;
  return (
    <View
      style={{ flex: 1, backgroundColor: HIT_AREA }}
      onPointer={(event) => {
        const at = { x: event.x, y: event.y };
        if (event.phase === "down") {
          setStart(at);
          setEnd(at);
        } else if (event.phase === "move") {
          if (start) setEnd(at);
        } else {
          const area = start ? areaBetween(start, at) : null;
          onDone(area ? { kind: "area", area } : { kind: "cancel" });
        }
      }}
    >
      {/* The window's keys (the kit's KeySink): Space takes the focused window instead, Esc cancels. */}
      <KeySink
        testID="screenshot-area-keys"
        onKey={(key) => {
          if (key.kind === "text" && key.text === " ") onDone({ kind: "window" });
          else if (key.kind === "escape") onDone({ kind: "cancel" });
        }}
      />
      {selection ? <Selection area={selection} /> : null}
    </View>
  );
}

/** The wash's four bands round `area`: above, below, and either side of it. */
export function washAround(area: Area): Array<{ key: string; left: number; top: number; width?: number; height?: number; right?: number; bottom?: number }> {
  return [
    { key: "above", left: 0, right: 0, top: 0, height: area.y },
    { key: "below", left: 0, right: 0, top: area.y + area.height, bottom: 0 },
    { key: "left", left: 0, top: area.y, width: area.x, height: area.height },
    { key: "right", left: area.x + area.width, right: 0, top: area.y, height: area.height },
  ];
}

/** Words by the area on a solid ground (never glass, GL-6). */
function AreaWords({ words }: { words: string }) {
  return (
    <View
      style={{
        paddingLeft: SPACE.s,
        paddingRight: SPACE.s,
        paddingTop: SPACE.xxs,
        paddingBottom: SPACE.xxs,
        borderRadius: RADIUS.check,
        backgroundColor: CAPTURE_AREA.labelGround,
      }}
    >
      <Text style={{ fontSize: TYPE.caption.size, color: CAPTURE_AREA.labelInk }}>{words}</Text>
    </View>
  );
}

/** The area being drawn: the wash outside it, its edge, under it its keys at the start and its size at the end. */
function Selection({ area }: { area: Area }) {
  return (
    <>
      {washAround(area).map(({ key, ...band }) => (
        <View key={key} testID={`screenshot-wash:${key}`} style={{ position: "absolute", ...band, backgroundColor: CAPTURE_AREA.outside }} />
      ))}
      <View
        testID="screenshot-selection"
        style={{ position: "absolute", left: area.x, top: area.y, width: area.width, height: area.height, borderWidth: 1, borderColor: CAPTURE_AREA.edge }}
      />
      <View
        style={{
          position: "absolute",
          left: area.x,
          top: area.y + area.height + SPACE.s,
          minWidth: area.width,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: SPACE.s,
        }}
      >
        <AreaWords words="Space: a window · Esc: cancel" />
        <AreaWords words={`${area.width} × ${area.height}`} />
      </View>
    </>
  );
}

/** The screen the selection overlay covers: its name for the surface, and where it sits in the compositor's space. */
export interface CaptureScreen {
  output?: string;
  origin: Point;
}

export interface AreaCaptureDeps {
  open: OpenOverlay;
  /** Which screen to cover, decided before the overlay opens so the surface and the origin agree. */
  screen(): Promise<CaptureScreen>;
  captureArea(area: Area): Promise<unknown>;
  captureWindow(): Promise<unknown>;
  /** After the overlay's host has exited, the compositor still needs a frame without it. */
  settleMs?: number;
}

/** The compositor needs about a frame to stop drawing a surface whose client exited. */
const SETTLE_MS = 60;

export interface AreaCapture {
  /** Starts a selection; a second ⇧❖4 while one is open (or being captured) does nothing. */
  (): void;
  /** Takes the overlay down and captures nothing (the screen locked, or the shell is ending). */
  close(): void;
}

export function areaCapture(deps: AreaCaptureDeps): AreaCapture {
  let busy = false;
  const selection: { overlay: { close(): void } | null; cancelled: boolean } = { overlay: null, cancelled: false };
  const start = (): void => {
    if (busy) return;
    busy = true;
    selection.cancelled = false;
    void select(deps, selection)
      .catch((error) => console.error("dashi-shell: screenshot failed:", error))
      .finally(() => {
        busy = false;
        selection.overlay = null;
      });
  };
  return Object.assign(start, {
    close() {
      selection.cancelled = true;
      selection.overlay?.close();
    },
  });
}

async function select(deps: AreaCaptureDeps, selection: { overlay: { close(): void } | null; cancelled: boolean }): Promise<void> {
  const screen = await deps.screen();
  // Cancelled while the screen was being looked up: no overlay at all.
  if (selection.cancelled) return;
  let choice: Choice = { kind: "cancel" };
  let closed: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const overlay = deps.open(
    {
      title: "Screenshot",
      width: 1,
      height: 1,
      // The screen is named, so the surface and the origin below cannot disagree.
      surface: { ...SURFACE, ...(screen.output === undefined ? {} : { output: screen.output }) },
    },
    <Selector
      onDone={(chosen) => {
        choice = chosen;
        overlay.close();
      }}
    />,
    () => closed(),
  );
  selection.overlay = overlay;
  await done;
  if (selection.cancelled) choice = { kind: "cancel" };
  // The overlay is gone before the capture is asked for, so the frame
  // captured doesn't have it: wait for its host to exit, not just for the
  // close to start.
  await overlay.exited;
  await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? SETTLE_MS));
  await act(choice, screen.origin, deps);
}

async function act(choice: Choice, origin: Point, deps: AreaCaptureDeps): Promise<void> {
  if (choice.kind === "cancel") return;
  if (choice.kind === "window") {
    await deps.captureWindow();
    return;
  }
  await deps.captureArea({ ...choice.area, x: choice.area.x + origin.x, y: choice.area.y + origin.y });
}

/**
 * The screen to select on from the IPC `outputs` answer: the one holding
 * `near` (a window's frame) if given, else the named `prefer` one, else the
 * first. Nothing usable gives no screen: the compositor places the surface
 * and the origin is (0, 0).
 */
export function chooseCaptureScreen(outputs: readonly Output[], options: { near?: Area | null; prefer?: string | null } = {}): CaptureScreen {
  const screens = outputs.flatMap((each): Array<{ name: string; frame: Area }> => (each.frame ? [{ name: each.name, frame: each.frame }] : []));
  const near = options.near;
  const holding =
    near &&
    screens.find(({ frame }) => {
      const cx = near.x + near.width / 2;
      const cy = near.y + near.height / 2;
      return cx >= frame.x && cx < frame.x + frame.width && cy >= frame.y && cy < frame.y + frame.height;
    });
  const chosen = holding || screens.find(({ name }) => name === options.prefer) || screens[0];
  return chosen ? { output: chosen.name, origin: { x: chosen.frame.x, y: chosen.frame.y } } : { origin: { x: 0, y: 0 } };
}

/** The screen a capture goes on: the one holding `near` (the pointer, or a window's frame), else the main display. */
export function captureScreenNear(outputs: readonly Output[], near: Area | null): CaptureScreen {
  const main = outputs.find((each) => each.primary && each.frame)?.name ?? choosePrimary(screensOf(outputs).map((screen) => screen.name));
  return chooseCaptureScreen(outputs, { near, prefer: main });
}
