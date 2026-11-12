/**
 * Opening: a folder is gone into, a file opens in its default app (or in
 * what the chooser says), and a typed path goes to its folder with a file
 * in it selected.
 */

import { statSync } from "node:fs";
import { describeError, expandHome, type FileItem, mayOpen, normalizePath, openWithDefault, parentOf, parseFileUri } from "../../../files/index.ts";
import { folderAt } from "../../location.ts";
import type { StoreHost } from "../../store-state.ts";

export class StoreOpening {
  /** The notice a typed path that led nowhere put up (`sayPathProblem`). */
  private pathProblem: number | null = null;

  constructor(
    private readonly host: StoreHost,
    /** Opening files means this here (a chooser's Open); by default each opens in its app. */
    private readonly openFiles: ((items: FileItem[]) => void) | undefined,
  ) {}

  /** Open a folder here, or a file in its default app. */
  activate(item: FileItem): void {
    if (item.kind === "folder") {
      this.host.go(folderAt(item.path));
      return;
    }
    if (this.openFiles) {
      this.openFiles([item]);
      return;
    }
    const check = mayOpen(item);
    if (!check.ok) {
      this.host.say(check.reason ?? "That can’t be opened.", true);
      return;
    }
    void openWithDefault(item.path, this.host.env.run).then((problem) => problem && this.host.say(`“${item.name}” couldn’t be opened: ${problem}`, true));
  }

  openSelection(): void {
    const items = this.host.selectedItems();
    const files = items.filter((item) => item.kind !== "folder");
    // A chooser takes its files at once (that is its answer); a folder is gone into.
    if (this.openFiles && files.length > 0) return this.openFiles(files);
    for (const item of items.slice(0, 8)) this.activate(item);
  }

  /**
   * Go to a typed path (`~/x`, an absolute path, a file:// URI); an error to show, or null. A path
   * to a file shows its folder with the file selected. A path that works takes down the error a
   * path before it put up (`sayPathProblem`).
   */
  goToPath(text: string): string | null {
    const typed = text.trim();
    if (typed === "") return "Type a folder’s path.";
    const raw = typed.startsWith("file://") ? parseFileUri(typed) : expandHome(typed, this.host.env.home);
    const path = raw === null ? null : normalizePath(raw);
    if (path === null) return "That isn’t a path to a folder. Start with / or ~.";
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(path);
    } catch (error) {
      return describeError(error, path);
    }
    if (info.isDirectory()) this.host.go(folderAt(path));
    else this.host.go(folderAt(parentOf(path)), { select: path });
    if (this.pathProblem !== null && this.host.getSnapshot().notice?.id === this.pathProblem) this.host.dismissNotice();
    this.pathProblem = null;
    return null;
  }

  /** Show what was wrong with a typed path (an error, until a path works or it is dismissed). */
  sayPathProblem(text: string): void {
    this.host.say(text, true);
    this.pathProblem = this.host.getSnapshot().notice?.id ?? null;
  }

  /** Show an item's folder with the item selected (from search results and Recents). */
  reveal(item: FileItem): void {
    this.host.go(folderAt(parentOf(item.path)), { select: item.path });
  }
}
