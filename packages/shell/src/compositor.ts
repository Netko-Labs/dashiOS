/**
 * A client for dashi-comp's IPC (`$DASHI_COMP_SOCKET`, else
 * `$XDG_RUNTIME_DIR/dashi-comp.sock`): what
 * Bun asks of the compositor (windows, window actions, captures) and what it
 * hears back (windows opening and closing, shortcuts). Newline-delimited
 * JSON; requests are answered by id. The protocol is docs/compositor-ipc.md.
 */

import { join } from "node:path";
import { LineBuffer } from "./lines.ts";
import type { WallpaperRequest } from "./wallpaper/catalog.ts";

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositorWindow {
  id: number;
  appId: string;
  title: string;
  pid: number | null;
  focused: boolean;
  state: "normal" | "minimized" | "hidden";
  /** Has a remembered frame to go back to (tiled or zoomed). */
  zoomed: boolean;
  /** The window fills its screen over the menu bar and Dock (comp/src/fullscreen.rs). Absent from older compositors. */
  fullscreen?: boolean;
  /** The outer frame, title bar included; null unless on screen. */
  frame: Frame | null;
  /** The compositor's title bar height (0 when the app draws its own). */
  titleBar: number;
  /**
   * The window asked for focus (xdg-activation) and was not allowed to take
   * it; clears when it gets the keyboard. Absent from older compositors.
   */
  attention?: boolean;
  /** An X11 app (through Xwayland); present only when true. */
  x11?: boolean;
  /** The Space it is on, from 0 (comp/src/spaces/); its frame is null while that Space is not shown. Absent from older compositors. */
  space?: number;
  /** The icon the app gave (xdg-toplevel-icon): a theme name, and/or a PNG the compositor saved. */
  icon?: WindowIcon;
}

/** A window's own icon: an icon theme name, a picture on disk, or both. */
export interface WindowIcon {
  name: string | null;
  path: string | null;
}

/** A new window waiting to be placed: its id and outer size. */
export interface Placing {
  id: number;
  appId: string;
  title: string;
  width: number;
  height: number;
  /** Where an X11 app asked its frame to open, when that is on screen. */
  position?: { x: number; y: number };
}

/** Where a window shrinks to when it minimizes, and grows from on restore: its Dock tile (global logical pixels); null forgets it. */
export interface AnimationTarget {
  window: number;
  rect: Frame | null;
}

/** Where apps connect: the Wayland socket, and Xwayland's X display. */
export interface Session {
  waylandDisplay: string;
  /** ":1" and so on; null when there is no Xwayland. */
  display: string | null;
  xwayland: "off" | "starting" | "ready" | "failed";
  /** Where the pointer is, global logical pixels; null while the session is locked. */
  pointer: Point | null;
}

export interface Point {
  x: number;
  y: number;
}

/** The pointer in an IPC `session` answer; null when it is missing, null, or not a pair of finite numbers. */
export function parsePointer(answer: unknown): Point | null {
  const pointer = typeof answer === "object" && answer !== null ? (answer as { pointer?: unknown }).pointer : undefined;
  if (typeof pointer !== "object" || pointer === null) return null;
  const { x, y } = pointer as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export type SuperPhase = "tap" | "hold" | "chord" | "up";

export type CompositorEvent =
  | { event: "window-opened"; window: CompositorWindow }
  | { event: "window-closed"; id: number }
  | { event: "shortcut"; name: string }
  /** A chord the keymap binds, and the window focused when it was pressed. */
  | { event: "binding"; name: string; window: number | null; chord?: { key: string; shift: boolean; ctrl: boolean; alt: boolean } }
  /** ❖ alone: tapped, held, used in a chord, or let go. */
  | { event: "super"; phase: SuperPhase }
  /** A new window waits for the shell to place it (arrange.ts). */
  | { event: "window-placing"; window: Placing }
  /** The zoom control, a title-bar double click, or the Dock asked to zoom. */
  | { event: "zoom"; window: number }
  /**
   * An app, or the green light, asked for a window to enter or leave full
   * screen (arrange.ts decides; IPC `fullscreen {window, on}` does it).
   */
  | { event: "fullscreen"; window: number; on: boolean }
  /** The pointer entered (on `output`) or left the top-edge band claimed with `bars` (fullscreen.ts). */
  | { event: "bars-edge"; inside: boolean; output?: string }
  /** A window asked for focus and was refused: it wants attention (the Dock can show it). */
  | { event: "window-attention"; window: number }
  /** A screen, or the area the menu bar and Dock leave free, changed. */
  | { event: "outputs-changed" }
  /** The session was locked or unlocked (comp/src/lock.rs). */
  | { event: "lock"; locked: boolean }
  /** Something is capturing the screen (screen sharing, a recorder), or stopped (comp/src/handlers/screencopy/). */
  | { event: "screen-capture"; active: boolean }
  /** The person used the desktop: in window N, or elsewhere (null). Throttled by the compositor. */
  | { event: "person-input"; window: number | null }
  /** The overview opened or closed (comp/src/overview/). */
  | { event: "overview"; active: boolean }
  /** A press while it is open: on window N, or on the background (null). */
  | { event: "overview-pick"; window: number | null }
  /** A key the open overview kept from the focused window: its keysym name, e.g. "Escape". */
  | { event: "overview-key"; key: string }
  /** A window dragged in the open overview was let go at this point (global logical). */
  | { event: "overview-drop"; window: number; x: number; y: number }
  /** The Space that shows, or how many there are, changed (comp/src/spaces/; spaces/). */
  | { event: "space"; current: number; previous: number; count: number }
  /** A window was put on another Space (or its Space was renumbered). */
  | { event: "window-space"; window: number; space: number }
  /** A touchpad swipe the shell claimed (IPC `gestures`): its start, each move, and its end (gestures.ts). */
  | { event: "gesture"; kind: "swipe"; phase: "begin"; fingers: number }
  | { event: "gesture"; kind: "swipe"; phase: "update"; dx: number; dy: number }
  | { event: "gesture"; kind: "swipe"; phase: "end"; cancelled: boolean }
  /** The pointer entered or left the band claimed with `edges` along a screen's bottom edge (dock/edges.ts). */
  | { event: "edge"; edge: "bottom"; inside: boolean }
  /** No input for this many seconds (a threshold asked for with `idle`). */
  | { event: "idle"; seconds: number }
  /** Input again after an `idle` event. */
  | { event: "active" }
  /** Xwayland came up or failed; ask `session()` again. */
  | { event: "session-changed" }
  /** A window's icon changed (xdg-toplevel-icon). */
  | { event: "window-icon"; window: number; icon: WindowIcon }
  /** An app rang the system bell (xdg-system-bell); window is null when it named no surface. */
  | { event: "bell"; window: number | null }
  /** A wallpaper finished loading (`path`, null for the built-in gradient) or could not be (comp/src/wallpaper/). */
  | { event: "wallpaper"; path: string | null; ok: boolean; error?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseFrame(value: unknown): Frame | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : null;
}

const MAX_ICON_TEXT = 4096;
const iconText = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= MAX_ICON_TEXT ? value : null);

/** A window icon as the compositor sends it; null when it names neither a theme icon nor a picture. */
export function parseWindowIcon(value: unknown): WindowIcon | null {
  if (!isRecord(value)) return null;
  const icon = { name: iconText(value.name), path: iconText(value.path) };
  return icon.name === null && icon.path === null ? null : icon;
}

export function parseWindow(value: unknown): CompositorWindow | null {
  if (!isRecord(value)) return null;
  const { id, appId, title, pid, focused, state, zoomed, frame, titleBar, attention, x11, fullscreen, space, icon } = value;
  if (!isNumber(id) || typeof appId !== "string" || typeof title !== "string") return null;
  if (typeof focused !== "boolean" || typeof zoomed !== "boolean") return null;
  if (state !== "normal" && state !== "minimized" && state !== "hidden") return null;
  return {
    id,
    appId,
    title,
    pid: isNumber(pid) ? pid : null,
    focused,
    state,
    zoomed,
    frame: parseFrame(frame),
    titleBar: isNumber(titleBar) ? titleBar : 0,
    ...(attention === true ? { attention } : {}),
    ...(x11 === true ? { x11 } : {}),
    ...(fullscreen === true ? { fullscreen } : {}),
    ...(isNumber(space) && Number.isInteger(space) && space >= 0 ? { space } : {}),
    ...withIcon(parseWindowIcon(icon)),
  };
}

const withIcon = (icon: WindowIcon | null): { icon?: WindowIcon } => (icon ? { icon } : {});

export function parseEvent(value: unknown): CompositorEvent | null {
  if (!isRecord(value)) return null;
  switch (value.event) {
    case "window-opened": {
      const window = parseWindow(value.window);
      return window && { event: "window-opened", window };
    }
    case "window-closed":
      return isNumber(value.id) ? { event: "window-closed", id: value.id } : null;
    case "shortcut":
      return typeof value.name === "string" ? { event: "shortcut", name: value.name } : null;
    case "binding":
      return typeof value.name === "string"
        ? {
            event: "binding",
            name: value.name,
            window: isNumber(value.window) ? value.window : null,
            ...(typeof value.key === "string" && value.key.length <= 64
              ? { chord: { key: value.key, shift: value.shift === true, ctrl: value.ctrl === true, alt: value.alt === true } }
              : {}),
          }
        : null;
    case "window-placing": {
      const window = value.window;
      if (!isRecord(window)) return null;
      const { id, appId, title, width, height, position } = window;
      if (!isNumber(id) || !isNumber(width) || !isNumber(height)) return null;
      const placing: Placing = { id, appId: String(appId ?? ""), title: String(title ?? ""), width, height };
      if (isRecord(position) && isNumber(position.x) && isNumber(position.y)) placing.position = { x: position.x, y: position.y };
      return { event: "window-placing", window: placing };
    }
    case "zoom":
      return isNumber(value.window) ? { event: "zoom", window: value.window } : null;
    case "fullscreen":
      return isNumber(value.window) && typeof value.on === "boolean" ? { event: "fullscreen", window: value.window, on: value.on } : null;
    case "bars-edge":
      if (typeof value.inside !== "boolean") return null;
      return typeof value.output === "string"
        ? { event: "bars-edge", inside: value.inside, output: value.output }
        : { event: "bars-edge", inside: value.inside };
    case "gesture": {
      if (value.kind !== "swipe") return null;
      if (value.phase === "begin") return isNumber(value.fingers) ? { event: "gesture", kind: "swipe", phase: "begin", fingers: value.fingers } : null;
      if (value.phase === "update")
        return isNumber(value.dx) && isNumber(value.dy) ? { event: "gesture", kind: "swipe", phase: "update", dx: value.dx, dy: value.dy } : null;
      if (value.phase === "end")
        return typeof value.cancelled === "boolean" ? { event: "gesture", kind: "swipe", phase: "end", cancelled: value.cancelled } : null;
      return null;
    }
    case "edge":
      return value.edge === "bottom" && typeof value.inside === "boolean" ? { event: "edge", edge: "bottom", inside: value.inside } : null;
    case "window-attention":
      return isNumber(value.window) ? { event: "window-attention", window: value.window } : null;
    case "window-icon": {
      if (!isNumber(value.window)) return null;
      const icon = parseWindowIcon(value) ?? { name: null, path: null };
      return { event: "window-icon", window: value.window, icon };
    }
    case "bell":
      return value.window === null || isNumber(value.window) ? { event: "bell", window: value.window } : null;
    case "outputs-changed":
      return { event: "outputs-changed" };
    case "session-changed":
      return { event: "session-changed" };
    case "lock":
      return typeof value.locked === "boolean" ? { event: "lock", locked: value.locked } : null;
    case "screen-capture":
      return typeof value.active === "boolean" ? { event: "screen-capture", active: value.active } : null;
    case "person-input":
      return value.window === null || isNumber(value.window) ? { event: "person-input", window: value.window } : null;
    case "overview":
      return typeof value.active === "boolean" ? { event: "overview", active: value.active } : null;
    case "overview-pick":
      return value.window === null || isNumber(value.window) ? { event: "overview-pick", window: value.window } : null;
    case "overview-key":
      return typeof value.key === "string" ? { event: "overview-key", key: value.key } : null;
    case "overview-drop":
      return isNumber(value.window) && isNumber(value.x) && isNumber(value.y) ? { event: "overview-drop", window: value.window, x: value.x, y: value.y } : null;
    case "space":
      return isNumber(value.current) && isNumber(value.previous) && isNumber(value.count)
        ? { event: "space", current: value.current, previous: value.previous, count: value.count }
        : null;
    case "window-space":
      return isNumber(value.window) && isNumber(value.space) ? { event: "window-space", window: value.window, space: value.space } : null;
    case "idle":
      return isNumber(value.seconds) ? { event: "idle", seconds: value.seconds } : null;
    case "active":
      return { event: "active" };
    case "wallpaper":
      return typeof value.ok === "boolean"
        ? {
            event: "wallpaper",
            path: typeof value.path === "string" ? value.path : null,
            ok: value.ok,
            ...(typeof value.error === "string" ? { error: value.error } : {}),
          }
        : null;
    case "super":
      return value.phase === "tap" || value.phase === "hold" || value.phase === "chord" || value.phase === "up" ? { event: "super", phase: value.phase } : null;
    default:
      return null;
  }
}

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void };

export class Compositor {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CompositorEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly lines = new LineBuffer();

  private constructor(private readonly socket: Bun.Socket<undefined>) {}

  /** Connect and subscribe to events; null when dashi-comp isn't there. */
  static async connect(): Promise<Compositor | null> {
    const dir = process.env.XDG_RUNTIME_DIR;
    if (!dir) return null;
    let compositor: Compositor | null = null;
    try {
      const socket = await Bun.connect({
        // DASHI_COMP_SOCKET: a compositor beside the session's (nested, tests) says where its socket is.
        unix: process.env.DASHI_COMP_SOCKET || join(dir, "dashi-comp.sock"),
        socket: {
          data: (_socket, data) => compositor?.receive(data),
          close: () => compositor?.closed(),
        },
      });
      compositor = new Compositor(socket);
      await compositor.request("subscribe");
      return compositor;
    } catch (error) {
      console.error("dashi-shell: no compositor IPC:", error);
      return null;
    }
  }

  /** Ask dashi-comp; rejects with its error message. */
  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async windows(): Promise<CompositorWindow[]> {
    const result = await this.request("windows");
    const list = isRecord(result) && Array.isArray(result.windows) ? result.windows : [];
    return list.map(parseWindow).filter((window): window is CompositorWindow => window !== null);
  }

  async session(): Promise<Session | null> {
    const result = await this.request("session");
    if (!isRecord(result) || typeof result.waylandDisplay !== "string") return null;
    const { xwayland } = result;
    if (xwayland !== "off" && xwayland !== "starting" && xwayland !== "ready" && xwayland !== "failed") return null;
    return {
      waylandDisplay: result.waylandDisplay,
      display: typeof result.display === "string" ? result.display : null,
      xwayland,
      pointer: parsePointer(result),
    };
  }

  /** Change what the desktop shows behind the windows (rejects with the compositor's reason if it refuses the file). */
  async wallpaper(request: WallpaperRequest | { paused: boolean }): Promise<void> {
    await this.request("wallpaper", { ...request });
  }

  /** Tell the compositor where each window's Dock tile is (rect null: none). */
  async animationTargets(targets: readonly AnimationTarget[]): Promise<void> {
    await this.request("animation-target", { targets });
  }

  on(listener: (event: CompositorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(chunk: Uint8Array): void {
    for (const line of this.lines.push(chunk)) {
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(message)) continue;
      if (isNumber(message.id) && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id) as Pending;
        this.pending.delete(message.id);
        if (typeof message.error === "string") pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        continue;
      }
      const event = parseEvent(message);
      if (event) this.dispatch(event);
    }
  }

  /** One listener that throws must not cost the others (or the rest of this chunk's events) their turn. */
  private dispatch(event: CompositorEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error(`dashi-shell: a listener for “${event.event}” threw:`, error);
      }
    }
  }

  /** The compositor went away (it exited or crashed); runs once. */
  onClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private closed(): void {
    for (const pending of this.pending.values()) pending.reject(new Error("dashi-comp closed the connection"));
    this.pending.clear();
    for (const listener of [...this.closeListeners]) listener();
    this.closeListeners.clear();
  }
}
