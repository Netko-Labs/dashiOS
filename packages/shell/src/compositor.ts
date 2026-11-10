/**
 * A client for dashi-comp's IPC (`$DASHI_COMP_SOCKET`, else
 * `$XDG_RUNTIME_DIR/dashi-comp.sock`): what
 * Bun asks of the compositor (windows, window actions, captures) and what it
 * hears back (windows opening and closing, shortcuts). Newline-delimited
 * JSON; requests are answered by id. The protocol is docs/compositor-ipc.md.
 */

import { join } from "node:path";
import type { AnimationTarget, CompositorEvent, CompositorWindow, Frame, Gpu, Placing, Point, ScreenEdge, Session, WindowIcon } from "./compositor-types.ts";
import { LineBuffer } from "./lines.ts";
import type { WallpaperRequest } from "./wallpaper/catalog.ts";

export type {
  AnimationTarget,
  CompositorEvent,
  CompositorWindow,
  Frame,
  Gpu,
  Placing,
  Point,
  ScreenEdge,
  Session,
  WindowIcon,
} from "./compositor-types.ts";

/** The pointer in an IPC `session` answer; null when it is missing, null, or not a pair of finite numbers. */
export function parsePointer(answer: unknown): Point | null {
  const pointer = typeof answer === "object" && answer !== null ? (answer as { pointer?: unknown }).pointer : undefined;
  if (typeof pointer !== "object" || pointer === null) return null;
  const { x, y } = pointer as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const SCREEN_EDGES: readonly ScreenEdge[] = ["left", "right", "top", "bottom"];
const isScreenEdge = (value: unknown): value is ScreenEdge => SCREEN_EDGES.some((edge) => edge === value);

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
  const { id, appId, title, pid, focused, state, frame, configuring, minSize, titleBar, attention, x11, fullscreen, space, icon, toplevel, sheetOf, parent } =
    value;
  if (!isNumber(id) || typeof appId !== "string" || typeof title !== "string") return null;
  if (typeof focused !== "boolean") return null;
  if (state !== "normal" && state !== "minimized" && state !== "hidden") return null;
  return {
    id,
    appId,
    title,
    pid: isNumber(pid) ? pid : null,
    focused,
    state,
    frame: parseFrame(frame),
    ...withSize(configuring),
    ...withLeast(minSize),
    titleBar: isNumber(titleBar) ? titleBar : 0,
    ...(attention === true ? { attention } : {}),
    ...(x11 === true ? { x11 } : {}),
    ...(fullscreen === true ? { fullscreen } : {}),
    ...(isNumber(space) && Number.isInteger(space) && space >= 0 ? { space } : {}),
    ...withIcon(parseWindowIcon(icon)),
    ...(typeof toplevel === "string" && toplevel.length > 0 && toplevel.length <= 256 ? { toplevel } : {}),
    ...(isNumber(sheetOf) && Number.isInteger(sheetOf) && sheetOf > 0 ? { sheetOf } : {}),
    ...(isWindowId(parent) ? { parent } : {}),
  };
}

const isWindowId = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value > 0;

const withIcon = (icon: WindowIcon | null): { icon?: WindowIcon } => (icon ? { icon } : {});

const sizeOf = (value: unknown): { width: number; height: number } | null =>
  isRecord(value) && isNumber(value.width) && isNumber(value.height) && value.width > 0 && value.height > 0
    ? { width: value.width, height: value.height }
    : null;

const withSize = (value: unknown): { configuring?: { width: number; height: number } } => {
  const size = sizeOf(value);
  return size ? { configuring: size } : {};
};

const withLeast = (value: unknown): { minSize?: { width: number; height: number } } => {
  const size = sizeOf(value);
  return size ? { minSize: size } : {};
};

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
            ...(typeof value.text === "string" && value.text.length > 0 && value.text.length <= 16 ? { text: value.text } : {}),
          }
        : null;
    case "window-placing": {
      const window = value.window;
      if (!isRecord(window)) return null;
      const { id, appId, title, width, height, position, parent } = window;
      if (!isNumber(id) || !isNumber(width) || !isNumber(height)) return null;
      const placing: Placing = { id, appId: String(appId ?? ""), title: String(title ?? ""), width, height };
      if (isRecord(position) && isNumber(position.x) && isNumber(position.y)) placing.position = { x: position.x, y: position.y };
      if (isWindowId(parent)) placing.parent = parent;
      return { event: "window-placing", window: placing };
    }
    case "zoom":
      if (!isNumber(value.window)) return null;
      return typeof value.on === "boolean" ? { event: "zoom", window: value.window, on: value.on } : { event: "zoom", window: value.window };
    case "window-control":
      return isNumber(value.window) && value.control === "zoom"
        ? { event: "window-control", window: value.window, control: "zoom", alt: value.alt === true, double: value.double === true }
        : null;
    case "window-grab": {
      const frame = parseFrame(value.frame);
      const pointer = isRecord(value.pointer) && isNumber(value.pointer.x) && isNumber(value.pointer.y) ? { x: value.pointer.x, y: value.pointer.y } : null;
      if (!isNumber(value.window) || (value.kind !== "move" && value.kind !== "resize") || !frame || !pointer) return null;
      return { event: "window-grab", window: value.window, kind: value.kind, frame, pointer };
    }
    case "window-drop": {
      const frame = parseFrame(value.frame);
      return isNumber(value.window) && isNumber(value.zone) && Number.isInteger(value.zone) && value.zone >= 0 && frame
        ? { event: "window-drop", window: value.window, zone: value.zone, frame }
        : null;
    }
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
    case "gpus-changed":
      return { event: "gpus-changed" };
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
    case "overview-drag":
      return isNumber(value.window) && isNumber(value.x) && isNumber(value.y) ? { event: "overview-drag", window: value.window, x: value.x, y: value.y } : null;
    case "edge-hold": {
      const { edge, output, window, count, preview } = value;
      if (!isScreenEdge(edge) || typeof output !== "string" || !isNumber(window) || !isNumber(count)) return null;
      return { event: "edge-hold", edge, output, window, count, preview: preview === true };
    }
    case "overview-drop":
      return isNumber(value.window) && isNumber(value.x) && isNumber(value.y) ? { event: "overview-drop", window: value.window, x: value.x, y: value.y } : null;
    case "space":
      return isNumber(value.current) && isNumber(value.previous) && isNumber(value.count)
        ? { event: "space", current: value.current, previous: value.previous, count: value.count }
        : null;
    case "window-space":
      return isNumber(value.window) && isNumber(value.space) ? { event: "window-space", window: value.window, space: value.space } : null;
    case "window-state":
      return isNumber(value.window) && (value.state === "normal" || value.state === "minimized" || value.state === "hidden")
        ? { event: "window-state", window: value.window, state: value.state }
        : null;
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
    case "selection": {
      const { mimeTypes, window, x11 } = value;
      if (!Array.isArray(mimeTypes) || !(window === null || isNumber(window))) return null;
      const types = mimeTypes.filter((type): type is string => typeof type === "string").slice(0, 64);
      return { event: "selection", mimeTypes: types, window, ...(x11 === true ? { x11 } : {}) };
    }
    case "snippet":
      return typeof value.keyword === "string" && isNumber(value.window) ? { event: "snippet", keyword: value.keyword, window: value.window } : null;
    case "super":
      return value.phase === "tap" || value.phase === "hold" || value.phase === "chord" || value.phase === "up" ? { event: "super", phase: value.phase } : null;
    default:
      return null;
  }
}

export function parseGpus(value: unknown): Gpu[] {
  const list = isRecord(value) && Array.isArray(value.gpus) ? value.gpus : [];
  return list.flatMap((gpu): Gpu[] => {
    if (!isRecord(gpu) || typeof gpu.card !== "string") return [];
    const screens = Array.isArray(gpu.screens) ? gpu.screens.filter((name): name is string => typeof name === "string") : [];
    return [
      {
        card: gpu.card,
        open: gpu.open === true,
        draws: gpu.draws === true,
        kept: gpu.kept === true,
        screens,
        buffers: isNumber(gpu.buffers) ? gpu.buffers : 0,
      },
    ];
  });
}

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** How long a request waits for its reply unless it says otherwise. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface ConnectOptions {
  /** The socket; else `DASHI_COMP_SOCKET`, else `$XDG_RUNTIME_DIR/dashi-comp.sock`. */
  path?: string;
  /** How long a request waits for its reply (`REQUEST_TIMEOUT_MS`). */
  timeoutMs?: number;
}

export class Compositor {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CompositorEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly lines = new LineBuffer();
  private isClosed = false;

  private constructor(
    private readonly socket: Bun.Socket<undefined>,
    private readonly timeoutMs: number,
  ) {}

  /** Connect and subscribe to events; null when dashi-comp isn't there. */
  static async connect(options: ConnectOptions = {}): Promise<Compositor | null> {
    const dir = process.env.XDG_RUNTIME_DIR;
    // DASHI_COMP_SOCKET: a compositor beside the session's (nested, tests) says where its socket is.
    const path = options.path || process.env.DASHI_COMP_SOCKET || (dir ? join(dir, "dashi-comp.sock") : null);
    if (!path) return null;
    let compositor: Compositor | null = null;
    try {
      const socket = await Bun.connect({
        unix: path,
        socket: {
          data: (_socket, data) => compositor?.receive(data),
          close: () => compositor?.closed(),
        },
      });
      compositor = new Compositor(socket, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      await compositor.request("subscribe");
      return compositor;
    } catch (error) {
      console.error("dashi-shell: no compositor IPC:", error);
      return null;
    }
  }

  /**
   * Ask dashi-comp; rejects with its error message, when no reply comes within
   * `timeoutMs`, and at once once the compositor has gone.
   */
  request(method: string, params: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new Error("dashi-comp closed the connection"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`dashi-comp: no reply to ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
    if (typeof result.locked !== "boolean") return null;
    return {
      waylandDisplay: result.waylandDisplay,
      display: typeof result.display === "string" ? result.display : null,
      xwayland,
      pointer: parsePointer(result),
      locked: result.locked,
    };
  }

  /** Change what the desktop shows behind the windows (rejects with the compositor's reason if it refuses the file). */
  async wallpaper(request: WallpaperRequest | { paused: boolean }): Promise<void> {
    await this.request("wallpaper", { ...request });
  }

  /** The GPUs and what holds each open (none outside a seat of dashi-comp's own). */
  async gpus(): Promise<Gpu[]> {
    return parseGpus(await this.request("gpus"));
  }

  /** Hold a GPU open with nothing on it (warm for a game), or let it sleep again once nothing else needs it. */
  async keepGpu(card: string, on: boolean): Promise<void> {
    await this.request("gpu-keep", { card, on });
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
        clearTimeout(pending.timer);
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
    if (this.isClosed) return;
    this.isClosed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("dashi-comp closed the connection"));
    }
    this.pending.clear();
    for (const listener of [...this.closeListeners]) listener();
    this.closeListeners.clear();
  }
}
