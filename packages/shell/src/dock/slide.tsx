/**
 * How the Dock (or the taskbar) comes and goes. A layer surface cannot move
 * after it opens, so the motion is the Dock's content moving inside its
 * surface, driven from here; the surface is opened when an entrance starts
 * and ended when an exit finishes (presenter.ts).
 *
 * One clock, two readings: `position`, how far the panel is slid out of view
 * (0 in place, 1 all the way down), and `rise`, how far the entrance has got
 * (0 just started, 1 settled), from which each icon rises a beat after the
 * one before it (`iconRise`). Coming in, the panel decelerates up into place
 * and fades in while the icons follow with a small spring; going out, it
 * drops away quickly and the icons stay put. With Reduce Motion it is simply
 * there, or gone.
 */

import { View } from "@mirinjs/metal";
import { type ReactElement, useSyncExternalStore } from "react";
import { springOut } from "../shared/controls/motion.ts";

const FRAME_MS = 16;

/** The entrance and exit, in ms (docs/design.html, Motion). */
export const DOCK_MOTION = {
  /** The panel rising into place. */
  showMs: 420,
  /** The whole entrance, the last icon's settle included. */
  entranceMs: 640,
  /** The panel dropping away. */
  hideMs: 180,
  /** Between one icon's start and the next's. */
  staggerMs: 22,
  /** One icon's rise. */
  iconMs: 380,
  /** How far below its place an icon starts, in px. */
  iconDrop: 14,
} as const;

/** Slow at both ends, quick between. */
export const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** Quick, then a long gentle landing. */
export const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
/** Slow to leave, then quick. */
export const easeInCubic = (t: number): number => t * t * t;

export interface SlideState {
  position: number;
  rise: number;
}

/**
 * Icon `index`'s share of an entrance at `rise`: how far below its place it
 * is (px) and how opaque. Settled (0, 1) once `rise` is 1.
 */
export function iconRise(rise: number, index: number): { offset: number; opacity: number } {
  if (rise >= 1) return { offset: 0, opacity: 1 };
  const { entranceMs, staggerMs, iconMs, iconDrop, showMs } = DOCK_MOTION;
  // The icons start as the panel is a third of the way up.
  const start = showMs / 3 + Math.min(index, 12) * staggerMs;
  const t = Math.min(1, Math.max(0, (rise * entranceMs - start) / iconMs));
  return { offset: (1 - springOut(t)) * iconDrop, opacity: Math.min(1, t * 2.5) };
}

/** The panel's opacity during an entrance: it fades in over the first half of its rise. */
export function panelOpacity(state: SlideState): number {
  if (state.rise >= 1) return 1 - state.position;
  return Math.min(1, (state.rise * DOCK_MOTION.entranceMs) / (DOCK_MOTION.showMs / 2));
}

type Motion = { kind: "in" | "out"; from: number; elapsed: number };

export class Slide {
  private state: SlideState;
  private motion: Motion | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private armed: { fallback: ReturnType<typeof setTimeout> } | null = null;
  private readonly listeners = new Set<() => void>();

  /** `reduceMotion`: Reduce Motion is on (Settings → Appearance), asked at each entrance and exit. */
  constructor(
    position = 0,
    private readonly reduceMotion: () => boolean = () => false,
  ) {
    this.state = { position, rise: 1 };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SlideState => this.state;

  get position(): number {
    return this.state.position;
  }

  get settled(): boolean {
    return this.timer === null && this.armed === null;
  }

  /** Put the Dock at `position`, settled, now. */
  jump(position: number): void {
    this.stop();
    this.set({ position, rise: 1 });
  }

  /**
   * Come in once `ready` is called: a Dock's host takes a moment to open, and an entrance that runs
   * meanwhile is over before anything is on screen. If the host never says, it comes in after `waitMs`.
   */
  armEntrance(waitMs = 500): void {
    this.stop();
    this.set({ position: 1, rise: 0 });
    this.armed = { fallback: setTimeout(() => this.ready(), waitMs) };
  }

  /** The Dock's host painted: an armed entrance starts. */
  ready(): void {
    if (!this.armed) return;
    this.show();
  }

  /** Come in from wherever the Dock is (an exit under way turns around). */
  show(): void {
    this.stop();
    if (this.reduceMotion()) return this.set({ position: 0, rise: 1 });
    if (this.state.position === 0 && this.state.rise >= 1) return;
    // From part way down the icons are still there: only a Dock coming from out of sight replays them.
    const rise = this.state.position >= 1 ? 0 : 1;
    this.set({ position: this.state.position, rise });
    this.run({ kind: "in", from: this.state.position, elapsed: 0 });
  }

  /** Go out of view, from wherever the Dock is. */
  hide(): void {
    this.stop();
    if (this.reduceMotion()) return this.set({ position: 1, rise: 1 });
    if (this.state.position === 1) return;
    this.set({ position: this.state.position, rise: 1 });
    this.run({ kind: "out", from: this.state.position, elapsed: 0 });
  }

  /** Advance what is under way by `dt` ms (the timer's frame; tests call it directly). */
  step(dt: number): void {
    const motion = this.motion;
    if (!motion) return;
    motion.elapsed += dt;
    if (motion.kind === "in") {
      const t = Math.min(1, motion.elapsed / DOCK_MOTION.showMs);
      const rise = this.state.rise >= 1 ? 1 : Math.min(1, motion.elapsed / DOCK_MOTION.entranceMs);
      const position = motion.from * (1 - easeOutQuint(t));
      const done = t >= 1 && rise >= 1;
      if (done) this.stop();
      this.set({ position: done ? 0 : position, rise: done ? 1 : rise });
      return;
    }
    const t = Math.min(1, motion.elapsed / DOCK_MOTION.hideMs);
    if (t >= 1) this.stop();
    this.set({ position: t >= 1 ? 1 : motion.from + (1 - motion.from) * easeInCubic(t), rise: 1 });
  }

  close(): void {
    this.stop();
    this.listeners.clear();
  }

  private run(motion: Motion): void {
    this.motion = motion;
    this.timer = setInterval(() => this.step(FRAME_MS), FRAME_MS);
  }

  /** Whatever is under way or waiting ends where it is. */
  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.motion = null;
    if (this.armed) clearTimeout(this.armed.fallback);
    this.armed = null;
  }

  private set(state: SlideState): void {
    if (state.position === this.state.position && state.rise === this.state.rise) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/**
 * An empty view that says the host painted: Metal reports a view's layout once its bounds are known,
 * which is the first thing a new host does. A Dock view renders one.
 */
export function Painted({ slide }: { slide: Slide | null }): ReactElement {
  return <View testID="dock-painted" onLayout={() => slide?.ready()} style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1 }} />;
}

export function useSlide(slide: Slide): SlideState {
  return useSyncExternalStore(slide.subscribe, slide.getSnapshot);
}
