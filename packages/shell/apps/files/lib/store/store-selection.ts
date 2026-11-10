/**
 * The selection in the listing: a click with the keys held (selection.ts),
 * the arrows and page keys, typing a name to jump to it, and where the
 * keyboard is (the anchor of a ⇧ run and its moving end).
 */

import type { Modifiers } from "@mirinjs/metal";
import type { FileItem } from "../../../../src/shared/files/items.ts";
import { isPlain, type Layout, navigate, pick, type Step } from "../selection.ts";
import { findByPrefix } from "../sort.ts";
import type { StoreHost } from "./store-state.ts";

const DOUBLE_CLICK_MS = 450;
const NO_KEYS: Modifiers = { shift: false, control: false, alt: false, super: false };

export class StoreSelection {
  private lastClick: { path: string; time: number } | null = null;
  /** Where a ⇧-click's run starts: the last item clicked without ⇧. */
  private anchor: string | null = null;
  /** Where the keyboard is: the moving end of a ⇧-arrow run. */
  private focus: string | null = null;
  private layout: Layout = { columns: 1, page: 10 };
  private typed: { text: string; time: number } = { text: "", time: 0 };

  constructor(
    private readonly host: StoreHost,
    private readonly hooks: {
      /** Opens an item (a double click). */
      activate: (item: FileItem) => void;
      /** Saves the name being typed in place. */
      commitRename: () => Promise<boolean>;
    },
  ) {}

  /** A new place: the keyboard starts on `path` (an item revealed), or nowhere. */
  startAt(path: string | null): void {
    this.anchor = path;
    this.focus = path;
  }

  select(paths: readonly string[]): void {
    this.host.patch({ selection: paths });
    this.focus = paths.at(-1) ?? null;
    if (paths.length <= 1) this.anchor = paths[0] ?? null;
  }

  selectAll(): void {
    this.host.patch({ selection: this.host.visible().map((item) => item.path) });
  }

  selectedItems(): FileItem[] {
    const chosen = new Set(this.host.getSnapshot().selection);
    return this.host.visible().filter((item) => chosen.has(item.path));
  }

  /**
   * A click on an item, with the keys held (selection.ts): select it, ⇧ a
   * run to it, ❖ add or take it out; a plain second click on it opens it.
   */
  click(item: FileItem, held: Modifiers = NO_KEYS): void {
    if (this.host.getSnapshot().renaming !== null && this.host.getSnapshot().renaming !== item.path) void this.hooks.commitRename();
    if (this.host.getSnapshot().renaming === item.path) return;
    const now = this.host.env.now();
    const plain = isPlain(held);
    const again = plain && this.lastClick?.path === item.path && now - this.lastClick.time <= DOUBLE_CLICK_MS;
    this.lastClick = plain ? { path: item.path, time: now } : null;
    if (again) {
      this.lastClick = null;
      this.hooks.activate(item);
      return;
    }
    const shown = this.host.visible().map((each) => each.path);
    const picked = pick(shown, this.host.getSnapshot().selection, this.anchor, item.path, held);
    this.host.patch({ selection: picked.selection });
    this.anchor = picked.anchor;
    this.focus = item.path;
  }

  /** A click on the listing's empty space: nothing is selected. */
  clickEmpty(): void {
    if (this.host.getSnapshot().renaming !== null) void this.hooks.commitRename();
    this.lastClick = null;
    if (this.host.getSnapshot().selection.length > 0) this.select([]);
  }

  /** A right-click: a click outside the selection selects what was clicked. */
  contextOn(item: FileItem): void {
    if (!this.host.getSnapshot().selection.includes(item.path)) this.select([item.path]);
  }

  /** How the view lays the items out, for the arrows: icons in rows of `columns`; `page` rows to a screen. */
  setLayout(layout: Layout): void {
    this.layout = layout;
  }

  /** A move key (selection.ts `navigate`): the arrows, Home, End, the page keys; with `extend` (⇧) the run from the anchor. */
  move(step: Step, extend = false): void {
    const columns = this.host.getSnapshot().view === "icons" ? this.layout.columns : 1;
    const shown = this.host.visible().map((item) => item.path);
    const moved = navigate(shown, this.host.getSnapshot().selection, this.anchor, this.focus, step, { ...this.layout, columns }, extend);
    if (!moved) return;
    this.host.patch({ selection: moved.selection });
    this.anchor = moved.anchor;
    this.focus = moved.focus;
  }

  /** Characters typed with the window focused select the next item that starts with them. */
  typeAhead(text: string): void {
    const now = this.host.env.now();
    this.typed = { text: now - this.typed.time > 900 ? text : this.typed.text + text, time: now };
    const found = findByPrefix(this.host.visible(), this.typed.text, this.host.getSnapshot().selection.at(-1) ?? null);
    if (found) this.select([found.path]);
  }
}
