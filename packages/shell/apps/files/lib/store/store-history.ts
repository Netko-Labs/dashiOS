/**
 * Where the window has been: going to a place (back and forward remember
 * the ones before), up to the enclosing folder, and the arrows' step back.
 */

import { parentOf } from "../../../../src/shared/files/index.ts";
import { folderAt, type Location, sameLocation } from "../location.ts";
import type { StoreHost } from "./store-state.ts";

export class StoreHistory {
  private back: Location[] = [];
  private forward: Location[] = [];

  constructor(
    private readonly host: StoreHost,
    private readonly hooks: {
      /** A search is left when the place changes. */
      leaveSearch: () => void;
      /** The keyboard starts on this item of the new place, or nowhere. */
      startAt: (path: string | null) => void;
      /** List the new place (and select `select` in it once it lands). */
      load: (select?: string) => Promise<void>;
    },
  ) {}

  /** Move to `location`, remembering where we were. */
  go(location: Location, options: { record?: boolean; select?: string } = {}): void {
    if (options.record !== false && sameLocation(location, this.host.getSnapshot().location)) {
      // Already here: a search is left, and a revealed item is selected.
      this.hooks.leaveSearch();
      if (options.select) this.host.select([options.select]);
      return;
    }
    if (options.record !== false) {
      this.back.push(this.host.getSnapshot().location);
      this.forward = [];
    }
    this.hooks.leaveSearch();
    this.hooks.startAt(options.select ?? null);
    // The last place's items stay up until this one's land (`stale`): a quick folder doesn't flicker.
    this.host.patch({
      location,
      canBack: this.back.length > 0,
      canForward: this.forward.length > 0,
      selection: options.select ? [options.select] : [],
      renaming: null,
      error: null,
      loading: true,
    });
    void this.hooks.load(options.select);
  }

  goBack(): void {
    const previous = this.back.pop();
    if (!previous) return;
    this.forward.push(this.host.getSnapshot().location);
    this.go(previous, { record: false });
    this.host.patch({ canBack: this.back.length > 0, canForward: true });
  }

  goForward(): void {
    const next = this.forward.pop();
    if (!next) return;
    this.back.push(this.host.getSnapshot().location);
    this.go(next, { record: false });
    this.host.patch({ canBack: true, canForward: this.forward.length > 0 });
  }

  goUp(): void {
    const { location } = this.host.getSnapshot();
    if (location.kind === "folder" && location.path !== "/") {
      const trashed = location.path.startsWith(`${this.host.env.trash.files}/`) && parentOf(location.path) === this.host.env.trash.files;
      this.go(trashed ? { kind: "trash" } : folderAt(parentOf(location.path)), { select: location.path });
    } else if (location.kind !== "folder") {
      this.go(folderAt(this.host.env.home));
    }
  }
}
