/**
 * Extensions' views in the launcher (protocol 6; docs/launcher-extensions.md):
 * a command whose mode is `list`, `grid` or `detail` opens a view the
 * launcher draws from the tree the extension sends (lib/tree-session.ts).
 *
 * When it runs: an extension that shows only in the launcher (`"shows":
 * ["launcher"]`) is not started at login. Opening one of its commands starts
 * it (`wake`), the launcher draws the view's skeleton at once and fills it
 * when the tree comes; a minute after its last view closed it is stopped
 * (`sleep`). Bun in bubblewrap starts in tens of milliseconds
 * (dashi-0.9.0-review/36-launcher-ext/README.md has the measures), so it is
 * not kept warm (store-v2 spec § 6: only past ~250 ms).
 */

import { type AppletCommand, launcherOnly, type Manifest, type PreferenceValue, type ViewMessage, type ViewShellMessage } from "@dashi/applet";
import type { Outcome, Shown } from "../actions/index.ts";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { TreeSession } from "./lib/tree-session.ts";

/** How long an extension may take to start and connect, and then to send its first tree. */
export const START_TIMEOUT_MS = 10_000;
/** When the launcher looks again at a view still starting, to say "Loading…". */
const LOADING_TICK_MS = 320;
/** How long a launcher-only extension stays after its last view closed. */
export const IDLE_STOP_MS = 60_000;

/** A connection that spoke version 6, as the views see it. */
export interface ViewPeer {
  manifest: Manifest;
  send(message: ViewShellMessage): void;
}

export interface ExtensionViewsOptions {
  open(target: string): Promise<Outcome>;
  copy(text: string): Promise<boolean>;
  paste?(text: string): Promise<boolean>;
  preferences(manifest: Manifest): Promise<Record<string, PreferenceValue>>;
  setPreference(manifest: Manifest, name: string, value: PreferenceValue): Promise<boolean>;
  timers?: Timers;
  now?: () => number;
}

/** What starts and stops installed extensions (launcher.ts), connected once it exists. */
export interface Starter {
  /** Start an installed extension that isn't running. */
  ensure(id: string): void;
  /** Stop a launcher-only extension nobody has used for a minute. */
  sleep(id: string): void;
}

export class ExtensionViews {
  private starter: Starter | null = null;
  private readonly peers = new Map<string, ViewPeer>();
  private readonly waiting = new Map<string, Set<(peer: ViewPeer) => void>>();
  private readonly sessions = new Map<number, TreeSession>();
  private readonly idle = new Map<string, unknown>();
  private seq = 0;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly options: ExtensionViewsOptions) {
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => performance.now());
  }

  /** The applets' launcher, once it runs (start.tsx). */
  connect(starter: Starter): void {
    this.starter = starter;
  }

  /** A connection said hello with protocol 6; returns what hears its views' messages, and what lets it go. */
  attach(peer: ViewPeer): { receive(message: ViewMessage): string | null; detach(): void } {
    const id = peer.manifest.id;
    this.peers.set(id, peer);
    for (const resolve of this.waiting.get(id) ?? []) resolve(peer);
    this.waiting.delete(id);
    return {
      receive: (message) => {
        const session = this.sessions.get(message.seq);
        // Only this connection's own views.
        if (!session || this.peers.get(session.manifest.id) !== peer) return null;
        return session.receive(message);
      },
      detach: () => {
        if (this.peers.get(id) !== peer) return;
        this.peers.delete(id);
        for (const session of this.sessions.values()) if (session.manifest.id === id) session.fail(`${peer.manifest.name} stopped.`);
      },
    };
  }

  /** Opens `command`'s view: the launcher shows its skeleton now, and the tree when it comes. */
  open(manifest: Manifest, command: AppletCommand, args: Record<string, string | number | boolean>, dir: string | null): Outcome {
    const seq = ++this.seq;
    const session = new TreeSession(seq, manifest, dir, {
      send: (message) => this.peers.get(manifest.id)?.send(message),
      open: this.options.open,
      copy: this.options.copy,
      ...(this.options.paste ? { paste: this.options.paste } : {}),
      preferences: this.options.preferences,
      setPreference: this.options.setPreference,
      closed: (gone) => this.closed(gone),
      now: this.now,
    });
    this.sessions.set(seq, session);
    const idle = this.idle.get(manifest.id);
    if (idle !== undefined) this.timers.clear(idle);
    this.idle.delete(manifest.id);
    void this.start(session, command, args);
    // "Loading…" once 300 ms went by without a tree (launcher/lib/tree-scope.ts).
    this.timers.set(() => session.tick(), LOADING_TICK_MS);
    const shown: Shown = { kind: "tree", title: command.title, view: session };
    return { ok: true, text: command.title, show: shown };
  }

  private async start(session: TreeSession, command: AppletCommand, args: Record<string, string | number | boolean>): Promise<void> {
    const { manifest } = session;
    const asked = this.now();
    const warm = this.peers.has(manifest.id);
    const peer = this.peers.get(manifest.id) ?? (await this.wake(manifest.id));
    if (!peer) return session.fail(`${manifest.name} didn't start.`);
    session.started(command.id, args, await this.options.preferences(manifest));
    const timer = this.timers.set(() => {
      if (session.snapshot().phase === "starting") session.fail(`${manifest.name} isn't answering.`);
    }, START_TIMEOUT_MS);
    const off = session.subscribe(() => {
      if (session.snapshot().phase === "starting") return;
      this.timers.clear(timer);
      off();
      // DASHI_LAUNCHER_TIMING=1 (launcher/timing.ts): how long from the command chosen to its first tree, started or running.
      if (process.env.DASHI_LAUNCHER_TIMING === "1")
        console.error(`dashi-launcher timing: ${manifest.name} view, ${warm ? "warm" : "cold"}: first tree ${Math.round(this.now() - asked)} ms`);
    });
  }

  /** Starts it and waits for it to connect, or gives up after START_TIMEOUT_MS. */
  private wake(id: string): Promise<ViewPeer | null> {
    return new Promise((resolve) => {
      const waiters = this.waiting.get(id) ?? new Set();
      const done = (peer: ViewPeer | null): void => {
        waiters.delete(found);
        this.timers.clear(timer);
        resolve(peer);
      };
      const found = (peer: ViewPeer): void => done(peer);
      const timer = this.timers.set(() => done(null), START_TIMEOUT_MS);
      waiters.add(found);
      this.waiting.set(id, waiters);
      this.starter?.ensure(id);
    });
  }

  private closed(session: TreeSession): void {
    this.sessions.delete(session.seq);
    const { manifest } = session;
    if (!launcherOnly(manifest) || [...this.sessions.values()].some((each) => each.manifest.id === manifest.id)) return;
    this.idle.set(
      manifest.id,
      this.timers.set(() => {
        this.idle.delete(manifest.id);
        this.starter?.sleep(manifest.id);
      }, IDLE_STOP_MS),
    );
  }

  /** The views open now, for tests. */
  openCount(): number {
    return this.sessions.size;
  }
}
