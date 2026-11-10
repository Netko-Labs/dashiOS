/**
 * A snippet's keyword was typed (the compositor's `snippet` event): expand
 * it, or don't. Never in a terminal unless Settings allows it, never into
 * a password field, never once the person typed on past the keyword (the
 * compositor refuses to erase it then). The text goes in by pasting: on the
 * clipboard (never kept in the history) first, then the keyword erased, the
 * app's paste chord, ← back to {cursor}, and the copy the clipboard had
 * before put back, whether or not the paste went in.
 */

import type { Compositor, CompositorWindow } from "../../compositor.ts";
import { TERMINALS } from "../../keymap/keymap.ts";
import type { ClipEntry, HistorySnapshot } from "../history.ts";
import type { FieldCheck } from "./fields.ts";
import type { ClipboardIo } from "./io.ts";
import { copyEntry, type PasteDeps, pasteChord } from "./paste.ts";
import { expand, type SnippetStore } from "./snippets.ts";
import type { ClipboardWatch } from "./watch.ts";

/** How long the snippet's text stays on the clipboard before the copy before it comes back. */
const RESTORE_MS = 400;
/** The caret goes back at most this far. */
const MAX_BACK = 500;

export interface ExpandDeps extends PasteDeps {
  snippetErase: Compositor["snippetErase"];
  io: ClipboardIo;
  watch: Pick<ClipboardWatch, "expect" | "nextCopy">;
  snippets: Pick<SnippetStore, "find">;
  windows(): Promise<CompositorWindow[]>;
  fields: FieldCheck;
  /** Settings › Keyboard: snippets expand in terminals too. */
  inTerminals(): boolean;
  /** The history now: what the clipboard has, for {clipboard} and to put back. */
  history(): HistorySnapshot;
  locale?: string;
}

/** Why a keyword typed in `window` is left as it is; null when it may expand. */
export function refusal(window: Pick<CompositorWindow, "appId"> | null, inTerminals: boolean, passwordField: boolean): string | null {
  if (!window) return "no window";
  if (TERMINALS.includes(window.appId) && !inTerminals) return "a terminal";
  if (passwordField) return "a password field";
  return null;
}

/** The copy the clipboard holds now, if the history kept it (nothing newer was left out since). */
export function currentCopy(history: HistorySnapshot): ClipEntry | null {
  const [top] = history.entries;
  if (!top) return null;
  const skippedSince = history.skipped.some((skip) => skip.at > top.copiedAt);
  return skippedSince ? null : top;
}

export async function expandSnippet(keyword: string, windowId: number, deps: ExpandDeps): Promise<boolean> {
  const snippet = deps.snippets.find(keyword);
  if (!snippet) return false;
  const window = (await deps.windows().catch(() => [])).find((each) => each.id === windowId) ?? null;
  const password = window?.pid ? await deps.fields.passwordFocused(window.pid).catch(() => false) : false;
  if (!window || refusal(window, deps.inTerminals(), password) !== null) return false;
  const before = currentCopy(deps.history());
  const filled = expand(snippet.text, {
    now: new Date(),
    ...(deps.locale ? { locale: deps.locale } : {}),
    clipboard: before?.kind === "text" ? (before.text ?? null) : null,
  });
  // The snippet goes on the clipboard before the keyword is erased: a write that fails leaves the keyword as typed.
  deps.watch.expect("text", filled.text, "skip");
  const there = deps.watch.nextCopy(500);
  if (!(await deps.io.write("text/plain;charset=utf-8", filled.text))) return false;
  await there;
  // From here every way out puts the copy before back.
  let pasted = false;
  try {
    await deps.snippetErase({ window: window.id, keyword });
    await deps.sendKeys({ window: window.id, chord: pasteChord(window.appId) });
    pasted = true;
    for (let step = 0; step < Math.min(filled.back, MAX_BACK); step++) await deps.sendKeys({ window: window.id, chord: "Left" });
  } catch {
    // Typed on past it, or another window has the keyboard now: leave it.
  }
  if (before) {
    if (pasted) await Bun.sleep(RESTORE_MS);
    await copyEntry(before, deps);
  }
  return pasted;
}
