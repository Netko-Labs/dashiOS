/**
 * Renaming in place (F2, Rename…, a new folder): the item's name becomes a
 * field; Return or a click elsewhere commits it, Esc leaves the name.
 */

import type { StoreHost } from "../../store-state.ts";

export class StoreRename {
  /**
   * What renames for this browser (Files' operations, a chooser's own): an
   * error to show, or null once it is done. Without one nothing is renamed
   * in place.
   */
  renamer: ((path: string, name: string) => Promise<string | null>) | null = null;
  /** The name as typed so far in the field, kept for a click elsewhere, which commits it. */
  private draft: string | null = null;

  /** F2, Rename…, or a new folder: the item's name becomes a field. */
  startRename(path: string): void {
    if (!this.renamer) return;
    this.draft = null;
    this.host.select([path]);
    this.host.patch({ renaming: path });
  }

  /** The field's text changed. */
  draftRename(text: string): void {
    this.draft = text;
  }

  /** Esc: the name stays as it was. */
  endRename(): void {
    this.draft = null;
    if (this.host.getSnapshot().renaming !== null) this.host.patch({ renaming: null });
  }

  /** Return, or a click elsewhere: rename to `name` (else the draft); a problem keeps the field, said in the footer. True when it is done. */
  async commitRename(name: string | null = this.draft): Promise<boolean> {
    const path = this.host.getSnapshot().renaming;
    if (path === null) return true;
    const wanted = name ?? path.slice(path.lastIndexOf("/") + 1);
    const problem = this.renamer ? await this.renamer(path, wanted) : null;
    if (problem !== null) {
      this.host.say(problem, true);
      return false;
    }
    if (this.host.getSnapshot().renaming === path) this.endRename();
    return true;
  }

  constructor(private readonly host: StoreHost) {}
}
