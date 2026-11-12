/**
 * Work alone (docs/actions.md, "Working alone"): for a set time, agents use
 * the kinds of tools and the sites the person picked without asking, so one
 * left alone (a demo, a long task) doesn't stall on a sheet. Everything else
 * asks as it always does, and rules.ts says what it can never cover.
 *
 * Only the person turns it on: `start` asks whether their own hands just
 * pressed in System Settings (the compositor's `input-origin`), so an agent's
 * pointer or keys, a link, a key binding or a tool can't; the pane asks the
 * same (`byPerson`) before it changes a pick. Nothing lengthens or widens it
 * while it runs: `start` is refused, and there is no other way
 * in. Anyone may stop it; stopping only narrows.
 *
 * It ends by itself when the time is up, when the screen locks (unless the
 * person chose to keep it), and when the shell stops (logout): what runs is
 * kept in memory only, so nothing brings it back. A record of what agents
 * did meanwhile is kept (records.ts).
 */

import type { Scope } from "../consent.ts";
import { AloneRecords, CALLS_KEPT } from "./records.ts";
import { cleanConfig, coversSite, coversTool, running } from "./rules.ts";
import type { AloneCall, AloneConfig, AloneEnd, AloneGate, AloneRecord, AloneStart, AloneState, AloneStatus } from "./types.ts";

export interface WorkAloneOptions {
  /** Whether the person's own hands, not an agent's, just pressed in System Settings (agents/person.ts). */
  personPressed(): Promise<boolean>;
  /** Where the records are kept; in memory without. */
  records?: AloneRecords;
}

const OFF: AloneState = { on: false };

export class WorkAlone implements AloneGate {
  private state: AloneState = OFF;
  private calls: AloneCall[] = [];
  private more = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly endListeners = new Set<(record: AloneRecord) => void>();
  readonly records: AloneRecords;

  constructor(private readonly options: WorkAloneOptions) {
    this.records = options.records ?? new AloneRecords(null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AloneState => this.state;

  /** Called with the record each time it ends, except at logout. */
  onEnd(listener: (record: AloneRecord) => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /**
   * Whether the person's own hands just pressed in System Settings. The pane
   * asks before it changes a pick, so an agent's pointer or keys can't widen
   * what the person is about to turn on; not knowing is a no.
   */
  async byPerson(): Promise<boolean> {
    try {
      return await this.options.personPressed();
    } catch {
      return false;
    }
  }

  /**
   * Turn it on, from Settings › Agents. Refused while it is on (nothing
   * lengthens or widens it), when what was picked allows nothing, and unless
   * the person's own press asked for it.
   */
  async start(config: { scopes: readonly unknown[]; sites: readonly unknown[]; minutes: unknown; throughLock?: unknown }): Promise<AloneStart> {
    if (this.state.on) return { ok: false, why: "It is on. Stop it first to change it." };
    const clean = cleanConfig(config);
    if ("problem" in clean) return { ok: false, why: clean.problem };
    if (!(await this.byPerson())) return { ok: false, why: "Only you can turn this on. Press it yourself, here." };
    if (this.state.on) return { ok: false, why: "It is on. Stop it first to change it." };
    this.begin(clean);
    return { ok: true };
  }

  private begin(config: AloneConfig): void {
    const started = Date.now();
    const ends = started + config.minutes * 60_000;
    this.state = { on: true, started, ends, scopes: config.scopes, sites: config.sites, throughLock: config.throughLock };
    this.calls = [];
    this.more = 0;
    this.timer = setTimeout(() => this.stop("time"), ends - started);
    this.changed();
  }

  /** End it now; the record of what agents did, or null when it wasn't on. */
  stop(why: AloneEnd = "stopped"): AloneRecord | null {
    const { state } = this;
    if (!state.on) return null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const record: AloneRecord = {
      started: state.started,
      // A late timer (the computer slept) still ended it when its time was up.
      ended: Math.min(Date.now(), state.ends),
      why,
      scopes: [...state.scopes],
      sites: [...state.sites],
      calls: this.calls,
      more: this.more,
    };
    this.state = OFF;
    this.calls = [];
    this.more = 0;
    this.records.add(record);
    this.changed();
    if (why !== "logout") for (const listener of this.endListeners) listener(record);
    return record;
  }

  /** The screen locked: it ends, unless the person chose to keep it. */
  screenLocked(): void {
    if (this.state.on && !this.state.throughLock) this.stop("locked");
  }

  /** The shell is stopping (logout). */
  close(): void {
    this.stop("logout");
    this.listeners.clear();
    this.endListeners.clear();
  }

  /** Its time is up though the timer hasn't said so yet (a sleep): end it. */
  private live(): AloneState {
    if (this.state.on && !running(this.state, Date.now())) this.stop("time");
    return this.state;
  }

  covers(tool: string, scope: Scope): boolean {
    return coversTool(this.live(), tool, scope, Date.now());
  }

  holds(scope: Scope): boolean {
    return coversTool(this.live(), "", scope, Date.now());
  }

  site(site: string): boolean {
    return coversSite(this.live(), site, Date.now());
  }

  note(call: Omit<AloneCall, "time">): void {
    if (!this.live().on) return;
    if (this.calls.length >= CALLS_KEPT) this.more++;
    else this.calls.push({ time: Date.now(), ...call });
  }

  status(): AloneStatus {
    const state = this.live();
    if (!state.on) return { on: false, secondsLeft: 0, scopes: [], sites: [] };
    return { on: true, secondsLeft: Math.max(0, Math.ceil((state.ends - Date.now()) / 1000)), scopes: [...state.scopes], sites: [...state.sites] };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
