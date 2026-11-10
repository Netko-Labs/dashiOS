/**
 * ⇧❖4: drag out an area of the screen to capture, as on macOS. A clear
 * overlay covers the screen; dragging draws the selection with its size,
 * and letting go captures that area (screenshots.ts, IPC `capture` with a
 * `rect`). Space captures the focused window instead; Esc, or a click
 * without a drag, cancels. The overlay closes before the capture, so it
 * isn't in the picture.
 */

import { type NativeHostOptions, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { parseScreens } from "./displays.ts";
import { choosePrimary } from "./menubars.ts";
import type { OpenOverlay } from "./overlay.tsx";

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
      style={{ flex: 1, backgroundColor: "#00000001" }}
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
      {/* Keys reach Metal only through a focused text input. */}
      <View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
        <TextInput
          value=""
          autoFocus
          onChangeText={(text) => {
            if (text.includes(" ")) onDone({ kind: "window" });
          }}
          onKeyPress={(key) => {
            if (key === "Escape") onDone({ kind: "cancel" });
          }}
          style={{ width: 1, height: 1, backgroundColor: "#00000000" }}
        />
      </View>
      {selection ? (
        <View
          style={{
            position: "absolute",
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            backgroundColor: "#ffffff26",
            borderWidth: 1,
            borderColor: "#ffffffd9",
          }}
        />
      ) : null}
      {selection ? (
        <View
          style={{
            position: "absolute",
            left: selection.x + selection.width + 6,
            top: selection.y + selection.height + 6,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 4,
            backgroundColor: "#000000a6",
          }}
        >
          <Text style={{ fontSize: 11, color: "#ffffff" }}>{`${selection.width} × ${selection.height}`}</Text>
        </View>
      ) : null}
    </View>
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
export function chooseCaptureScreen(answer: unknown, options: { near?: Area | null; prefer?: string | null } = {}): CaptureScreen {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  const screens = (Array.isArray(outputs) ? outputs : []).flatMap((each: unknown): Array<{ name: string; frame: Area }> => {
    if (typeof each !== "object" || each === null) return [];
    const { name, frame } = each as { name?: unknown; frame?: unknown };
    if (typeof name !== "string" || typeof frame !== "object" || frame === null) return [];
    const { x, y, width, height } = frame as Record<string, unknown>;
    return [x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))
      ? [{ name, frame: { x, y, width, height } as Area }]
      : [];
  });
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

/** The screen a capture goes on: the one holding `near` (its window's frame), else the primary. */
export function captureScreenNear(answer: unknown, near: Area | null): CaptureScreen {
  return chooseCaptureScreen(answer, { near, prefer: choosePrimary(parseScreens(answer).map((screen) => screen.name)) });
}
