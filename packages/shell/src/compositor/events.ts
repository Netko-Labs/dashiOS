/**
 * Every event the compositor sends (docs/compositor-ipc.md, "Events"), one
 * shape each, told apart by `event`. Unknown events and events that do not
 * parse are dropped, never thrown.
 */

import { bool, type Infer, int, lenientList, literal, map, maybe, nullable, num, obj, optional, str, tagged, union } from "@dashi/shape";
import { FrameShape, IconShape, PointShape, WindowShape, WindowStateShape } from "./wire.ts";

const LOOSE = { strict: false } as const;
const loose = <F extends Parameters<typeof obj>[0]>(fields: F) => obj(fields, LOOSE);

/** A window id, or null (none, or a shell surface). */
const maybeWindow = nullable(num());

const Placing = map(
  loose({
    id: num(),
    appId: optional(nullable(str())),
    title: optional(nullable(str())),
    width: num(),
    height: num(),
    position: optional(nullable(PointShape)),
    parent: optional(nullable(num())),
  }),
  ({ id, appId, title, width, height, position, parent }) => ({
    id,
    appId: appId ?? "",
    title: title ?? "",
    width,
    height,
    ...(position ? { position: { x: position.x, y: position.y } } : {}),
    ...(parent !== undefined && parent !== null && Number.isInteger(parent) && parent > 0 ? { parent } : {}),
  }),
);
export type Placing = Infer<typeof Placing>;

const Binding = map(
  loose({
    name: str(),
    window: optional(nullable(num())),
    key: optional(nullable(str())),
    text: optional(nullable(str())),
    shift: optional(bool()),
    ctrl: optional(bool()),
    alt: optional(bool()),
  }),
  ({ name, window, key, text, shift, ctrl, alt }) => ({
    name,
    window: window ?? null,
    ...(typeof key === "string" && key.length <= 64 ? { chord: { key, shift: shift === true, ctrl: ctrl === true, alt: alt === true } } : {}),
    ...(typeof text === "string" && text.length > 0 && text.length <= 16 ? { text } : {}),
  }),
);

const Gesture = union(
  loose({ kind: literal("swipe"), phase: literal("begin"), fingers: num() }),
  loose({ kind: literal("swipe"), phase: literal("update"), dx: num(), dy: num() }),
  loose({ kind: literal("swipe"), phase: literal("end"), cancelled: bool() }),
);

const onlyTrue = map(optional(nullable(bool())), (on) => on === true);

const EVENTS = {
  "window-opened": loose({ window: WindowShape }),
  "window-closed": loose({ id: num() }),
  shortcut: loose({ name: str() }),
  binding: Binding,
  super: loose({ phase: literal("tap", "hold", "chord", "up") }),
  "window-placing": loose({ window: Placing }),
  zoom: map(loose({ window: num(), on: optional(nullable(bool())) }), ({ window, on }) => (typeof on === "boolean" ? { window, on } : { window })),
  "window-control": loose({ window: num(), control: literal("zoom"), alt: onlyTrue, double: onlyTrue }),
  "window-grab": loose({ window: num(), kind: literal("move", "resize"), frame: FrameShape, pointer: PointShape }),
  "window-drop": loose({ window: num(), zone: int({ min: 0 }), frame: FrameShape }),
  fullscreen: loose({ window: num(), on: bool() }),
  "bars-edge": map(loose({ inside: bool(), output: optional(nullable(str())) }), ({ inside, output }) =>
    typeof output === "string" ? { inside, output } : { inside },
  ),
  "window-attention": loose({ window: num() }),
  "outputs-changed": loose({}),
  "gpus-changed": loose({}),
  "session-changed": loose({}),
  lock: loose({ locked: bool() }),
  "screen-capture": loose({ active: bool() }),
  "person-input": loose({ window: maybeWindow }),
  overview: loose({ active: bool() }),
  "overview-pick": loose({ window: maybeWindow }),
  "overview-key": loose({ key: str() }),
  "overview-drag": loose({ window: num(), x: num(), y: num() }),
  "overview-drop": loose({ window: num(), x: num(), y: num() }),
  "edge-hold": loose({ edge: literal("left", "right", "top", "bottom"), output: str(), window: num(), count: num(), preview: onlyTrue }),
  space: loose({ current: num(), previous: num(), count: num() }),
  "window-space": loose({ window: num(), space: num() }),
  "window-state": loose({ window: num(), state: WindowStateShape }),
  gesture: Gesture,
  edge: loose({ edge: literal("bottom"), inside: bool() }),
  idle: loose({ seconds: num() }),
  active: loose({}),
  wallpaper: map(loose({ path: optional(nullable(str())), ok: bool(), error: optional(nullable(str())) }), ({ path, ok, error }) => ({
    path: path ?? null,
    ok,
    ...(typeof error === "string" ? { error } : {}),
  })),
  "window-icon": map(loose({ window: num(), name: optional(nullable(str())), path: optional(nullable(str())) }), ({ window, name, path }) => ({
    window,
    icon: maybe(IconShape, { name, path }) ?? { name: null, path: null },
  })),
  bell: loose({ window: maybeWindow }),
  selection: map(loose({ mimeTypes: lenientList(str(), { max: 64 }), window: maybeWindow, x11: optional(nullable(bool())) }), ({ mimeTypes, window, x11 }) => ({
    mimeTypes,
    window,
    ...(x11 === true ? { x11: true as const } : {}),
  })),
  snippet: loose({ keyword: str(), window: num() }),
  "held-key": loose({ name: str(), down: bool(), chord: optional(bool()), tap: optional(bool()) }),
};

/** One event, by its name. */
export const EventShape = tagged("event", EVENTS);
export type CompositorEvent = Infer<typeof EventShape>;

/** The events the shell knows, by name (the H9 contract test compares them with the compositor's). */
export const EVENT_NAMES: readonly string[] = Object.keys(EVENTS);
