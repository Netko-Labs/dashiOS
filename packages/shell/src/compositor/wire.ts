/**
 * The IPC's vocabulary as shapes (docs/compositor-ipc.md): a frame, a point,
 * a window, the session. Each type is inferred from its shape, never written
 * beside it. What the compositor sends is read loosely where an older or
 * newer compositor may differ (unknown fields are ignored; a value out of
 * range is left out, as the shell always has), but a field of the wrong type
 * refuses the whole.
 */

import { bool, type Infer, int, lenientList, literal, map, nullable, num, obj, optional, type Shape, str } from "@dashi/shape";

const LOOSE = { strict: false } as const;

/** An outer frame (title bar included), global logical pixels. */
export const FrameShape = obj({ x: num(), y: num(), width: num(), height: num() }, LOOSE);
export type Frame = Infer<typeof FrameShape>;

export const PointShape = obj({ x: num(), y: num() }, LOOSE);
export type Point = Infer<typeof PointShape>;

/** A window id: a positive whole number. */
export const WindowId = int({ min: 1 });

const SizeShape = obj({ width: num(), height: num() }, LOOSE);

/** A positive size, or nothing. */
const positive = map(optional(nullable(SizeShape)), (size) => (size && size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null));

const MAX_ICON_TEXT = 4096;
/** An icon's name or path: text of 1 to 4096 characters, else null. */
const iconText = map(optional(nullable(str())), (text) => (text && text.length > 0 && text.length <= MAX_ICON_TEXT ? text : null));

/** What an app gave as its icon; null when it names neither a theme icon nor a picture. */
export const IconShape = map(obj({ name: iconText, path: iconText }, LOOSE), (icon) => (icon.name === null && icon.path === null ? null : icon));
export type WindowIcon = NonNullable<Infer<typeof IconShape>>;

export const WindowStateShape = literal("normal", "minimized", "hidden");

const whole = (min: number) => map(optional(nullable(num())), (n) => (n !== undefined && n !== null && Number.isInteger(n) && n >= min ? n : undefined));

const WindowFields = obj(
  {
    id: num(),
    appId: str(),
    title: str(),
    pid: map(optional(nullable(num())), (pid) => pid ?? null),
    focused: bool(),
    state: WindowStateShape,
    frame: map(optional(nullable(FrameShape)), (frame) => frame ?? null),
    away: map(optional(nullable(FrameShape)), (frame) => frame ?? undefined),
    configuring: positive,
    minSize: positive,
    titleBar: map(optional(num()), (bar) => bar ?? 0),
    attention: optional(nullable(bool())),
    x11: optional(nullable(bool())),
    fullscreen: optional(nullable(bool())),
    space: whole(0),
    icon: map(optional(nullable(IconShape)), (icon) => icon ?? null),
    toplevel: map(optional(nullable(str())), (id) => (id && id.length <= 256 ? id : undefined)),
    sheetOf: whole(1),
    parent: whole(1),
  },
  LOOSE,
);

/** A window, with the flags that are false and the values that are absent left out. */
export const WindowShape = map(WindowFields, (w) => ({
  id: w.id,
  appId: w.appId,
  title: w.title,
  pid: w.pid,
  focused: w.focused,
  state: w.state,
  frame: w.frame,
  ...(w.away ? { away: w.away } : {}),
  ...(w.configuring ? { configuring: w.configuring } : {}),
  ...(w.minSize ? { minSize: w.minSize } : {}),
  titleBar: w.titleBar,
  ...(w.attention === true ? { attention: true } : {}),
  ...(w.x11 === true ? { x11: true } : {}),
  ...(w.fullscreen === true ? { fullscreen: true } : {}),
  ...(w.space !== undefined ? { space: w.space } : {}),
  ...(w.icon ? { icon: w.icon } : {}),
  ...(w.toplevel !== undefined ? { toplevel: w.toplevel } : {}),
  ...(w.sheetOf !== undefined ? { sheetOf: w.sheetOf } : {}),
  ...(w.parent !== undefined ? { parent: w.parent } : {}),
}));

/** One window as the shell sees it: `configuring`, `minSize`, `space`… only when there is one, the flags only when true. */
export interface CompositorWindow {
  id: number;
  appId: string;
  title: string;
  pid: number | null;
  focused: boolean;
  state: Infer<typeof WindowStateShape>;
  frame: Frame | null;
  /** Its frame where it waits on a Space that does not show (`frame` is null then). */
  away?: Frame;
  configuring?: { width: number; height: number };
  minSize?: { width: number; height: number };
  titleBar: number;
  attention?: boolean;
  x11?: boolean;
  fullscreen?: boolean;
  space?: number;
  icon?: WindowIcon;
  toplevel?: string;
  sheetOf?: number;
  parent?: number;
}

// The interface above is what WindowShape gives, named for the shell's readers; this line fails to compile when the two part.
const _sameWindow: Shape<CompositorWindow> = WindowShape;
void _sameWindow;

export const SessionShape = obj(
  {
    waylandDisplay: str(),
    display: map(optional(nullable(str())), (display) => display ?? null),
    xwayland: literal("off", "starting", "ready", "failed"),
    pointer: map(optional(nullable(PointShape)), (pointer) => pointer ?? null),
    locked: bool(),
  },
  LOOSE,
);
export type Session = Infer<typeof SessionShape>;

/** Which kinds of pointer device are connected (`pointers`, and the event of that name). */
export const PointersShape = obj({ touchpad: bool(), mouse: bool() }, { strict: false });
export type Pointers = Infer<typeof PointersShape>;

export const GpuShape = obj(
  {
    card: str(),
    open: map(optional(bool()), (open) => open === true),
    draws: map(optional(bool()), (draws) => draws === true),
    kept: map(optional(bool()), (kept) => kept === true),
    screens: map(optional(lenientList(str())), (screens) => screens ?? []),
    buffers: map(optional(num()), (buffers) => buffers ?? 0),
  },
  LOOSE,
);
export type Gpu = Infer<typeof GpuShape>;
