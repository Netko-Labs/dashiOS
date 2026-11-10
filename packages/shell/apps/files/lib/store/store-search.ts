/**
 * Search in the listing: the query typed (after a short pause), in this
 * folder or everywhere, the results arriving in batches. A newer search or
 * leaving the place takes the older one down.
 */

import { type FileItem, searchComputer, searchFolder } from "../../../../src/shared/files/index.ts";
import type { SearchScope, StoreHost } from "./store-state.ts";

const SEARCH_DELAY_MS = 180;

export class StoreSearch {
  private searchToken = 0;
  private searchRun: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: StoreHost) {}

  setQuery(query: string): void {
    this.host.patch({ query });
    if (query.trim() === "") {
      this.clearSearch();
      return;
    }
    this.scheduleSearch(SEARCH_DELAY_MS);
  }

  setScope(scope: SearchScope): void {
    this.host.patch({ scope });
    if (this.host.getSnapshot().query.trim() !== "") this.scheduleSearch(0);
  }

  clearSearch(): void {
    this.searchToken++;
    this.searchRun?.abort();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.host.patch({ found: null, searching: false, truncated: false, query: "" });
  }

  scheduleSearch(delay: number): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.runSearch(), delay);
  }

  private async runSearch(): Promise<void> {
    const query = this.host.getSnapshot().query.trim();
    if (query === "") return;
    const token = ++this.searchToken;
    this.searchRun?.abort();
    const controller = (this.searchRun = new AbortController());
    const { location, scope, showHidden } = this.host.getSnapshot();
    this.host.patch({ searching: true, found: this.host.getSnapshot().found ?? [] });
    const apply = (found: FileItem[], truncated: boolean, searching: boolean): void => {
      if (token === this.searchToken) this.host.patch({ found, truncated, searching });
    };
    if (scope === "computer") {
      const found = await searchComputer(query, this.host.env.home, this.host.env.mime, this.host.env.run);
      apply(found, false, false);
      return;
    }
    if (location.kind !== "folder") {
      // Recents and the Trash are lists already: filter them in place.
      const lower = query.toLowerCase();
      apply(
        this.host.getSnapshot().items.filter((item) => item.name.toLowerCase().includes(lower)),
        false,
        false,
      );
      return;
    }
    const result = await searchFolder(location.path, query, {
      hidden: showHidden,
      home: this.host.env.home,
      index: this.host.env.mime,
      signal: controller.signal,
      onBatch: (items) => apply(items, false, true),
    });
    apply(result.items, result.truncated, false);
  }

  stop(): void {
    this.searchRun?.abort();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }
}
