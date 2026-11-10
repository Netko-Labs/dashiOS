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
import { ClipboardHistory, type HistorySnapshot } from "./history.ts";
import { DEFAULT_LEFT_OUT } from "./left-out.ts";
import { clipboardSource } from "./lib/actions.ts";
import { expandSnippet } from "./lib/expand.ts";
import { atspiFieldCheck, type FieldCheck } from "./lib/fields.ts";
import { type ClipboardIo, wlClipboard } from "./lib/io.ts";
import { copyEntry, type PasteDeps, pasteChord, pasteEntry } from "./lib/paste.ts";
import { historyScope, type PasteTarget, snippetsScope } from "./lib/scope.ts";
import { expand, SnippetStore } from "./lib/snippets.ts";
import { ClipboardWatch, fileUris } from "./lib/watch.ts";

/** What an agent reads of one copy's text, at most. */
const AGENT_TEXT = 4000;

export interface ClipboardOptions {
  compositor: Pick<Compositor, "on" | "windows" | "sendKeys" | "snippetErase" | "snippets"> | null;
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

/** The two keyboard calls clipboard makes; they reject without a compositor. */
function keyCalls(compositor: Pick<Compositor, "sendKeys" | "snippetErase"> | null): Pick<Compositor, "sendKeys" | "snippetErase"> {
  const none = () => Promise.reject(new Error("no compositor"));
  return { sendKeys: (params) => compositor?.sendKeys(params) ?? none(), snippetErase: (params) => compositor?.snippetErase(params) ?? none() };
}

/** The clipboard watch on the compositor's copies; none without a compositor. */
function startWatch(
  options: ClipboardOptions,
  compositor: NonNullable<ClipboardOptions["compositor"]>,
  parts: { history: ClipboardHistory; io: ClipboardIo; fields: FieldCheck; enabled: () => boolean; leftOut: () => readonly string[] },
): ClipboardWatch {
  return new ClipboardWatch({
    on: (listener) => compositor.on(listener),
    windows: () => compositor.windows(),
    history: parts.history,
    io: parts.io,
    fields: parts.fields,
    enabled: parts.enabled,
    leftOut: parts.leftOut,
    paused: options.paused,
    isVault: options.isVault,
    appName: options.appName,
  });
}

/** Turned off, from here or Settings or by hand: what was kept goes. Returns the way to stop. */
function followHistorySwitch(settings: SettingsStore, history: ClipboardHistory, enabled: () => boolean, changed: () => void): () => void {
  let wasOn = enabled();
  return settings.subscribe(() => {
    const on = enabled();
    if (wasOn && !on) history.clear();
    wasOn = on;
    changed();
  });
}

/** The keywords the compositor watches for, sent now and again whenever the snippets change. */
function followKeywords(compositor: ClipboardOptions["compositor"], snippets: SnippetStore): () => void {
  const send = () =>
    void compositor
      ?.snippets({ keywords: snippets.getSnapshot().map((each) => each.keyword) })
      .catch((error) => console.error("dashi-shell: dashi-comp refused the snippets' keywords:", error));
  send();
  return snippets.subscribe(send);
}

/** A snippet the compositor reports typed is expanded where it was typed. */
function expandOnCompositor(compositor: ClipboardOptions["compositor"], deps: Parameters<typeof expandSnippet>[2]): () => void {
  return (
    compositor?.on((event) => {
      if (event.event === "snippet") void expandSnippet(event.keyword, event.window, deps).catch((error) => console.error("dashi-shell: a snippet:", error));
    }) ?? (() => {})
  );
}

/** A snippet's text, its placeholders filled in, on the clipboard (never kept). Resolves to its cursor step back, or null. */
async function putSnippet(
  history: ClipboardHistory,
  io: ClipboardIo,
  pasting: PasteDeps & Pick<Compositor, "snippetErase">,
  locale: string | undefined,
  text: string,
): Promise<{ back: number } | null> {
  const top = history.getSnapshot().entries[0];
  const filled = expand(text, {
    now: new Date(),
    ...(locale ? { locale } : {}),
    clipboard: top?.kind === "text" ? (top.text ?? null) : null,
  });
  pasting.watch.expect("text", filled.text, "skip");
  const there = pasting.watch.nextCopy(500);
  if (!(await io.write("text/plain;charset=utf-8", filled.text))) return null;
  await there;
  return { back: filled.back };
}

/** What the two launcher scopes need from the rest of clipboard. */
function scopeDepsOf(parts: {
  history: ClipboardHistory;
  snippets: SnippetStore;
  enabled: () => boolean;
  target: () => PasteTarget | null;
  changes: Set<() => void>;
  pasting: PasteDeps & Pick<Compositor, "snippetErase">;
  put(text: string): Promise<{ back: number } | null>;
  openSettings(): void;
}) {
  const { history, snippets, pasting, put } = parts;
  return {
    history,
    snippets,
    enabled: parts.enabled,
    target: parts.target,
    onChange: (listener: () => void) => {
      parts.changes.add(listener);
      return () => parts.changes.delete(listener);
    },
    imagePath: (entry: Parameters<ClipboardHistory["imagePath"]>[0]) => history.imagePath(entry),
    paste: (entry: Parameters<typeof pasteEntry>[0], to: PasteTarget) => pasteEntry(entry, to, pasting),
    copy: (entry: Parameters<typeof copyEntry>[0]) => copyEntry(entry, pasting),
    pasteSnippet: async (text: string, to: PasteTarget) => {
      const placed = await put(text);
      if (!placed) return false;
      await Bun.sleep(80);
      await pasting.sendKeys({ window: to.id, chord: pasteChord(to.appId) });
      for (let step = 0; step < Math.min(placed.back, 500); step++) await pasting.sendKeys({ window: to.id, chord: "Left" });
      return true;
    },
    copySnippet: async (text: string) => (await put(text)) !== null,
    openSettings: parts.openSettings,
  };
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
  const stopSettings = followHistorySwitch(settings, history, enabled, changed);

  const watch = compositor ? startWatch(options, compositor, { history, io, fields, enabled, leftOut }) : null;
  const pasting: PasteDeps & Pick<Compositor, "snippetErase"> = {
    io,
    watch: watch ?? { expect: () => {}, nextCopy: async () => false },
    imagePath: (entry) => history.imagePath(entry),
    ...keyCalls(compositor),
  };

  const stopSnippets = followKeywords(compositor, snippets);
  const stopExpanding = expandOnCompositor(compositor, {
    ...pasting,
    snippets,
    windows: () => compositor?.windows() ?? Promise.resolve([]),
    fields: snippetFields,
    inTerminals: () => section().snippetsInTerminals === true,
    history: () => history.getSnapshot(),
    ...(options.locale ? { locale: options.locale } : {}),
  });

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

  const scopes = scopeDepsOf({
    history,
    snippets,
    enabled,
    target: () => target,
    changes,
    pasting,
    put: (text) => putSnippet(history, io, pasting, options.locale, text),
    openSettings: options.openSettings,
  });

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
    scopes: [historyScope(scopes), snippetsScope(scopes)],
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
