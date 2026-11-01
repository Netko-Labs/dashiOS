/**
 * How far an autohiding Dock is slid out of view, 0 (in place) to 1 (all the
 * way down). A layer surface cannot move after it opens, so the slide is the
 * Dock's content moving inside its surface, driven from here; the surface is
 * opened when the slide starts and ended when it finishes (presenter.ts).
 */

import { View } from "@mirinjs/metal";
import { type ReactElement, useSyncExternalStore } from "react";

const FRAME_MS = 16;

/** Slow at both ends, quick between. */
export const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Slide {
  private position: number;
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private durationMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private armed: { to: number; ms: number; fallback: ReturnType<typeof setTimeout> } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(position = 0) {
    this.position = position;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.position;

  get settled(): boolean {
    return this.timer === null && this.armed === null;
  }

  /** Put the Dock at `position` now. */
  jump(position: number): void {
    this.stop();
    this.set(position);
  }

  /**
   * Slide to `position` once `ready` is called: a Dock's host takes a moment to open, and a slide that
   * runs meanwhile is over before anything is on screen. If the host never says, it slides after `waitMs`.
   */
  arm(position: number, ms: number, waitMs = 500): void {
    this.stop();
    this.armed = { to: position, ms, fallback: setTimeout(() => this.ready(), waitMs) };
  }

  /** The Dock's host painted: an armed slide starts. */
  ready(): void {
    const armed = this.armed;
    if (!armed) return;
    this.animateTo(armed.to, armed.ms);
  }

  /** Slide to `position` over `ms`, from wherever the Dock is (a slide that was under way turns around). */
  animateTo(position: number, ms: number): void {
    this.stop();
    if (ms <= 0 || position === this.position) return this.set(position);
    this.from = this.position;
    this.to = position;
    this.elapsed = 0;
    this.durationMs = ms;
    this.timer = setInterval(() => this.step(FRAME_MS), FRAME_MS);
  }

  /** Advance a running slide by `dt` ms (the timer's frame; tests call it directly). */
  step(dt: number): void {
    if (this.timer === null) return;
    this.elapsed = Math.min(this.durationMs, this.elapsed + dt);
    const t = this.elapsed / this.durationMs;
    if (t >= 1) {
      this.stop();
      this.set(this.to);
    } else {
      this.set(this.from + (this.to - this.from) * ease(t));
    }
  }

  close(): void {
    this.stop();
    this.listeners.clear();
  }

  /** Whatever is under way or waiting ends. */
  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.armed) clearTimeout(this.armed.fallback);
    this.armed = null;
  }

  private set(position: number): void {
    if (position === this.position) return;
    this.position = position;
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

export function useSlide(slide: Slide): number {
  return useSyncExternalStore(slide.subscribe, slide.getSnapshot);
}
