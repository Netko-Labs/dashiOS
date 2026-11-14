/**
 * The Desktops agents added (`work_in_space "new"`) and have left: each goes
 * once nothing is on it and the person is not looking at it (decisions.md
 * D89, D118). An agent's leaving is only the first moment to look: its
 * window may still be closing as its connection drops, a plan lets its
 * Desktop go 30 s after its last step with its window still open, and the
 * person may be on it. So a Desktop that could not go then is kept here and
 * looked at again when a window closes or moves, when the screen goes to
 * another Desktop, and when an agent stops working on one. Never a Desktop
 * no agent added. Nothing is kept on disk: one left over when the shell
 * restarts stays until the person closes it.
 */

import type { Compositor } from "../../compositor/index.ts";
import type { SpaceRef } from "../../spaces/index.ts";

/** The Desktops as agents need them: SpacesController (spaces/). */
export interface AgentSpaces {
  getSnapshot(): { count: number; current: number; labels: readonly string[]; fullscreen: readonly (number | null)[] };
  /** A new Space at the end: its index, or null at the limit. */
  add(): Promise<number | null>;
  remove(index: number): Promise<void>;
  follow(index: number): SpaceRef;
  unfollow(ref: SpaceRef): void;
}

export class AddedSpaces {
  private readonly waiting = new Set<SpaceRef>();
  private stop: (() => void) | null = null;
  private last: Promise<void> = Promise.resolve();

  constructor(
    private readonly compositor: Pick<Compositor, "windows" | "on">,
    private readonly spaces: () => AgentSpaces | undefined,
    /** Whether an agent works on that Space now: it is theirs to leave. */
    private readonly worked: (index: number) => boolean,
  ) {}

  /** The agent that added `ref` left it: it goes now if it can, and as soon as it can if not. Resolves after the first look. */
  left(ref: SpaceRef): Promise<void> {
    this.waiting.add(ref);
    this.stop ??= this.compositor.on((event) => {
      if (event.event === "window-closed" || event.event === "window-space" || event.event === "space") void this.look();
    });
    return this.look();
  }

  /** Look at every Desktop that waits, one look at a time. */
  look(): Promise<void> {
    if (this.waiting.size === 0) return this.last;
    this.last = this.last
      .then(() => this.pass())
      .catch((error) => console.error("dashi-shell: tidying an agent's Space:", error instanceof Error ? error.message : error));
    return this.last;
  }

  private async pass(): Promise<void> {
    const spaces = this.spaces();
    for (const ref of [...this.waiting]) {
      if (!spaces || ref.index === null) {
        this.forget(ref);
        continue;
      }
      const { count, current } = spaces.getSnapshot();
      if (count <= 1 || ref.index === current || this.worked(ref.index)) continue;
      const windows = await this.compositor.windows();
      // Read again: the Spaces may have been renumbered, or the screen moved, while the windows were read.
      const now = ref.index;
      if (now === null) this.forget(ref);
      else if (now !== spaces.getSnapshot().current && !this.worked(now) && !windows.some((window) => (window.space ?? 0) === now)) {
        await spaces.remove(now);
        this.forget(ref);
      }
    }
    if (this.waiting.size === 0) this.close();
  }

  private forget(ref: SpaceRef): void {
    this.waiting.delete(ref);
    this.spaces()?.unfollow(ref);
  }

  close(): void {
    this.stop?.();
    this.stop = null;
  }
}
