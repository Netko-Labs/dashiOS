/**
 * Clipboard history and snippets, started once for the session (main.tsx):
 * the history and its watch on the compositor's copies, the snippets and
 * the keywords the compositor watches for, the two launcher scopes, the
 * registry's `clipboard` source, and what agents may read (asked every
 * time). Settings › Keyboard turns the history off (which clears it) and
 * edits the apps left out (settings.json `clipboard`).
 */

import type { ActionContext, ActionSource } from "../actions/types.ts";
import type { ClipboardCopy } from "../agents/desktop/types.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import type { LauncherScope } from "../launcher/scope.ts";
import type { SettingsStore } from "../settings-app/store.ts";
import { clipboardSource } from "./actions.ts";
import { expandSnippet } from "./expand.ts";
import { atspiFieldCheck, type FieldCheck } from "./fields.ts";
import { ClipboardHistory, type HistorySnapshot } from "./history.ts";
import { type ClipboardIo, wlClipboard } from "./io.ts";
import { copyEntry, type PasteDeps, pasteChord, pasteEntry } from "./paste.ts";
import { DEFAULT_LEFT_OUT } from "./privacy.ts";
import { historyScope, type PasteTarget, snippetsScope } from "./scope.ts";
import { expand, SnippetStore } from "./snippets.ts";
import { ClipboardWatch, fileUris } from "./watch.ts";

/** What an agent reads of one copy's text, at most. */
const AGENT_TEXT = 4000;

export interface ClipboardOptions {
  compositor: Pick<Compositor, "on" | "windows" | "request"> | null;
  settings: SettingsStore;
  /** The screen is being shared or recorded, or locked: nothing is kept meanwhile. */
  paused(): boolean;
  isVault(window: CompositorWindow): boolean;
  appName(window: CompositorWindow): string;
  /** Open the launcher in a scope (closing it first if it is open). */
  openLauncher(scope: "clipboard" | "snippets", window: number | null): void;
  /** Settings › Keyboard, at the history's row. */
  openSettings(): void;
  confirm(question: { title: string; detail: string; action: string; danger: boolean }): Promise<boolean>;
  history?: ClipboardHistory;
  snippets?: SnippetStore;
  io?: ClipboardIo;
  fields?: FieldCheck;
  /** The snippets' check, which turns accessibility on (fields.ts). */
  snippetFields?: FieldCheck;
  locale?: string;
}

export interface Clipboard {
  readonly history: ClipboardHistory;
  readonly snippets: SnippetStore;
  readonly scopes: readonly LauncherScope[];
  readonly source: ActionSource;
  /** The launcher is opening over `window` (or the last one with the keyboard): where ↩ pastes. */
  opening(window: number | null): void;
  /** For agents, after the person said yes (agents/desktop/clipboard.ts). */
  recent(limit: number): ClipboardCopy[];
  close(): void;
}

/** A copy as an agent reads it. */
export function forAgent(entry: HistorySnapshot["entries"][number]): ClipboardCopy {
  const text =
    entry.kind === "image"
      ? `A picture${entry.size ? `, ${entry.size.width} × ${entry.size.height}` : ""}`
      : entry.kind === "files"
        ? fileUris(entry.text ?? "")
            .map((uri) => {
              try {
                return decodeURIComponent(new URL(uri).pathname);
              } catch {
                return uri;
              }
            })
            .join("\n")
        : (entry.text ?? "").slice(0, AGENT_TEXT);
  return { kind: entry.kind, text, app: entry.app, copiedAt: new Date(entry.copiedAt).toISOString(), pinned: entry.pinned === true };
}

export function startClipboard(options: ClipboardOptions): Clipboard {
  const { compositor, settings } = options;
  const history = options.history ?? new ClipboardHistory();
  const snippets = options.snippets ?? new SnippetStore();
  const io = options.io ?? wlClipboard();
  const fields = options.fields ?? atspiFieldCheck();
  const snippetFields = options.snippetFields ?? atspiFieldCheck({ turnOn: true });
  const section = () => settings.getSnapshot().data.clipboard;
  const enabled = () => section().history !== false;
  const leftOut = () => section().leftOut ?? DEFAULT_LEFT_OUT;

  const changes = new Set<() => void>();
  const changed = () => {
    for (const listener of changes) listener();
  };
  // Turned off, from here or Settings or by hand: what was kept goes.
  let wasOn = enabled();
  const stopSettings = settings.subscribe(() => {
    const on = enabled();
    if (wasOn && !on) history.clear();
    wasOn = on;
    changed();
  });

  const request = (method: string, params: Record<string, unknown>) => compositor?.request(method, params) ?? Promise.reject(new Error("no compositor"));
  const watch = compositor
    ? new ClipboardWatch({
        on: (listener) => compositor.on(listener),
        windows: () => compositor.windows(),
        history,
        io,
        fields,
        enabled,
        leftOut,
        paused: options.paused,
        isVault: options.isVault,
        appName: options.appName,
      })
    : null;
  const pasting: PasteDeps = {
    io,
    watch: watch ?? { expect: () => {}, nextCopy: async () => false },
    imagePath: (entry) => history.imagePath(entry),
    request,
  };

  // The keywords the compositor watches for, sent again whenever the snippets change.
  const sendKeywords = () =>
    void compositor
      ?.request("snippets", { keywords: snippets.getSnapshot().map((each) => each.keyword) })
      .catch((error) => console.error("dashi-shell: dashi-comp refused the snippets' keywords:", error));
  sendKeywords();
  const stopSnippets = snippets.subscribe(sendKeywords);
  const expandDeps = {
    ...pasting,
    snippets,
    windows: () => compositor?.windows() ?? Promise.resolve([]),
    fields: snippetFields,
    inTerminals: () => section().snippetsInTerminals === true,
    history: () => history.getSnapshot(),
    ...(options.locale ? { locale: options.locale } : {}),
  };
  const stopExpanding =
    compositor?.on((event) => {
      if (event.event === "snippet")
        void expandSnippet(event.keyword, event.window, expandDeps).catch((error) => console.error("dashi-shell: a snippet:", error));
    }) ?? (() => {});

  let target: PasteTarget | null = null;
  const opening = (window: number | null) => {
    target = null;
    changed();
    void compositor
      ?.windows()
      .then((windows) => {
        // The windows come most recently given the keyboard first: the launcher opened over the first that shows.
        const found = windows.find((each) => each.id === window) ?? windows.find((each) => each.state === "normal");
        target = found ? { id: found.id, appId: found.appId, appName: options.appName(found) } : null;
        changed();
      })
      .catch(() => {});
  };

  /** A snippet's text, its placeholders filled in, on the clipboard (never kept). */
  const putSnippet = async (text: string): Promise<{ back: number } | null> => {
    const top = history.getSnapshot().entries[0];
    const filled = expand(text, {
      now: new Date(),
      ...(options.locale ? { locale: options.locale } : {}),
      clipboard: top?.kind === "text" ? (top.text ?? null) : null,
    });
    pasting.watch.expect("text", filled.text, "skip");
    const there = pasting.watch.nextCopy(500);
    if (!(await io.write("text/plain;charset=utf-8", filled.text))) return null;
    await there;
    return { back: filled.back };
  };

  const scopeDeps = {
    history,
    snippets,
    enabled,
    target: () => target,
    onChange: (listener: () => void) => {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    imagePath: (entry: Parameters<ClipboardHistory["imagePath"]>[0]) => history.imagePath(entry),
    paste: (entry: Parameters<typeof pasteEntry>[0], to: PasteTarget) => pasteEntry(entry, to, pasting),
    copy: (entry: Parameters<typeof copyEntry>[0]) => copyEntry(entry, pasting),
    pasteSnippet: async (text: string, to: PasteTarget) => {
      const put = await putSnippet(text);
      if (!put) return false;
      await Bun.sleep(80);
      await request("send-keys", { window: to.id, chord: pasteChord(to.appId) });
      for (let step = 0; step < Math.min(put.back, 500); step++) await request("send-keys", { window: to.id, chord: "Left" });
      return true;
    },
    copySnippet: async (text: string) => (await putSnippet(text)) !== null,
    openSettings: options.openSettings,
  };

  const source = clipboardSource({
    open: (scope, ctx: ActionContext) => options.openLauncher(scope, ctx.window),
    enabled,
    setEnabled: (on) => settings.patch("clipboard", { history: on ? undefined : false }),
    count: () => history.getSnapshot().entries.length,
    clear: () => history.clear(),
    confirm: options.confirm,
  });

  return {
    history,
    snippets,
    scopes: [historyScope(scopeDeps), snippetsScope(scopeDeps)],
    source,
    opening,
    recent: (limit) => (enabled() ? history.getSnapshot().entries.slice(0, limit).map(forAgent) : []),
    close() {
      watch?.close();
      stopSettings();
      stopSnippets();
      stopExpanding();
      history.flush();
    },
  };
}
