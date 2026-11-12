/**
 * The editor's document as the window sees it, apart from its file: the
 * state a store holds (subscribe/getSnapshot), Undo, Find and the View
 * settings. EditorModel (model.ts) adds the file, saving and versions.
 */

import { findMatches, matchAtOrAfter, replaceAll, stepMatch } from "./find.ts";
import { History } from "./history.ts";
import { DEFAULT_PREFS, type EditorPrefs, samePrefs, stepFontSize, type TabWidth } from "./prefs.ts";
import type { EditorState, FindState } from "./state.ts";

export abstract class EditorDocument {
  private readonly listeners = new Set<() => void>();
  protected readonly history = new History();
  protected readonly loadPrefs: () => EditorPrefs;
  protected readonly savePrefs: (prefs: EditorPrefs) => void;
  protected state: EditorState;

  constructor(state: EditorState, loadPrefs: () => EditorPrefs, savePrefs: (prefs: EditorPrefs) => void) {
    this.state = state;
    this.loadPrefs = loadPrefs;
    this.savePrefs = savePrefs;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.state;

  /** The input reported new text. `joinable` false keeps it its own Undo step, named `name`. */
  abstract edit(text: string, joinable?: boolean, name?: string): void;

  undo(): void {
    const text = this.history.undo(this.state.text);
    if (text !== null) this.replaceText(text);
  }

  redo(): void {
    const text = this.history.redo(this.state.text);
    if (text !== null) this.replaceText(text);
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }

  setQuery(query: string): void {
    this.set(this.findFor(this.state.text, { ...this.state.find, query, current: -1 }));
  }

  setCaseSensitive(caseSensitive: boolean): void {
    this.set(this.findFor(this.state.text, { ...this.state.find, caseSensitive, current: -1 }));
  }

  /** Shows the next (`step` 1) or previous match and asks the window to scroll to it; false when there is none. */
  findNext(step: 1 | -1): boolean {
    const { find } = this.state;
    const current = stepMatch(find.matches.length, find.current, step);
    if (current < 0) return false;
    this.set({ find: { ...find, current } });
    this.reveal(find.matches[current] as number);
    return true;
  }

  /** Asks the window to scroll `offset` into view. */
  reveal(offset: number): void {
    this.set({ reveal: { offset, seq: (this.state.reveal?.seq ?? 0) + 1 } });
  }

  /** Replaces every match (one Undo step); how many there were. */
  replaceAll(replacement: string): number {
    const { query, caseSensitive } = this.state.find;
    const result = replaceAll(this.state.text, query, replacement, { caseSensitive });
    if (result.count > 0) {
      this.edit(result.text, false, "Replace All");
      this.set({ notice: { text: `Replaced ${result.count} ${result.count === 1 ? "match" : "matches"}.`, tone: "info" } });
    }
    return result.count;
  }

  setMonospace(monospace: boolean): void {
    this.setPrefs({ ...this.state.prefs, monospace });
  }

  setLineNumbers(lineNumbers: boolean): void {
    this.setPrefs({ ...this.state.prefs, lineNumbers });
  }

  setTabWidth(tabWidth: TabWidth): void {
    this.setPrefs({ ...this.state.prefs, tabWidth });
  }

  /** Bigger (1), Smaller (-1), or the default size (0). */
  stepFontSize(step: 1 | -1 | 0): void {
    const fontSize = step === 0 ? DEFAULT_PREFS.fontSize : stepFontSize(this.state.prefs.fontSize, step);
    this.setPrefs({ ...this.state.prefs, fontSize });
  }

  /** Another window changed the View settings: this one follows, writing nothing. */
  reloadPrefs(): void {
    const prefs = this.loadPrefs();
    if (!samePrefs(prefs, this.state.prefs)) this.set({ prefs });
  }

  protected setPrefs(prefs: EditorPrefs): void {
    if (samePrefs(prefs, this.state.prefs)) return;
    this.set({ prefs });
    this.savePrefs(prefs);
  }

  protected replaceText(text: string): void {
    const find = this.state.find;
    // The match shown stays the one at (or after) where it was.
    const at = find.current >= 0 ? (find.matches[find.current] ?? 0) : -1;
    const next = this.findFor(text, find);
    const current = at >= 0 ? matchAtOrAfter(next.find.matches, at) : -1;
    this.set({ text, notice: null, ...this.undoNames(), find: { ...next.find, current } });
  }

  /** The Undo state (which changes with every new text). */
  protected undoNames(): Pick<EditorState, "canUndo" | "canRedo" | "undoName" | "redoName"> {
    const { canUndo, canRedo, undoName, redoName } = this.history;
    return { canUndo, canRedo, undoName, redoName };
  }

  /** `find` with its matches in `text`, and the Undo state. */
  protected findFor(text: string, find: FindState): Pick<EditorState, "find" | "canUndo" | "canRedo" | "undoName" | "redoName"> {
    const matches = findMatches(text, find.query, { caseSensitive: find.caseSensitive });
    return { find: { ...find, matches, current: Math.min(find.current, matches.length - 1) }, ...this.undoNames() };
  }

  protected set(change: Partial<EditorState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
