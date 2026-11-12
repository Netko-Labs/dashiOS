/**
 * What the applet client's callers write and read: the applet it shows, the
 * handlers it gives, and the options that build the client (client.ts).
 */

import { CONTROL_LIMITS, type ControlAction } from "./controls.ts";
import type { Manifest } from "./manifest.ts";
import type { MenuRowSpec } from "./menu.ts";
import type { Placement } from "./protocol.ts";

/** What an applet shows; the shell's limits and rules are in docs/applets.md. */
export interface AppletSpec {
  id: string;
  title: string;
  /** SVG markup drawn in the menu bar's text color, as Dashi's own glyphs (16 × 16 reads best). */
  glyph?: string;
  /** An absolute path to a PNG or SVG drawn as it is. */
  icon?: string;
  /** Short text beside the picture, or alone. */
  label?: string;
  tooltip?: string;
  menu?: readonly MenuRowSpec[];
  /** What a click does: open the menu (the default with a menu) or call `onActivate`. */
  click?: "activate" | "menu";
  attention?: boolean;
}

/** Where a popover goes, and the namespace its layer surface takes. */
export type PopoverPlacement = Placement & { namespace: string };

export interface AppletHandlers {
  /** A click, with where it was on the screen (for a popover or a window of your own to open near). */
  onActivate?(x: number, y: number): void;
  onSelect?(item: string): void;
  /** The shell placed the popover asked for with `requestPopover`. */
  onPopover?(placement: PopoverPlacement): void;
  /** The popover must close (a click outside it, the item clicked again, the shell gone). */
  onDismiss?(): void;
}

/** The shell ran one of the manifest's commands (protocol 3). */
export interface CommandRun {
  seq: number;
  command: string;
  args: Record<string, string | number | boolean>;
  /** A pick command asked for its rows for what is typed. */
  query?: string;
  /** A pick command's row was chosen. */
  item?: string;
}

/** What answers the launcher's commands: each run gets a `result`, `items`, or `requestView` (client methods). */
export interface CommandHandlers {
  onRun(run: CommandRun): void;
  /** Where a view asked for with `requestView` goes. */
  onView?(seq: number, placement: PopoverPlacement): void;
  /** The view of run `seq` must close (the launcher moved on or closed). */
  onViewDismiss?(seq: number): void;
}

/** What Control Center does with the applet's controls (protocol 5). */
export interface ControlHandlers {
  /** One was pressed. */
  onAction(action: { id: string } & ControlAction): void;
  /** Which of them the person has in Control Center now (keep those up to date). */
  onShown?(shown: readonly string[]): void;
}

/** The time between two sends of one control's state: 4 a second. */
export const CONTROL_SPACING_MS = 1000 / CONTROL_LIMITS.updatesPerSecond;

/** A connection as the client uses it (Bun's socket, or a test's). */
export interface ClientSocket {
  write(data: Uint8Array): number;
  end(): void;
}

export interface SocketHandlers {
  open(socket: ClientSocket): void;
  data(chunk: Uint8Array): void;
  drain(): void;
  close(): void;
}

export interface AppletsClientOptions {
  path: string | null;
  /** applet.json: given, the client says hello and speaks version 2. */
  manifest?: Manifest;
  /** Marks the applet as in development (the bar shows a "dev" badge). */
  dev?: boolean;
  /** Each message, both ways, for `dashi-applet dev`'s log. */
  onMessage?(direction: "in" | "out", line: string): void;
  /**
   * The applet's own process (defineApplet sets it): waiting for the shell
   * to come back (a session or shell restart) keeps it running. Without it,
   * as in an app's client, the wait never holds the process up.
   */
  keepAlive?: boolean;
  connect?(path: string, handlers: SocketHandlers): void;
  exists?(path: string): boolean;
  later?(fn: () => void, ms: number): () => void;
  /** Milliseconds, for spacing control updates (tests). */
  now?(): number;
}
