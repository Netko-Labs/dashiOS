/**
 * The graphics card, as the shell runs it: the mode cardwire is in and the
 * one the policy wants (policy.ts), who holds the card (holders.ts), whether
 * it is awake, and whether it was lost (lost-card.ts). Automatic switching
 * runs here; the menu, Control Center and Settings read the snapshot and
 * call `choose`, `keepHybrid` and `quit`.
 *
 * Without cardwire there is no mode to show or set, but on a two-GPU machine
 * the holders still are (the card stays awake for them in any mode). On a
 * one-GPU machine there is nothing at all, and every surface leaves its
 * graphics part out.
 */

import { useSyncExternalStore } from "react";
import type { GraphicsChoice } from "../power/modes/settings.ts";
import { type CardPower, type GraphicsCard, readCardPower, readCardScreens } from "./card.ts";
import type { AppPolicy, CardwireGpu, CardwireMode, GraphicsBackend } from "./cardwire.ts";
import { groupHolders, type Holder, holdingProcesses, type ProcessFds, readCardWatts, readProcessFds } from "./holders.ts";
import type { Loss } from "./lost-card.ts";
import { decideGraphics, type GraphicsDecision, type GraphicsMode, listNames } from "./policy.ts";

export const GRAPHICS_REFRESH_MS = 15_000;

export interface GraphicsSnapshot {
  /** There is a graphics card (two GPUs). */
  hasCard: boolean;
  /** cardwire runs: the mode can be shown and set. */
  switchable: boolean;
  choice: GraphicsChoice;
  mode: CardwireMode | null;
  decision: GraphicsDecision | null;
  holders: readonly Holder[];
  power: CardPower;
  lost: Loss | null;
  cards: readonly CardwireGpu[];
  allowed: readonly AppPolicy[];
}

export interface GraphicsDeps {
  card: GraphicsCard | null;
  backend: GraphicsBackend | null;
  choice(): GraphicsChoice;
  saveChoice(choice: GraphicsChoice): void;
  /** The app a process belongs to, by its windows (and its parents'); null when it has none. */
  appOf?(pid: number): string | null;
  /** Says once that switching waits for apps: their names, and how to quit them. */
  sayWaiting?(names: readonly string[], quit: () => void, keepHybrid: () => void): void;
  /** For tests. */
  processes?(): ProcessFds[];
  screens?(): string[];
  power?(): CardPower;
  cardWatts?(): number | null;
  signal?(pid: number): void;
}

export class GraphicsController {
  private snapshot: GraphicsSnapshot;
  private readonly listeners = new Set<() => void>();
  private plugged = true;
  /** "Keep Hybrid" from the waiting notice: held until the cable changes. */
  private keep = false;
  private saidWaiting = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopMode: (() => void) | null = null;

  constructor(private readonly deps: GraphicsDeps) {
    this.snapshot = {
      hasCard: deps.card !== null,
      switchable: false,
      choice: deps.choice(),
      mode: null,
      decision: null,
      holders: [],
      power: "unknown",
      lost: null,
      cards: [],
      allowed: [],
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GraphicsSnapshot => this.snapshot;

  async start(): Promise<void> {
    if (!this.deps.card) return;
    const backend = this.deps.backend;
    if (backend) {
      void backend.takeOver();
      this.stopMode = backend.onModeChanged((mode) => {
        this.publish({ mode });
        void this.decide();
      });
      const [mode, cards, allowed] = await Promise.all([backend.mode(), backend.gpus(), backend.allowed()]);
      this.publish({ switchable: mode !== null, mode, cards, allowed });
    }
    this.timer = setInterval(() => void this.refresh(), GRAPHICS_REFRESH_MS);
    await this.refresh();
  }

  close(): void {
    clearInterval(this.timer);
    this.stopMode?.();
  }

  setPlugged(plugged: boolean): void {
    if (plugged === this.plugged) return;
    this.plugged = plugged;
    this.keep = false;
    this.saidWaiting = false;
    void this.decide();
  }

  settingsChanged(): void {
    const choice = this.deps.choice();
    if (choice === this.snapshot.choice) return;
    this.publish({ choice });
    void this.decide();
  }

  choose(choice: GraphicsChoice): void {
    this.keep = false;
    this.deps.saveChoice(choice);
    this.publish({ choice });
    void this.decide();
  }

  /** The waiting notice's "Keep Hybrid". */
  keepHybrid(): void {
    this.keep = true;
    void this.decide();
  }

  /** The card was lost: the tile says so and Automatic stops until restart. */
  setLost(loss: Loss): void {
    this.publish({ lost: loss });
    void this.decide();
  }

  /**
   * Quits one holder (its pids, exactly), or all of them. Who holds the card
   * is read again first: a pid from the last look may be another process's now.
   */
  quit(name?: string): void {
    const card = this.deps.card;
    if (!card) return;
    const signal =
      this.deps.signal ??
      ((pid: number) => {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Gone already.
        }
      });
    const now = groupHolders(this.holdingNow(card), this.nameOf, [], null);
    for (const holder of now) if (name === undefined || holder.name === name) for (const pid of holder.pids) signal(pid);
    setTimeout(() => void this.refresh(), 1500);
  }

  /** Reads the holders, the card's screens and its power state again (the battery menu asks before it opens). */
  async refresh(): Promise<void> {
    const card = this.deps.card;
    if (!card) return;
    const processes = this.holdingNow(card);
    const unseen = this.deps.backend && this.snapshot.cards.length > 0 ? await this.unseenHolders() : [];
    const holders = groupHolders(processes, this.nameOf, unseen, this.deps.cardWatts ? this.deps.cardWatts() : readCardWatts(card.pci));
    this.publish({ holders, power: this.deps.power?.() ?? readCardPower(card.pci) });
    await this.decide();
  }

  private holdingNow(card: GraphicsCard): ProcessFds[] {
    return holdingProcesses(this.deps.processes?.() ?? readProcessFds(), card.nodes);
  }

  /** A holder's name: its app's, from its windows; else the process name. */
  private readonly nameOf = (pid: number, comm: string): string => this.deps.appOf?.(pid) ?? comm;

  private async unseenHolders(): Promise<string[]> {
    const backend = this.deps.backend;
    const gpu = this.snapshot.cards.find((each) => !each.isDefault && each.pci === this.deps.card?.pci) ?? this.snapshot.cards.find((each) => each.discrete);
    return backend && gpu ? backend.holders(gpu).catch(() => []) : [];
  }

  private async decide(): Promise<void> {
    if (!this.deps.card) return;
    const choice: GraphicsChoice = this.keep && this.snapshot.choice === "automatic" ? "hybrid" : this.snapshot.choice;
    const current = this.snapshot.mode;
    const decision = decideGraphics({
      choice,
      plugged: this.plugged,
      cardScreens: this.deps.screens?.() ?? readCardScreens(this.deps.card),
      holders: this.snapshot.holders.map((holder) => holder.name),
      current: current === null ? null : current,
      lost: this.snapshot.lost !== null,
    });
    this.publish({ decision });
    if (decision.waitingFor.length > 0 && !this.saidWaiting && this.snapshot.switchable) {
      this.saidWaiting = true;
      this.deps.sayWaiting?.(
        decision.waitingFor,
        () => this.quit(),
        () => this.keepHybrid(),
      );
    }
    if (decision.set && this.snapshot.switchable && this.deps.backend) {
      const ok = await this.deps.backend.setMode(decision.set);
      if (ok) this.publish({ mode: decision.set });
    }
  }

  private publish(change: Partial<GraphicsSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

export function useGraphics(controller: GraphicsController): GraphicsSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

/** The card's state in a few words: "Graphics card asleep", "In use by Steam", "Not responding". */
export function cardState(snapshot: GraphicsSnapshot): string {
  if (snapshot.lost) return "Not responding";
  if (snapshot.holders.length > 0) return `In use by ${listNames(snapshot.holders.map((holder) => holder.name))}`;
  if (snapshot.power === "suspended") return "Asleep";
  if (snapshot.power === "active") return "Awake";
  return "";
}

/** The mode the tile shows: cardwire's, else what was wanted. */
export function shownMode(snapshot: GraphicsSnapshot): GraphicsMode | null {
  const mode = snapshot.mode;
  if (mode === "integrated" || mode === "hybrid" || mode === "smart") return mode;
  return snapshot.decision?.wanted ?? null;
}
