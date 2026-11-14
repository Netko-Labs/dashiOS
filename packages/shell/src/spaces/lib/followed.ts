/**
 * Spaces someone keeps a hold of while the others come and go: a Space's
 * index changes when a full-screen Desktop is put in before it or a Space
 * before it is removed, so whoever must find the same Space again later (an
 * agent at work on one, agents/desktop/elsewhere.ts) follows it instead of
 * remembering a number. Pure, so the renumbering is tested.
 */

import type { SpaceRef } from "../types.ts";

export class Followed {
  private readonly refs = new Set<SpaceRef>();

  follow(index: number): SpaceRef {
    const ref: SpaceRef = { index };
    this.refs.add(ref);
    return ref;
  }

  unfollow(ref: SpaceRef): void {
    this.refs.delete(ref);
  }

  /** A Space was put in at `at`: the ones from there move up one. */
  inserted(at: number): void {
    for (const ref of this.refs) if (ref.index !== null && ref.index >= at) ref.index++;
  }

  /** Space `index` was removed: it is gone, and the ones after it move down one. */
  removed(index: number): void {
    for (const ref of this.refs) {
      if (ref.index === null) continue;
      if (ref.index === index) ref.index = null;
      else if (ref.index > index) ref.index--;
    }
  }

  /** There are `count` Spaces now (the last ones were taken away, settings.json edited by hand). */
  fit(count: number): void {
    for (const ref of this.refs) if (ref.index !== null && ref.index >= count) ref.index = null;
  }
}
