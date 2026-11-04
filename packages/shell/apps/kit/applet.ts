/**
 * A program's own items in Dashi's menu bar (src/applets/protocol.ts,
 * docs/applets.md): one connection per process to
 * `$XDG_RUNTIME_DIR/dashi-applets.sock`, each applet sent whole whenever it
 * changes, and the shell's clicks and chosen rows handed back. When the
 * shell restarts, the client connects again and sends every applet again.
 * Outside Dashi (no socket) nothing is shown.
 *
 *   const applets = appletsClient();
 *   applets.show({ id: "timer", title: "Timer", glyph: TIMER_SVG, label: "4:59",
 *     menu: [{ id: "stop", label: "Stop Timer" }] }, {
 *     onSelect: (item) => item === "stop" && stop(),
 *   });
 *   applets.show({ id: "timer", title: "Timer", glyph: TIMER_SVG, label: "4:58", menu }); // a tick: same handlers
 *   applets.remove("timer");
 */

import { existsSync } from "node:fs";
import { appletsSocketPath, parseApplet, parseAppletShellMessage } from "../../src/applets/protocol.ts";
import { LineBuffer } from "../../src/lines.ts";
import type { MenuItemSpec, MenuSocket, MenuSocketHandlers } from "./menus.ts";

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
  menu?: readonly MenuItemSpec[];
  /** What a click does: open the menu (the default with a menu) or call `onActivate`. */
  click?: "activate" | "menu";
  attention?: boolean;
}

export interface AppletHandlers {
  /** A click, with where it was on the screen (for a window of your own to open near). */
  onActivate?(x: number, y: number): void;
  onSelect?(item: string): void;
}

export interface AppletsClientOptions {
  path: string | null;
  connect?(path: string, handlers: MenuSocketHandlers): void;
  exists?(path: string): boolean;
  later?(fn: () => void, ms: number): () => void;
}

const RETRY_MS = [1000, 2000, 4000, 8000, 15000] as const;

function bunConnect(path: string, handlers: MenuSocketHandlers): void {
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

export class AppletsClient {
  private socket: MenuSocket | null = null;
  private connecting = false;
  private readonly lines = new Map<string, string>();
  private readonly handlers = new Map<string, AppletHandlers>();
  private unsent = new Uint8Array();
  private retries = 0;
  private cancelRetry: (() => void) | null = null;
  private closed = false;
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

  /** Show or update an applet; `handlers` replace the ones it had when given. Invalid applets are refused here, with the reason on stderr. */
  show(spec: AppletSpec, handlers?: AppletHandlers): void {
    const parsed = parseApplet(spec);
    if ("error" in parsed) {
      console.error(`dashi applets: “${spec.id}” not shown: ${parsed.error}`);
      return;
    }
    if (handlers) this.handlers.set(spec.id, handlers);
    const line = `${JSON.stringify({ type: "applet", applet: spec })}\n`;
    if (this.lines.get(spec.id) === line) return;
    this.lines.set(spec.id, line);
    if (this.socket) this.write(line);
    else this.start();
  }

  remove(id: string): void {
    this.handlers.delete(id);
    if (!this.lines.delete(id)) return;
    if (this.socket) this.write(`${JSON.stringify({ type: "remove", id })}\n`);
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
    const lines = new LineBuffer();
    let done = false;
    this.connect(this.options.path, {
      open: (socket) => {
        this.connecting = false;
        this.socket = socket;
        this.retries = 0;
        this.unsent = new Uint8Array();
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
        if (this.closed) return;
        const wait = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)] ?? 15000;
        this.cancelRetry = this.later(() => this.start(), wait);
      },
    });
  }

  private receive(line: string): void {
    const message = parseAppletShellMessage(line);
    if (!message) return;
    if (message.type === "error") console.error(`dashi applets: the shell refused: ${message.message}`);
    else if (message.type === "activate") this.handlers.get(message.id)?.onActivate?.(message.x, message.y);
    else this.handlers.get(message.id)?.onSelect?.(message.item);
  }

  private write(line: string): void {
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

let shared: AppletsClient | null = null;

/** The process's applets connection. */
export function appletsClient(): AppletsClient {
  shared ??= new AppletsClient({ path: appletsSocketPath() });
  return shared;
}
