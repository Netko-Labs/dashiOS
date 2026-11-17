/**
 * What the shell's Metal hosts can draw, as their `protocol` lines say, and
 * Reduce Motion carried to each of them (mirin PR #55). An older host
 * refuses a whole tree that uses a prop it does not know, so a surface asks
 * here before it sends one: light weights and Inter Display (`fontWeights`,
 * `displayFont`), `<Dots>` (`dots`), a view's `pulse` (`pulse`). Until a
 * host has said, and whenever one alive did not say it, the answer is no,
 * and the surface draws as it did before.
 *
 * Every host the shell spawns is noted here (`noteHost`, from
 * `spawnShellHost`, the warm hosts and the launcher's resident host). They
 * are one binary in a session, so the answer is the session's: what every
 * host that has spoken and is still alive says.
 */

import type { NativeEvent, NativeHostTransport } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";

export interface HostAbilities {
  /** All nine weights, thin to black. */
  fontWeights: boolean;
  /** `fontFamily: "display"`: Inter Display where installed. */
  displayFont: boolean;
  /** `<Dots>`. */
  dots: boolean;
  /** A view's `pulse`, and the `reduceMotion` line. */
  pulse: boolean;
}

export const NO_ABILITIES: HostAbilities = Object.freeze({ fontWeights: false, displayFont: false, dots: false, pulse: false });

type Host = Pick<NativeHostTransport, "onEvent" | "onClose" | "setReduceMotion">;
type Protocol = Extract<NativeEvent, { type: "protocol" }>;

/** What one host's `protocol` line says of the four. */
export function abilitiesOf(event: Protocol): HostAbilities {
  return { fontWeights: event.fontWeights === true, displayFont: event.displayFont === true, dots: event.dots === true, pulse: event.pulse === true };
}

/** The hosts' abilities and their Reduce Motion: one per shell, `hostAbilities` below. */
export class HostRegistry {
  private readonly said = new Map<Host, HostAbilities>();
  private readonly listeners = new Set<() => void>();
  private abilities: HostAbilities = NO_ABILITIES;
  private reduceMotion = false;

  /** Hear `host`'s protocol line and its end; it gets Reduce Motion now and on every change. */
  note<T extends Host>(host: T): T {
    host.onEvent((event) => {
      if (event.type !== "protocol") return;
      const says = abilitiesOf(event);
      this.said.set(host, says);
      // Its spawn's value may be from before the last change: tell it the one in force.
      if (says.pulse) host.setReduceMotion(this.reduceMotion);
      this.recount();
    });
    host.onClose(() => {
      if (this.said.delete(host)) this.recount();
    });
    return host;
  }

  /** Reduce Motion, as Settings says: every host that takes the line hears a change. */
  setReduceMotion(on: boolean): void {
    if (on === this.reduceMotion) return;
    this.reduceMotion = on;
    for (const [host, says] of this.said) if (says.pulse) host.setReduceMotion(on);
  }

  /** Reduce Motion as last set, for a host's spawn options. */
  reducesMotion(): boolean {
    return this.reduceMotion;
  }

  /** Forget every host heard so far (tests: one test's hosts never reach the next). */
  forget(): void {
    this.said.clear();
    this.recount();
  }

  getSnapshot = (): HostAbilities => this.abilities;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private recount(): void {
    const all = [...this.said.values()];
    const every = (key: keyof HostAbilities) => all.length > 0 && all.every((says) => says[key]);
    const next = { fontWeights: every("fontWeights"), displayFont: every("displayFont"), dots: every("dots"), pulse: every("pulse") };
    const same = (Object.keys(next) as (keyof HostAbilities)[]).every((key) => next[key] === this.abilities[key]);
    if (same) return;
    this.abilities = next;
    for (const listener of this.listeners) listener();
  }
}

/** The shell's hosts. */
export const hostAbilities = new HostRegistry();

/** Note one of the shell's hosts (see `HostRegistry.note`). */
export function noteHost<T extends Host>(host: T): T {
  return hostAbilities.note(host);
}

/** What the shell's hosts can draw; re-renders when that changes. */
export function useHostAbilities(): HostAbilities {
  return useSyncExternalStore(hostAbilities.subscribe, hostAbilities.getSnapshot, hostAbilities.getSnapshot);
}
