/** The chip's one value: what shows now, a notice that goes by itself, and the rest state (nothing, or that the conversation is still open). */

import type { Timers } from "../../shared/time/index.ts";
import type { Chip, ChipGo, Talk } from "../types.ts";
import { head } from "./captions.ts";

/** How long a notice stays. */
export const NOTICE_MS = 4000;

export class ChipStore {
  private chip: Chip | null = null;
  private readonly listeners = new Set<() => void>();
  private noticeTimer: unknown = null;
  private readonly offTalk: (() => void) | undefined;

  constructor(
    private readonly timers: Timers,
    private readonly talk: Talk | undefined,
    /** The chip changed: the keys held follow what there is to stop. */
    private readonly changed: () => void,
  ) {
    // The conversation closed by itself, or opened: the chip that only says it is open follows.
    this.offTalk = talk?.subscribe(() => (this.chip === null || this.chip.kind === "open") && this.rest());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Chip | null => this.chip;

  show(chip: Chip | null): void {
    if (this.noticeTimer !== null) this.timers.clear(this.noticeTimer);
    this.noticeTimer = null;
    this.chip = chip;
    for (const listener of [...this.listeners]) listener();
    this.changed();
  }

  /** Nothing to show: the chip goes, or says that the conversation is still open. `quiet` when Dashi just went quiet (its clock starts). */
  rest(quiet = false): void {
    if (quiet) this.talk?.rested();
    this.show(this.talk?.open() ? { kind: "open" } : null);
  }

  /** Words where the person is looking, for a while. */
  notice(text: string, go?: ChipGo, ms = NOTICE_MS): void {
    this.show({ kind: "notice", text: head(text, 90), ...(go ? { go } : {}) });
    this.noticeTimer = this.timers.set(() => this.rest(), ms);
  }

  close(): void {
    this.offTalk?.();
    if (this.noticeTimer !== null) this.timers.clear(this.noticeTimer);
  }
}
