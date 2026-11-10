/**
 * The shapes of dashi-comp's IPC as the shell sees them: windows, screens,
 * GPUs, and every event (docs/compositor-ipc.md). Types only: imported with
 * `import type`, it is never loaded; compositor.ts parses into these.
 */

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
  /** The window fills its screen over the menu bar and Dock (comp/src/fullscreen.rs). Absent from older compositors. */
  fullscreen?: boolean;
  /** The outer frame, title bar included; null unless on screen. */
  frame: Frame | null;
  /**
   * The outer size its app was last asked to take, while it has not yet
   * acked and committed that configure (its `frame` still has the old size).
   * Absent once it has, and for X11 windows.
   */
  configuring?: { width: number; height: number };
  /** The smallest outer frame its app allows, title bar included (xdg `set_min_size`, X11's size hints). Absent without one, and from older compositors. */
  minSize?: { width: number; height: number };
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
  /** Its ext-foreign-toplevel-list identifier: what a screen-share picker answers with (share-picker/). Absent until listed. */
  toplevel?: string;
  /** The window it is a sheet of (IPC `attach`: a portal dialog, portal-host/); present only for a sheet. */
  sheetOf?: number;
  /** The window it is a dialog of (its xdg parent, or the X11 window it is transient for); present only for a dialog. */
  parent?: number;
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
  /** The window it is a dialog of, when it is one (`CompositorWindow.parent`). */
  parent?: number;
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
  /** The screen is locked (from ext-session-lock's lock to its unlock); the `lock` event follows changes. */
  locked: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export type SuperPhase = "tap" | "hold" | "chord" | "up";

export type ScreenEdge = "left" | "right" | "top" | "bottom";

export type CompositorEvent =
  | { event: "window-opened"; window: CompositorWindow }
  | { event: "window-closed"; id: number }
  | { event: "shortcut"; name: string }
  /** A chord the keymap binds, and the window focused when it was pressed. */
  | {
      event: "binding";
      name: string;
      window: number | null;
      chord?: { key: string; shift: boolean; ctrl: boolean; alt: boolean };
      /** What the key typed ("a", "A", "é"); absent for Return, BackSpace, the arrows. */
      text?: string;
    }
  /** ❖ alone: tapped, held, used in a chord, or let go. */
  | { event: "super"; phase: SuperPhase }
  /** A new window waits for the shell to place it (arrange.ts). */
  | { event: "window-placing"; window: Placing }
  /** An app (its own title bar's double-click) or a taskbar asked for the window to be maximized (`on`) or not. */
  | { event: "zoom"; window: number; on?: boolean }
  /** A press on the square in dashi-comp's title bar, or a double-click on the bar (`double`), with ⌥ or not (arrange.ts decides). */
  | { event: "window-control"; window: number; control: "zoom"; alt: boolean; double: boolean }
  /** The person began to move or resize a window (past the drag's slop): its frame then, and where the press was. */
  | { event: "window-grab"; window: number; kind: "move" | "resize"; frame: Frame; pointer: Point }
  /** A dragged window was let go over drag-to-tile zone `zone` (its index in the last `layout`), whose `frame` showed. */
  | { event: "window-drop"; window: number; zone: number; frame: Frame }
  /**
   * An app, or a taskbar, asked for a window to enter or leave full
   * screen (arrange.ts decides; IPC `fullscreen {window, on}` does it).
   */
  | { event: "fullscreen"; window: number; on: boolean }
  /** The pointer entered (on `output`) or left the top-edge band claimed with `bars` (fullscreen.ts). */
  | { event: "bars-edge"; inside: boolean; output?: string }
  /** A window asked for focus and was refused: it wants attention (the Dock can show it). */
  | { event: "window-attention"; window: number }
  /** A screen, or the area the menu bar and Dock leave free, changed. */
  | { event: "outputs-changed" }
  /** A GPU was opened or let go to sleep (ask `gpus()` again). */
  | { event: "gpus-changed" }
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
  /** A press on a window in the open overview became a drag, at this point (once per drag). */
  | { event: "overview-drag"; window: number; x: number; y: number }
  /** A window held in a move grab rested against a screen's edge for 400 ms (count 1), and each 400 ms more (spaces/edge.ts decides). */
  | { event: "edge-hold"; edge: ScreenEdge; output: string; window: number; count: number; preview: boolean }
  /** A window dragged in the open overview was let go at this point (global logical). */
  | { event: "overview-drop"; window: number; x: number; y: number }
  /** The Space that shows, or how many there are, changed (comp/src/spaces/; spaces/). */
  | { event: "space"; current: number; previous: number; count: number }
  /** A window was put on another Space (or its Space was renumbered). */
  | { event: "window-space"; window: number; space: number }
  /** A window was minimized, hidden, or shown again (by the shell, the person, or the app itself). */
  | { event: "window-state"; window: number; state: CompositorWindow["state"] }
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
  | { event: "wallpaper"; path: string | null; ok: boolean; error?: string }
  /** The clipboard has a new copy: its types, and the window that had the keyboard (clipboard/watch.ts reads it). */
  | { event: "selection"; mimeTypes: string[]; window: number | null; x11?: true }
  /** A snippet's keyword was just typed into a window (IPC `snippets`; clipboard/snippets.ts decides). */
  | { event: "snippet"; keyword: string; window: number };

/** A GPU as dashi-comp holds it (IPC `gpus`): one that does not draw is open only while something needs it. */
export interface Gpu {
  /** udev's name: card0. */
  card: string;
  /** dashi-comp holds it open (else it is free to sleep). */
  open: boolean;
  /** It draws the screens: always open. */
  draws: boolean;
  /** Held open by `keepGpu`. */
  kept: boolean;
  /** Screens connected to it. */
  screens: string[];
  /** Client buffers only it can read, holding it open. */
  buffers: number;
}
