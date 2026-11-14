/**
 * An agent at work on another Desktop (`work_in_space`): asked to, it opens
 * its windows on a Space that does not show and works in them there, and the
 * person's screen never moves. Each connection has one `Elsewhere`: the Space
 * it works in (followed through the renumbering, spaces/lib/followed.ts),
 * and whether it added that Space itself, in which case it takes it away
 * again once it is empty. Nothing is kept on disk.
 *
 * `WorkPlaces` is what the connections share: it tells the arranger where a
 * new window goes (arrange/, `window-placing`) before the window is ever on
 * screen:
 *
 *  1. a window an agent is opening now (`claim`: its launch's process, or
 *     the app's id) goes to that agent's Space;
 *  2. a dialog goes where its window is, when that is a Space that does not
 *     show (anyone's: a dialog belongs with its window);
 *  3. a new window of an app whose windows are all on a Space an agent works
 *     in goes there too (the agent pressed ❖N: the person did not ask for it).
 *
 * Never onto a full-screen window's own Desktop, and never anywhere but the
 * Space that shows when no agent asked.
 */

import type { Compositor, Placing } from "../../compositor/index.ts";
import { MAX_SPACES, type SpaceRef, spaceLabel } from "../../spaces/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { descendsFrom } from "../peer.ts";

/** The Desktops as agents need them: SpacesController (spaces/). */
export interface AgentSpaces {
  getSnapshot(): { count: number; current: number; labels: readonly string[]; fullscreen: readonly (number | null)[] };
  /** A new Space at the end: its index, or null at the limit. */
  add(): Promise<number | null>;
  remove(index: number): Promise<void>;
  follow(index: number): SpaceRef;
  unfollow(ref: SpaceRef): void;
}

/** A window about to open that an agent asked for: its launch's process (null: not known), or its app. */
export interface Opening {
  pid: number | null;
  owns(appId: string): boolean;
}

interface Claim {
  /** Kept as given: a launch learns its process after the claim is made. */
  opening: Opening;
  space: SpaceRef;
}

export type WorkTarget = number | "new" | "shown";

const nameOf = (spaces: AgentSpaces, index: number): string => spaces.getSnapshot().labels[index] ?? spaceLabel(index);

export class WorkPlaces {
  private readonly claims = new Set<Claim>();
  /** The Spaces agents work in now. */
  private readonly working = new Set<SpaceRef>();
  private stop: (() => void) | null = null;

  constructor(
    readonly compositor: Pick<Compositor, "windows" | "spaces" | "on">,
    readonly spaces: () => AgentSpaces | undefined,
    private readonly descends: (pid: number, ancestor: number) => boolean = descendsFrom,
  ) {}

  /** An agent works on `space` from now (or no longer): apps there that raise themselves must not move the screen. */
  work(space: SpaceRef, on: boolean): void {
    if (on) this.working.add(space);
    else this.working.delete(space);
    // Spaces are renumbered as they come and go: the compositor is told again each time.
    if (this.working.size > 0) {
      this.stop ??= this.compositor.on((event) => {
        if (event.event === "space") this.quiet();
      });
    } else {
      this.stop?.();
      this.stop = null;
    }
    this.quiet();
  }

  /** Tell the compositor which Spaces a window's own activation never switches to (`spaces {quiet}`). */
  private quiet(): void {
    const quiet = [...new Set([...this.working].map((ref) => ref.index).filter((index): index is number => index !== null))];
    this.compositor.spaces({ quiet }).catch((error) => console.error("dashi-shell: quiet Spaces:", error instanceof Error ? error.message : error));
  }

  close(): void {
    this.stop?.();
    this.stop = null;
  }

  /** The next window that is `opening`'s goes to `space`, until the returned function is called. */
  claim(opening: Opening, space: SpaceRef): () => void {
    const claim: Claim = { opening, space };
    this.claims.add(claim);
    return () => this.claims.delete(claim);
  }

  /** The Space a new window opens on, when it is not the one that shows; null for that one. */
  async spaceFor(placing: Placing): Promise<number | null> {
    const spaces = this.spaces();
    if (!spaces) return null;
    const { current, fullscreen } = spaces.getSnapshot();
    const away = (index: number | null | undefined): number | null => (index === null || index === undefined || index === current ? null : index);
    for (const claim of this.claims) {
      const { pid, owns } = claim.opening;
      const theirs = pid !== null && placing.pid !== undefined && (placing.pid === pid || this.descends(placing.pid, pid));
      // Nothing an agent opens goes onto a full-screen window's own Desktop.
      if (theirs || owns(placing.appId)) return (fullscreen[claim.space.index ?? -1] ?? null) === null ? away(claim.space.index) : null;
    }
    const windows = await this.compositor.windows().catch(() => []);
    if (placing.parent !== undefined) return away(windows.find((window) => window.id === placing.parent)?.space);
    if (placing.pid === undefined || this.working.size === 0) return null;
    const own = windows.filter((window) => window.pid === placing.pid);
    const space = own[0]?.space;
    const all = own.length > 0 && own.every((window) => window.space === space);
    return all && [...this.working].some((ref) => ref.index === space) ? away(space) : null;
  }
}

export class Elsewhere {
  /** The browser tab it opened in a window of its own there: the next page opens beside it. */
  tab: number | null = null;
  private ref: SpaceRef | null = null;
  /** It added the Space it works in: gone again once it leaves it empty. */
  private added = false;

  constructor(private readonly places: WorkPlaces) {}

  /** The Space it works in (from 0), or null: the one that shows, as always. */
  get space(): number | null {
    return this.ref?.index ?? null;
  }

  /** The Space it works in when that one does not show; null when it shows, or there is none. */
  get away(): number | null {
    const space = this.space;
    return space === null || space === this.places.spaces()?.getSnapshot().current ? null : space;
  }

  /**
   * What the Space it works in is called, or null: always "Desktop 3", by its number. The shell's
   * own label follows the apps on it ("Calculator, Text Editor"), which reads as an app in a sentence.
   */
  get label(): string | null {
    const space = this.space;
    return space === null ? null : spaceLabel(space);
  }

  /** A window this agent is opening goes to its Space; the returned function ends the claim. Nothing without a Space. */
  claim(opening: Opening): () => void {
    return this.ref ? this.places.claim(opening, this.ref) : () => {};
  }

  /** `work_in_space`: work on Space `target`, a new one, or back where the person is. */
  async go(target: WorkTarget, ctx: RunContext): Promise<ToolResult> {
    const spaces = this.places.spaces();
    if (!spaces) return toolError("This desktop has no Spaces to work in.");
    const { count, fullscreen } = spaces.getSnapshot();
    if (target === "shown") {
      await this.leave();
      ctx.status("Working where you are");
      return text("Windows you open go on the Space that shows again.");
    }
    if (target === "new" && count >= MAX_SPACES) {
      return toolError(`There are already ${MAX_SPACES} Spaces, the most there can be. Work in one of them (list_spaces), or ask the person to close one.`);
    }
    if (target !== "new") {
      if (target >= count) return toolError(`There is no Space ${target + 1}; list_spaces shows the ${count} there are.`);
      if ((fullscreen[target] ?? null) !== null) return toolError(`Space ${target + 1} is a full-screen window's own Desktop; nothing else goes there.`);
      if (target === this.space) return this.answer(spaces, target, false);
    }
    await this.leave();
    const index = target === "new" ? await spaces.add() : target;
    if (index === null) return toolError("A new Space could not be added.");
    this.ref = spaces.follow(index);
    this.added = target === "new";
    this.places.work(this.ref, true);
    ctx.status(`Working on ${spaceLabel(index)}`);
    return this.answer(spaces, index, this.added);
  }

  private answer(spaces: AgentSpaces, index: number, added: boolean): ToolResult {
    const name = nameOf(spaces, index);
    const desktop = spaceLabel(index);
    const shows = index === spaces.getSnapshot().current;
    const words = shows
      ? `${desktop} is the Space that shows now, so the person sees what you open.`
      : `Windows you open go there, and the person's screen stays as it is: click, type, and take window screenshots there as anywhere. switch_space shows it to them only if they ask.`;
    return json({ space: index + 1, name, shows, added, note: `You work on ${desktop}${added ? ", added for you" : ""}. ${words}` });
  }

  /**
   * Stop working there (another Space, "shown", or the agent left). A Space
   * it added goes if nothing is left on it; one with windows stays, and so
   * does one the person is looking at: taking it away would move their screen.
   */
  async leave(): Promise<void> {
    const ref = this.ref;
    if (!ref) return;
    const spaces = this.places.spaces();
    const added = this.added;
    this.ref = null;
    this.added = false;
    this.tab = null;
    this.places.work(ref, false);
    try {
      const index = ref.index;
      if (!added || !spaces || index === null) return;
      const { count, current } = spaces.getSnapshot();
      if (count <= 1 || index === current) return;
      const windows = await this.places.compositor.windows();
      // Read again: the Spaces may have been renumbered while the windows were read.
      const now = ref.index;
      if (now === null || now === spaces.getSnapshot().current || windows.some((window) => (window.space ?? 0) === now)) return;
      await spaces.remove(now);
    } catch (error) {
      console.error("dashi-shell: tidying an agent's Space:", error instanceof Error ? error.message : error);
    } finally {
      spaces?.unfollow(ref);
    }
  }
}
