/**
 * The arranger's side of the windows' memory (memory.ts, memory-file.ts):
 * which open windows leave a memory when they close (an app's own windows,
 * not dialogs or windows that asked for a spot), which of them the person
 * put in full screen (only those come back full screen: a game or a player
 * that went full screen by itself does that again by itself), and what each
 * leaves as it closes.
 */

import type { Placing } from "../../compositor/index.ts";
import type { Output, Rect, Tile } from "../../layout.ts";
import { memoryOf, type WindowMemory } from "./memory.ts";
import type { MemoryFile } from "./memory-file.ts";
import { remembers } from "./placing.ts";
import type { Displaced } from "./screens-gone.ts";

export class Remembering {
  /** The windows that leave a memory, by id: their app. */
  private readonly apps = new Map<number, string>();
  /** The windows the person put in full screen (the square with ⌥, ⌃❖F, the menus), or that came back so. */
  private readonly ownFullscreen = new Set<number>();

  constructor(
    private readonly file: MemoryFile | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** The memory a new window opens by, if it may take one. */
  recall(window: Placing): WindowMemory | null {
    return this.file && remembers(window) ? this.file.get(window.appId) : null;
  }

  /** A window was placed: it leaves a memory when it closes if it may. */
  placed(window: Placing): void {
    if (this.file && remembers(window)) this.apps.set(window.id, window.appId);
  }

  /** The person put a window in full screen, or took it out. */
  fullscreen(id: number, on: boolean): void {
    if (on) this.ownFullscreen.add(id);
    else this.ownFullscreen.delete(id);
  }

  /**
   * A window closed at `frame` (for a full-screen one, its frame from before), arranged as `tile`.
   * One `displaced` (screens-gone.ts) leaves where it wanted to be: the screen that went, or its
   * own size, not the one a screen with no room for it (a screen still settling) gave it.
   */
  closed(id: number, closed: { frame?: Rect; fullscreen?: true }, tile: Tile | null, outputs: readonly Output[], displaced?: Displaced): void {
    const appId = this.apps.get(id);
    const own = this.ownFullscreen.has(id);
    this.apps.delete(id);
    this.ownFullscreen.delete(id);
    if (!this.file || appId === undefined || !closed.frame) return;
    const fullscreen = closed.fullscreen === true && own;
    const memory = displaced
      ? { screen: displaced.screen, frame: displaced.frame, tile: displaced.tile ?? tile, fullscreen, at: this.now() }
      : memoryOf(closed.frame, { tile, fullscreen }, outputs, this.now());
    if (memory) this.file.set(appId, memory);
  }
}
