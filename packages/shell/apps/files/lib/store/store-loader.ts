/**
 * Listing the place: a folder (the last place's items stay up until these
 * land), the Trash or Recents; watching the folder for changes made
 * elsewhere (a burst is one reload); and the free space.
 */

import { type FSWatcher, watch } from "node:fs";
import { type FileItem, itemAt, listTrash, parentOf, readFolder, tilde } from "../../../../src/shared/files/index.ts";
import { space } from "../drives.ts";
import type { Location } from "../location.ts";
import type { StoreHost } from "./store-state.ts";

export class StoreLoader {
  private loadToken = 0;
  private listing: AbortController | null = null;
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: StoreHost,
    private readonly watching: boolean,
    private readonly hooks: {
      /** The listing landed while a search was waiting: look again. */
      search: () => void;
    },
  ) {}

  async load(select?: string): Promise<void> {
    const token = ++this.loadToken;
    this.listing?.abort();
    const controller = (this.listing = new AbortController());
    this.watcher?.close();
    this.watcher = null;
    const { location } = this.host.getSnapshot();
    let items: FileItem[] = [];
    let error: string | null = null;
    if (location.kind === "folder") {
      const result = await readFolder(location.path, this.host.env.mime, controller.signal);
      items = result.items;
      error = result.error;
    } else if (location.kind === "trash") {
      items = (await listTrash(this.host.env.trash, this.host.env.mime)).map((item) =>
        item.original ? { ...item, where: tilde(parentOf(item.original), this.host.env.home) } : item,
      );
    } else {
      items = await this.recentItems();
    }
    if (token !== this.loadToken) return;
    const keep = new Set(items.map((item) => item.path));
    const { selection, renaming } = this.host.getSnapshot();
    this.host.patch({
      items,
      listed: location,
      loading: false,
      error,
      selection: select && keep.has(select) ? [select] : selection.filter((path) => keep.has(path)),
      renaming: renaming !== null && keep.has(renaming) ? renaming : null,
    });
    this.watchLocation(location);
    if (location.kind === "folder") void space(location.path).then((free) => token === this.loadToken && this.host.patch({ free }));
    else this.host.patch({ free: null });
    if (this.host.getSnapshot().query !== "") this.hooks.search();
  }

  private async recentItems(): Promise<FileItem[]> {
    const recent = await this.host.env.recents();
    const items = await Promise.all(recent.slice(0, 200).map((file) => itemAt(file.path, this.host.env.mime)));
    return items.flatMap((item, index) => {
      const file = recent[index];
      if (!item || item.kind === "other" || !file) return [];
      return [{ ...item, where: tilde(parentOf(item.path), this.host.env.home), mtime: file.time || item.mtime }];
    });
  }

  private watchLocation(location: Location): void {
    if (this.watching === false || location.kind === "recents") return;
    const path = location.kind === "folder" ? location.path : this.host.env.trash.files;
    try {
      this.watcher = watch(path, { persistent: false }, () => {
        if (this.watchTimer) clearTimeout(this.watchTimer);
        // A burst of changes (a copy, an extraction) is one reload.
        this.watchTimer = setTimeout(() => void this.load(), 250);
      });
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // A folder that can't be watched is reloaded by hand.
    }
  }

  stop(): void {
    this.listing?.abort();
    this.watcher?.close();
    if (this.watchTimer) clearTimeout(this.watchTimer);
  }
}
