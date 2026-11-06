/**
 * Applets' commands in the launcher (docs/applets.md, "Commands"): the
 * `commands` of every installed applet that runs, read from its manifest so
 * they are found before it ever has, and those of an applet in development
 * (`dashi-applet dev`) while it is connected. Each is an action at
 * `dashi://applet/<applet id>/<command id>` (docs/actions.md), marked as the
 * applet's (`from`): its row says "Weather", never outranks an exact app or
 * setting, and never wears Dashi's glyph.
 *
 * Running one sends `run` to the applet's connection (protocol 3) and waits
 * for what it comes to, by `seq`:
 * - instant: a `result` (a line for the launcher, text to copy, something to open, or why not);
 * - pick: the launcher asks for `items` as the person types (launcher/budget.ts holds it to
 *   80 ms), and a chosen row runs again with `item`;
 * - view: the applet answers `view` with a height; the launcher says where its rows were,
 *   the applet gets the layer shell for as long as it is shown (as for a popover), and its
 *   own Metal host draws there.
 * The commands run in the applet's sandbox, as everything it does.
 */

import { join } from "node:path";
import {
  type AppletCommand,
  type AppletMessage,
  type AppletShellMessage,
  argSchema,
  type CommandResult,
  type CommandRow,
  checkArgs,
  type InstalledApplet,
  isRefusal,
  type Manifest,
} from "@dashi/applet";
import { formatAddress } from "../actions/address.ts";
import { type ActionDef, type ActionSource, failed, invalid, type Outcome, ok, type PickRow, ready, type Shown, type ViewFrame } from "../actions/types.ts";

/** How long an instant command, a chosen row, or a view's answer may take before it is given up. */
export const COMMAND_TIMEOUT_MS = 10_000;
/** How long a pick command's rows may take before the ask fails (the launcher says "slow" after 80 ms). */
export const ROWS_TIMEOUT_MS = 5_000;

/** A connection that spoke version 3, as the commands see it. */
export interface CommandPeer {
  manifest: Manifest;
  /** An applet in development (`dashi-applet dev`): its own manifest is the one being worked on, over an installed copy's. */
  dev?: boolean;
  send(message: AppletShellMessage): void;
  /** The layer shell for its process: on while its view is shown. */
  grant(on: boolean): Promise<void>;
}

/** What came back for one run. */
type Answer = { kind: "result"; result: CommandResult } | { kind: "items"; rows: CommandRow[] } | { kind: "view"; height: number };

/** The messages about a run, from the applet. */
export type CommandMessage = Extract<AppletMessage, { type: "result" | "items" | "view" | "dismiss-view" }>;

export interface CommandTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: CommandTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AppletCommandsOptions {
  /** Put a result's `copy` on the clipboard; whether it went. */
  copy(text: string): Promise<boolean>;
  /** Open a result's `open`: a web page, or a `dashi://` address (as a link from outside: actions/run.ts). */
  open(target: string): Promise<Outcome>;
  /** Where the launcher's surface is: its screen, and its top-left corner in that screen's points. */
  launcherOrigin(): Promise<{ output: string | null; x: number; y: number } | null>;
  timers?: CommandTimers;
}

interface Pending {
  peer: CommandPeer;
  resolve(answer: Answer): void;
  timer: unknown;
}

interface OpenView {
  seq: number;
  peer: CommandPeer;
  closed: Set<() => void>;
}

/** A command's address. */
export const commandAddress = (appletId: string, commandId: string): string => formatAddress(["applet", appletId, commandId]);

export class AppletCommands implements ActionSource {
  readonly id = "applets";
  private installed: ReadonlyArray<Pick<InstalledApplet, "manifest" | "dir">> = [];
  /** The newest connection of each applet, by its id. */
  private readonly peers = new Map<string, CommandPeer>();
  private current: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private view: OpenView | null = null;
  private readonly timers: CommandTimers;

  constructor(private readonly options: AppletCommandsOptions) {
    this.timers = options.timers ?? realTimers;
  }

  actions = (): readonly ActionDef[] => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The installed applets that run (applets/launcher.ts, after each look). */
  setInstalled(applets: ReadonlyArray<Pick<InstalledApplet, "manifest" | "dir">>): void {
    this.installed = applets;
    this.rebuild();
  }

  /** A connection said hello with protocol 3; returns what hears its messages, and what lets it go. */
  attach(peer: CommandPeer): { receive(message: CommandMessage): void; detach(): void } {
    this.peers.set(peer.manifest.id, peer);
    this.rebuild();
    return {
      receive: (message) => this.receive(peer, message),
      detach: () => {
        if (this.peers.get(peer.manifest.id) === peer) this.peers.delete(peer.manifest.id);
        for (const [seq, waiting] of this.pending)
          if (waiting.peer === peer) this.settle(seq, { kind: "result", result: { error: `${peer.manifest.name} stopped.` } });
        if (this.view?.peer === peer) this.endView(false);
        this.rebuild();
      },
    };
  }

  private rebuild(): void {
    const byId = new Map<string, { manifest: Manifest; dir: string | null }>();
    for (const applet of this.installed) byId.set(applet.manifest.id, { manifest: applet.manifest, dir: applet.dir });
    // One in development: its own manifest while it is connected, even over an installed copy of the
    // same applet (the developer's commands are the ones being tried, not the older install's).
    for (const peer of this.peers.values()) if (peer.dev || !byId.has(peer.manifest.id)) byId.set(peer.manifest.id, { manifest: peer.manifest, dir: null });
    this.current = [...byId.values()].flatMap(({ manifest, dir }) => manifest.commands.map((command) => this.action(manifest, command, dir)));
    for (const listener of this.listeners) listener();
  }

  private action(manifest: Manifest, command: AppletCommand, dir: string | null): ActionDef {
    const { properties, required } = argSchema(command);
    return {
      address: commandAddress(manifest.id, command.id),
      title: command.title,
      description: "",
      keywords: { en: [...command.keywords, manifest.name] },
      kind: command.mode === "pick" ? "pick" : command.mode === "view" ? "open" : "run",
      properties,
      ...(required.length > 0 ? { required } : {}),
      scope: null,
      readOnly: false,
      destructive: false,
      who: "person",
      source: "applets",
      from: manifest.name,
      ...(dir && manifest.icon ? { icon: join(dir, manifest.icon) } : {}),
      check: (args) => {
        const values = checkArgs(command, args);
        if (isRefusal(values)) return invalid(values.error);
        return ready(() => this.start(manifest, command, values.values));
      },
    };
  }

  private async start(manifest: Manifest, command: AppletCommand, args: Record<string, string | number | boolean>): Promise<Outcome> {
    const peer = this.peers.get(manifest.id);
    if (!peer) return failed(`${manifest.name} isn't running.`);
    if (command.mode === "pick") {
      const shown: Shown = {
        kind: "pick",
        title: command.title,
        ask: async (query) => {
          const answer = await this.ask(peer, { command: command.id, args, query }, ROWS_TIMEOUT_MS);
          if (answer.kind === "items") return answer.rows;
          throw new Error(answer.kind === "result" && "error" in answer.result ? answer.result.error : `${manifest.name} gave no rows.`);
        },
        choose: async (row: PickRow) => this.outcome(manifest, await this.ask(peer, { command: command.id, args, item: row.id }, COMMAND_TIMEOUT_MS)),
      };
      return { ok: true, text: command.title, show: shown };
    }
    const answer = await this.ask(peer, { command: command.id, args }, COMMAND_TIMEOUT_MS);
    if (answer.kind !== "view") return this.outcome(manifest, answer);
    if (command.mode !== "view") return failed(`${manifest.name} answered “${command.title}” with a view.`);
    return { ok: true, text: command.title, show: this.shownView(answer.seq, peer, command.title, answer.height) };
  }

  /** What a run came to, as the launcher (or a link) takes it. */
  private async outcome(manifest: Manifest, answer: Answer): Promise<Outcome> {
    if (answer.kind !== "result") return failed(`${manifest.name} answered with something else.`);
    const result = answer.result;
    if ("error" in result) return failed(result.error);
    if ("text" in result) return { ok: true, text: result.text, show: { kind: "text", text: result.text } };
    if ("copy" in result) return (await this.options.copy(result.copy)) ? ok("Copied") : failed("Couldn't copy");
    return this.options.open(result.open);
  }

  /** Send `run` and wait for its answer (or give up after `ms`). */
  private ask(
    peer: CommandPeer,
    run: { command: string; args: Record<string, string | number | boolean>; query?: string; item?: string },
    ms: number,
  ): Promise<Answer & { seq: number }> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = this.timers.set(() => this.settle(seq, { kind: "result", result: { error: `${peer.manifest.name} didn't answer.` } }), ms);
      this.pending.set(seq, { peer, timer, resolve: (answer) => resolve({ ...answer, seq }) });
      peer.send({ type: "run", seq, ...run });
    });
  }

  private settle(seq: number, answer: Answer): void {
    const waiting = this.pending.get(seq);
    if (!waiting) return;
    this.pending.delete(seq);
    this.timers.clear(waiting.timer);
    waiting.resolve(answer);
  }

  private receive(peer: CommandPeer, message: CommandMessage): void {
    if (message.type === "dismiss-view") {
      if (this.view?.seq === message.seq && this.view.peer === peer) this.endView(false);
      return;
    }
    // Only an answer to this connection's own run counts.
    if (this.pending.get(message.seq)?.peer !== peer) return;
    if (message.type === "result") this.settle(message.seq, { kind: "result", result: message.result });
    else if (message.type === "items") this.settle(message.seq, { kind: "items", rows: message.rows });
    else this.settle(message.seq, { kind: "view", height: message.height });
  }

  private shownView(seq: number, peer: CommandPeer, title: string, height: number): Shown {
    if (this.view) this.endView(true);
    const open: OpenView = { seq, peer, closed: new Set() };
    this.view = open;
    return {
      kind: "view",
      title,
      height,
      place: (frame: ViewFrame) => void this.placeView(open, frame),
      close: () => {
        if (this.view === open) this.endView(true);
      },
      onClose: (listener) => {
        open.closed.add(listener);
      },
    };
  }

  private async placeView(open: OpenView, frame: ViewFrame): Promise<void> {
    const origin = await this.options.launcherOrigin();
    if (this.view !== open || !origin) return;
    try {
      await open.peer.grant(true);
    } catch (error) {
      console.error(`dashi-shell: ${open.peer.manifest.name}'s view wasn't granted:`, error);
      return this.endView(true);
    }
    if (this.view !== open) return;
    open.peer.send({
      type: "view",
      seq: open.seq,
      namespace: `dashi.applet.${open.peer.manifest.id}.view`,
      x: Math.round(origin.x + frame.x),
      y: Math.round(origin.y + frame.y),
      width: Math.round(frame.width),
      height: Math.round(frame.height),
      output: origin.output,
    });
  }

  /** The view goes; `tell` sends `dismiss` (the launcher closed it, not the applet). */
  private endView(tell: boolean): void {
    const open = this.view;
    if (!open) return;
    this.view = null;
    void open.peer.grant(false).catch(() => {});
    if (tell) open.peer.send({ type: "dismiss-view", seq: open.seq });
    for (const listener of open.closed) listener();
  }
}
