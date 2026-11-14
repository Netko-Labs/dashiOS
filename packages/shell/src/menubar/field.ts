/**
 * The bar's row as the field (docs/design.html, "The bar's row as the
 * field"; the design's b-02 to b-08, b-22): a click on Dashi's mark turns
 * the menu bar's own row into a field for a task. The app's menus give way,
 * the caret is in the row, Esc or a click elsewhere puts the menus back and
 * keeps the draft, and Return sends the words to the launcher's assistant
 * (the path "Ask Dashi" takes). The bar never grows: the field is drawn on
 * the bar's row, by a surface of its own that holds the keyboard
 * (lib/field-row.tsx), as the bar's menus are. With no model chosen the row
 * says so and offers System Settings; nothing is sent.
 *
 * This keeps the state and tells the others (`hub.bar`), and does what they
 * ask (`hub.barCommands`).
 */

import type { BarCommand, BarRowState, Cell, Port } from "../shared/pill/index.ts";

/** What the field needs of the launcher's assistant. */
export interface FieldAsker {
  /** A model is chosen: an Ask can be sent. */
  ready(): boolean;
  /** Send the words; the new task's id, or null when nothing took them. */
  send(text: string): string | null;
  /** System Settings, where a model is chosen. */
  setUp(): void;
}

export interface FieldState {
  open: boolean;
  /** The screen whose bar is the field. */
  output: string | undefined;
  text: string;
  /** Where the caret is in `text`. */
  caret: number;
  /** Bumped when the text was changed from outside the field (dictated words): the field shows `text` again, the caret at `caret`. */
  revision: number;
  /** No model is chosen: the row says so in place of the field. */
  noModel: boolean;
}

export interface BarFieldDeps {
  bar: Cell<BarRowState>;
  commands: Port<BarCommand>;
  /** The launcher's assistant; null until it has started. */
  asker(): FieldAsker | null;
  /** Open the field's surface on that screen; `onClosed` runs if it goes by itself. */
  openSurface(output: string | undefined, onClosed: () => void): { close(): void };
  /** Before the field opens: an open menu or panel closes. */
  closeMenus(): void;
  /** The screen to open on when none was said (a command from another piece). */
  defaultOutput(): string | undefined;
  /** How many jobs the bar shows, for `hub.bar` at rest. */
  jobs: { subscribe(listener: () => void): () => void; count(): number };
}

const CLOSED: FieldState = { open: false, output: undefined, text: "", caret: 0, revision: 0, noModel: false };

/** `text` with `words` put in at `caret`, a space on each side where words would touch; and where the caret is after. */
export function insertWords(text: string, caret: number, words: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const said = words.trim();
  if (said === "") return { text, caret: at };
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before !== "" && !/\s$/.test(before) ? " " : "";
  const trail = after !== "" && !/^[\s.,;:!?]/.test(after) ? " " : "";
  const put = `${lead}${said}${trail}`;
  return { text: `${before}${put}${after}`, caret: at + put.length };
}

export class BarField {
  private state: FieldState = CLOSED;
  private surface: { close(): void } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[];

  constructor(private readonly deps: BarFieldDeps) {
    this.stops = [deps.commands.handle((command) => this.command(command)), deps.jobs.subscribe(() => this.tell())];
    this.tell();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FieldState => this.state;

  /** A click on the mark: the field opens on that screen's bar, or closes when it is open there. */
  toggle(output: string | undefined): void {
    if (this.state.open && this.state.output === output) this.close();
    else this.open(output);
  }

  /** The field opens with the draft it had (or `text`), the caret at its end. */
  open(output: string | undefined, text?: string): void {
    const draft = text ?? this.state.text;
    const noModel = !(this.deps.asker()?.ready() ?? false);
    if (this.state.open && this.state.output === output) {
      this.set({ ...this.state, noModel, ...(text === undefined ? {} : { text, caret: text.length, revision: this.state.revision + 1 }) });
      return;
    }
    this.deps.closeMenus();
    const old = this.surface;
    this.surface = null;
    old?.close();
    this.set({ open: true, output, text: draft, caret: draft.length, revision: this.state.revision + 1, noModel });
    const surface = this.deps.openSurface(output, () => {
      // It went by itself (its host died): the menus are back, the draft kept.
      if (this.surface !== surface) return;
      this.surface = null;
      this.set({ ...this.state, open: false });
    });
    this.surface = surface;
  }

  /** Esc, a click elsewhere, or after sending: the menus are back. The draft stays for the next time. */
  close(): void {
    if (!this.state.open) return;
    const surface = this.surface;
    this.surface = null;
    this.set({ ...this.state, open: false });
    surface?.close();
  }

  /** The person typed. */
  type(text: string): void {
    if (text === this.state.text) return;
    // Typing moves the caret with it; the field says exactly where when it knows (`caretAt`).
    this.set({ ...this.state, text, caret: Math.max(0, Math.min(text.length, this.state.caret + text.length - this.state.text.length)) });
  }

  /** The caret moved in the field. */
  caretAt(caret: number): void {
    if (caret !== this.state.caret) this.state = { ...this.state, caret };
  }

  /** Dictated words (b-08): at the caret. */
  insert(words: string): void {
    if (!this.state.open || this.state.noModel) return;
    const { text, caret } = insertWords(this.state.text, this.state.caret, words);
    this.set({ ...this.state, text, caret, revision: this.state.revision + 1 });
  }

  /** Return: the words go to the assistant and the menus come back; with no model, System Settings opens. Nothing is sent that could not be. */
  submit(): void {
    if (!this.state.open) return;
    const asker = this.deps.asker();
    if (this.state.noModel) {
      asker?.setUp();
      this.close();
      return;
    }
    const text = this.state.text.trim();
    if (text === "") return;
    if (!asker?.ready() || asker.send(text) === null) {
      this.set({ ...this.state, noModel: true });
      return;
    }
    this.set({ ...this.state, text: "", caret: 0 });
    this.close();
  }

  stop(): void {
    for (const stop of this.stops) stop();
    this.close();
  }

  private command(command: BarCommand): void {
    if (command.do === "open-field") this.open(this.state.open ? this.state.output : this.deps.defaultOutput(), command.text);
    else if (command.do === "insert") this.insert(command.text);
    else this.close();
  }

  private set(state: FieldState): void {
    this.state = state;
    this.tell();
    for (const listener of [...this.listeners]) listener();
  }

  /** What the others read (`hub.bar`). */
  private tell(): void {
    const now = this.deps.bar.getSnapshot();
    const count = this.deps.jobs.count();
    const { open, text } = this.state;
    if (open) {
      if (now.mode !== "field" || now.text !== text) this.deps.bar.set({ mode: "field", text });
    } else if (count > 0) {
      if (now.mode !== "jobs" || now.count !== count) this.deps.bar.set({ mode: "jobs", count });
    } else if (now.mode !== "rest") this.deps.bar.set({ mode: "rest" });
  }
}
