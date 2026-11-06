/**
 * The applet's end of the channel (protocol.ts, docs/applets.md): one
 * connection per process, each applet sent whole whenever it changes, the
 * shell's clicks, chosen rows, and popover placements handed back. With a
 * manifest it speaks version 2 (hello first, then popovers and submenus);
 * without one, version 1, as the app kit's client always has. When the shell
 * restarts, the client connects again, says hello again, and sends every
 * applet again; an open popover is dismissed (the shell that placed it is gone).
 *
 *   const applets = new AppletsClient({ path: appletsSocketPath(), manifest });
 *   applets.show({ id: "timer", title: "Timer", glyph: TIMER_SVG, label: "4:59" }, {
 *     onActivate: () => applets.requestPopover("timer", { width: 280, height: 190 }),
 *     onPopover: (placement) => openMyWindowThere(placement),
 *     onDismiss: () => closeMyWindow(),
 *   });
 */

import { existsSync } from "node:fs";
import type { CommandResult, CommandRow } from "./commands.ts";
import { type Manifest, manifestJson } from "./manifest.ts";
import type { MenuRowSpec } from "./menu.ts";
import { type AppletShellMessage, type Placement, PROTOCOL, parseApplet, parseAppletShellMessage } from "./protocol.ts";

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
  connect?(path: string, handlers: SocketHandlers): void;
  exists?(path: string): boolean;
  later?(fn: () => void, ms: number): () => void;
}

const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000] as const;

function bunConnect(path: string, handlers: SocketHandlers): void {
  void Bun.connect({
    unix: path,
    socket: {
      open: (socket) => handlers.open(socket),
      data: (_socket, data) => handlers.data(data),
      drain: () => handlers.drain(),
      close: () => handlers.close(),
      error: () => handlers.close(),
      connectError: () => handlers.close(),
    },
  }).catch(() => handlers.close());
}

function unrefTimeout(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** Splits a byte stream into lines. */
class Lines {
  private pending = "";
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.filter((line) => line.trim() !== "");
  }
}

export class AppletsClient {
  private socket: ClientSocket | null = null;
  private connecting = false;
  private readonly lines = new Map<string, string>();
  private readonly handlers = new Map<string, AppletHandlers>();
  /** Popovers asked for or open, by applet id. */
  private readonly popovers = new Set<string>();
  private unsent = new Uint8Array();
  private retries = 0;
  private cancelRetry: (() => void) | null = null;
  private closed = false;
  private commands: CommandHandlers | null = null;
  /** The protocol the shell answered with; 0 before its welcome. */
  private shellProtocol = 0;
  /** Views asked for or open, by run. */
  private readonly views = new Set<number>();
  private readonly connect: NonNullable<AppletsClientOptions["connect"]>;
  private readonly exists: NonNullable<AppletsClientOptions["exists"]>;
  private readonly later: NonNullable<AppletsClientOptions["later"]>;

  constructor(private readonly options: AppletsClientOptions) {
    this.connect = options.connect ?? bunConnect;
    this.exists = options.exists ?? existsSync;
    this.later = options.later ?? unrefTimeout;
  }

  /** Whether the shell is listening (a Dashi session). */
  get available(): boolean {
    return this.options.path !== null && this.exists(this.options.path);
  }

  /** Whether this client speaks version 2 (it has a manifest). */
  get version(): number {
    return this.options.manifest ? PROTOCOL : 1;
  }

  /** Show or update an applet; `handlers` replace the ones it had when given. Invalid applets are refused here, with the reason on stderr. */
  show(spec: AppletSpec, handlers?: AppletHandlers): boolean {
    const parsed = parseApplet(spec, undefined, this.version >= 2);
    if ("error" in parsed) {
      console.error(`dashi applets: “${spec.id}” not shown: ${parsed.error}`);
      return false;
    }
    if (handlers) this.handlers.set(spec.id, handlers);
    const line = `${JSON.stringify({ type: "applet", applet: spec })}\n`;
    if (this.lines.get(spec.id) === line) return true;
    this.lines.set(spec.id, line);
    if (this.socket) this.write(line);
    else this.start();
    return true;
  }

  remove(id: string): void {
    if (this.popovers.has(id)) this.dismiss(id);
    this.handlers.delete(id);
    if (!this.lines.delete(id)) return;
    if (this.socket) this.write(`${JSON.stringify({ type: "remove", id })}\n`);
  }

  /** Ask for a popover under the item `id`; the placement comes to `onPopover`. Needs a manifest (version 2). */
  requestPopover(id: string, size: { width: number; height: number }): boolean {
    if (this.version < 2 || !this.lines.has(id) || !this.socket) return false;
    this.popovers.add(id);
    this.write(`${JSON.stringify({ type: "popover", id, width: Math.round(size.width), height: Math.round(size.height) })}\n`);
    return true;
  }

  /** The applet closed its popover (Esc, a choice made in it). */
  dismiss(id: string): void {
    if (!this.popovers.delete(id)) return;
    if (this.socket) this.write(`${JSON.stringify({ type: "dismiss", id })}\n`);
  }

  isPopoverOpen(id: string): boolean {
    return this.popovers.has(id);
  }

  /** Answer the launcher's commands (the manifest's `commands`; protocol 3). */
  onCommands(handlers: CommandHandlers | null): void {
    this.commands = handlers;
  }

  /** Whether the shell speaks protocol 3 (it runs commands). */
  get runsCommands(): boolean {
    return this.shellProtocol >= 3;
  }

  /** What run `seq` came to: a line, text to copy, something to open, or why not. */
  result(seq: number, result: CommandResult): void {
    this.answer({ type: "result", seq, ...result });
  }

  /** A pick command's rows for run `seq` (its query). */
  items(seq: number, rows: readonly CommandRow[]): void {
    this.answer({ type: "items", seq, rows });
  }

  /** Run `seq` draws its answer itself, `height` points tall, where the launcher's rows were; the place comes to `onView`. */
  requestView(seq: number, height: number): void {
    this.views.add(seq);
    this.answer({ type: "view", seq, height: Math.round(height) });
  }

  /** The applet closed the view of run `seq` itself. */
  dismissView(seq: number): void {
    if (this.views.delete(seq)) this.answer({ type: "dismiss", seq });
  }

  private answer(message: Record<string, unknown>): void {
    if (this.socket && this.runsCommands) this.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.closed = true;
    this.cancelRetry?.();
    this.socket?.end();
    this.socket = null;
  }

  private start(): void {
    if (this.closed || this.connecting || this.socket || this.lines.size === 0 || !this.available || this.options.path === null) return;
    this.connecting = true;
    const lines = new Lines();
    let done = false;
    this.connect(this.options.path, {
      open: (socket) => {
        this.connecting = false;
        this.socket = socket;
        this.retries = 0;
        this.unsent = new Uint8Array();
        const { manifest, dev } = this.options;
        if (manifest) this.write(`${JSON.stringify({ type: "hello", protocol: PROTOCOL, manifest: manifestJson(manifest), ...(dev ? { dev: true } : {}) })}\n`);
        for (const line of this.lines.values()) this.write(line);
      },
      data: (chunk) => {
        for (const line of lines.push(chunk)) this.receive(line);
      },
      drain: () => this.flush(),
      close: () => {
        if (done) return;
        done = true;
        this.connecting = false;
        this.socket = null;
        this.shellProtocol = 0;
        // The shell that placed them is gone.
        for (const id of [...this.popovers]) {
          this.popovers.delete(id);
          this.handlers.get(id)?.onDismiss?.();
        }
        for (const seq of [...this.views]) {
          this.views.delete(seq);
          this.commands?.onViewDismiss?.(seq);
        }
        if (this.closed) return;
        const wait = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)] ?? 15000;
        this.cancelRetry = this.later(() => this.start(), wait);
      },
    });
  }

  private receive(line: string): void {
    this.options.onMessage?.("in", line);
    const message = parseAppletShellMessage(line);
    if (message) this.handle(message);
  }

  private handle(message: AppletShellMessage): void {
    switch (message.type) {
      case "welcome":
        this.shellProtocol = message.protocol;
        return;
      case "run": {
        const { type: _type, ...run } = message;
        this.commands?.onRun(run);
        return;
      }
      case "view": {
        if (!this.views.has(message.seq)) return;
        const { type: _type, seq, ...placement } = message;
        this.commands?.onView?.(seq, placement);
        return;
      }
      case "dismiss-view":
        if (this.views.delete(message.seq)) this.commands?.onViewDismiss?.(message.seq);
        return;
      case "error":
        console.error(`dashi applets: the shell refused: ${message.message}`);
        return;
      case "activate":
        this.handlers.get(message.id)?.onActivate?.(message.x, message.y);
        return;
      case "select":
        this.handlers.get(message.id)?.onSelect?.(message.item);
        return;
      case "popover": {
        if (!this.popovers.has(message.id)) return;
        const { type: _type, id, ...placement } = message;
        this.handlers.get(id)?.onPopover?.(placement);
        return;
      }
      case "dismiss":
        if (this.popovers.delete(message.id)) this.handlers.get(message.id)?.onDismiss?.();
        return;
    }
  }

  private write(line: string): void {
    this.options.onMessage?.("out", line.trimEnd());
    const bytes = new TextEncoder().encode(line);
    const joined = new Uint8Array(this.unsent.byteLength + bytes.byteLength);
    joined.set(this.unsent);
    joined.set(bytes, this.unsent.byteLength);
    this.unsent = joined;
    this.flush();
  }

  private flush(): void {
    if (!this.socket || this.unsent.byteLength === 0) return;
    const written = Math.max(this.socket.write(this.unsent), 0);
    this.unsent = this.unsent.subarray(written);
  }
}
