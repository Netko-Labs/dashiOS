import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipboardHistory } from "../src/clipboard/history.ts";
import { DEFAULT_LEFT_OUT } from "../src/clipboard/left-out.ts";
import { currentCopy, expandSnippet, refusal } from "../src/clipboard/lib/expand.ts";
import type { ClipboardIo } from "../src/clipboard/lib/io.ts";
import { pasteChord } from "../src/clipboard/lib/paste.ts";
import { snippetSections } from "../src/clipboard/lib/rows.ts";
import { expand, keywordProblem, parseAdd, parseSnippets, SnippetStore } from "../src/clipboard/lib/snippets.ts";
import { ClipboardWatch } from "../src/clipboard/lib/watch.ts";
import type { CompositorEvent, CompositorWindow } from "../src/compositor.ts";
import { type FakeRequest, fakeCompositor as typedCompositor } from "./support/compositor.ts";
import { settle } from "./support/time.ts";

/** The two compositor calls expanding makes, over a fake `request`. */
const sends = (request: FakeRequest) => {
  const { sendKeys, snippetErase } = typedCompositor(request);
  return { sendKeys, snippetErase };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-snippets-"));
  dirs.push(dir);
  return dir;
};

const window = (over: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id: 7,
  appId: "dev.dashi.notes",
  title: "Notes",
  pid: 4242,
  focused: true,
  state: "normal",
  frame: null,
  titleBar: 0,
  ...over,
});

test("the snippets field adds a keyword and its text; keywords must not start alike", () => {
  expect(parseAdd(";addr Calle de la Luna 12, 2º B")).toEqual({ keyword: ";addr", text: "Calle de la Luna 12, 2º B" });
  expect(parseAdd(";addr")).toBeNull();
  expect(parseAdd("a text")).toBeNull();
  const kept = [{ keyword: ";addr", text: "x" }];
  expect(keywordProblem(";addr", kept)).toBe("“;addr” is a snippet already");
  expect(keywordProblem(";ad", kept)).toBe("“;ad” and “;addr” start alike");
  expect(keywordProblem(";sig", kept)).toBeNull();
  expect(parseSnippets({ snippets: [{ keyword: ";a1", text: "x" }, { keyword: ";a12", text: "y" }, { keyword: "x", text: "z" }, "junk"] })).toEqual([
    { keyword: ";a1", text: "x" },
  ]);
});

test("placeholders: the date, the time, the clipboard, and where the caret goes", () => {
  const now = new Date(2026, 10, 5, 14, 30);
  const filled = expand("On {date} at {time}: {clipboard}{cursor}!", { now, locale: "en-US", clipboard: "hi" });
  // The time as ICU writes it (some versions put a narrow space before PM).
  const time = new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(now);
  expect(filled).toEqual({ text: `On Nov 5, 2026 at ${time}: hi!`, back: 1 });
  expect(expand("plain", { now, clipboard: null })).toEqual({ text: "plain", back: 0 });
});

test("the store is a 0600 file, sorted by keyword", () => {
  const path = join(tempDir(), "dashi", "snippets.json");
  const store = new SnippetStore(path);
  expect(store.add({ keyword: ";sig", text: "Alex Kim" })).toBeNull();
  expect(store.add({ keyword: ";addr", text: "Calle de la Luna 12" })).toBeNull();
  expect(store.add({ keyword: ";ad", text: "no" })).not.toBeNull();
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(path, "utf8")).snippets.map((each: { keyword: string }) => each.keyword)).toEqual([";addr", ";sig"]);
  store.remove(";sig");
  expect(new SnippetStore(path).getSnapshot()).toEqual([{ keyword: ";addr", text: "Calle de la Luna 12" }]);
});

test("the snippets' rows: adding, its problem in place, and the list", () => {
  const snippets = [{ keyword: ";addr", text: "Calle de la Luna 12" }];
  expect(snippetSections(snippets, "")[0]?.rows.map((row) => row.id)).toEqual(["snippet:;addr"]);
  expect(snippetSections(snippets, ";sig Alex Kim")[0]?.rows.map((row) => [row.id, row.title])).toEqual([["snippet:add", "Add snippet “;sig”"]]);
  const clash = snippetSections(snippets, ";ad other")[0]?.rows[0];
  expect(clash?.title).toBe("“;ad” and “;addr” start alike");
  expect(clash?.danger).toBe(true);
  expect(snippetSections([], "")[0]?.rows.map((row) => row.title)).toEqual(["No snippets yet"]);
});

test("never in a terminal (unless allowed) or a password field; paste is ⌃⇧V in terminals", () => {
  expect(refusal({ appId: "dev.dashi.terminal" }, false, false)).toBe("a terminal");
  expect(refusal({ appId: "dev.dashi.terminal" }, true, false)).toBeNull();
  expect(refusal({ appId: "dev.dashi.notes" }, false, true)).toBe("a password field");
  expect(refusal(null, true, false)).toBe("no window");
  expect(pasteChord("foot")).toBe("ctrl+shift+v");
  expect(pasteChord("org.mozilla.firefox")).toBe("ctrl+v");
});

function fakeIo(clipboard: Map<string, Uint8Array>, log: string[]): ClipboardIo {
  return {
    read: async (mime) => clipboard.get(mime) ?? null,
    write: async (mime, data) => {
      log.push(`write ${mime} ${typeof data === "string" ? data : `${data.length} bytes`}`);
      return true;
    },
  };
}

test("a typed keyword's text is copied, the keyword erased, the text pasted, and the copy before it put back", async () => {
  const dir = tempDir();
  const history = new ClipboardHistory({ dir, sync: true });
  history.add({ kind: "text", mime: "text/plain;charset=utf-8", text: "what I copied", app: "Notes" });
  const log: string[] = [];
  const watch = {
    expect: (_kind: string, content: string | Uint8Array, how: string) => void log.push(`expect ${how} ${String(content)}`),
    nextCopy: async () => true,
  };
  const deps = {
    io: fakeIo(new Map(), log),
    watch,
    imagePath: () => null,
    ...sends(async (method, params) => {
      log.push(`${method} ${JSON.stringify(params)}`);
      return {};
    }),
    snippets: { find: (keyword: string) => (keyword === ";hi" ? { keyword, text: "Hello {clipboard}{cursor}." } : undefined) },
    windows: async () => [window()],
    fields: { passwordFocused: async () => false },
    inTerminals: () => false,
    history: () => history.getSnapshot(),
  };
  expect(await expandSnippet(";hi", 7, deps)).toBe(true);
  expect(log).toEqual([
    "expect skip Hello what I copied.",
    "write text/plain;charset=utf-8 Hello what I copied.",
    'snippet-erase {"window":7,"keyword":";hi"}',
    'send-keys {"window":7,"chord":"ctrl+v"}',
    'send-keys {"window":7,"chord":"Left"}',
    "expect bump what I copied",
    "write text/plain;charset=utf-8 what I copied",
  ]);
  // A password field, or typing on past the keyword (the compositor refuses to erase it): nothing is typed.
  log.length = 0;
  expect(await expandSnippet(";hi", 7, { ...deps, fields: { passwordFocused: async () => true } })).toBe(false);
  const refusing = {
    ...deps,
    ...sends(async (method) => {
      log.push(method);
      if (method === "snippet-erase") throw new Error("typed on");
      return {};
    }),
  };
  log.length = 0;
  expect(await expandSnippet(";hi", 7, refusing)).toBe(false);
  // The copy before is put back at once.
  expect(log).toEqual([
    "expect skip Hello what I copied.",
    "write text/plain;charset=utf-8 Hello what I copied.",
    "snippet-erase",
    "expect bump what I copied",
    "write text/plain;charset=utf-8 what I copied",
  ]);
  // The paste can't be sent after the erase: the copy before still comes back.
  log.length = 0;
  const noPaste = {
    ...deps,
    ...sends(async (method) => {
      log.push(method);
      if (method === "send-keys") throw new Error("no such window");
      return {};
    }),
  };
  expect(await expandSnippet(";hi", 7, noPaste)).toBe(false);
  expect(log.slice(-2)).toEqual(["expect bump what I copied", "write text/plain;charset=utf-8 what I copied"]);
  // A clipboard that can't be written: the keyword stays as typed.
  log.length = 0;
  const noClipboard = { ...deps, io: { ...deps.io, write: async () => false } };
  expect(await expandSnippet(";hi", 7, noClipboard)).toBe(false);
  expect(log).toEqual(["expect skip Hello what I copied."]);
  // The clipboard's copy is only put back when the history has it: one left out since is not.
  history.skipped("secret", null);
  expect(currentCopy(history.getSnapshot())).toBeNull();
});

/** A compositor that sends what the test says. */
function fakeCompositor(windows: CompositorWindow[]) {
  const listeners = new Set<(event: CompositorEvent) => void>();
  return {
    on: (listener: (event: CompositorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    windows: async () => windows,
    copied: (mimeTypes: string[], window: number | null = 7) => {
      for (const listener of listeners) listener({ event: "selection", mimeTypes, window });
    },
  };
}

test("the watch keeps what the rules allow, reads KDE's hint first, and counts what it left out", async () => {
  const history = new ClipboardHistory({ dir: tempDir(), sync: true });
  const clipboard = new Map<string, Uint8Array>();
  const compositor = fakeCompositor([window(), window({ id: 8, appId: "org.keepassxc.KeePassXC", pid: 99 })]);
  const encode = (text: string) => new TextEncoder().encode(text);
  const watch = new ClipboardWatch({
    on: compositor.on,
    windows: compositor.windows,
    history,
    io: fakeIo(clipboard, []),
    fields: { passwordFocused: async () => false },
    enabled: () => true,
    leftOut: () => DEFAULT_LEFT_OUT,
    paused: () => false,
    isVault: () => false,
    appName: (each) => (each.appId === "dev.dashi.notes" ? "Notes" : "KeePassXC"),
    program: () => null,
  });
  clipboard.set("text/plain;charset=utf-8", encode("a note"));
  compositor.copied(["text/plain;charset=utf-8"]);
  await settle();
  expect(history.getSnapshot().entries.map((entry) => [entry.text, entry.app])).toEqual([["a note", "Notes"]]);
  // KeePassXC by app, and its hint too.
  clipboard.set("text/plain;charset=utf-8", encode("hunter2"));
  compositor.copied(["text/plain;charset=utf-8"], 8);
  clipboard.set("x-kde-passwordManagerHint", encode("secret"));
  compositor.copied(["text/plain;charset=utf-8", "x-kde-passwordManagerHint"]);
  await settle();
  expect(history.getSnapshot().entries.length).toBe(1);
  expect(history.getSnapshot().skipped.map((skip) => skip.reason)).toEqual(["left out", "secret"]);
  // The shell's own paste moves the copy up as it was; a snippet's text is never kept.
  clipboard.set("text/plain;charset=utf-8", encode("a snippet"));
  watch.expect("text", "a snippet", "skip");
  compositor.copied(["text/plain;charset=utf-8"]);
  await settle();
  expect(history.getSnapshot().entries.map((entry) => entry.text)).toEqual(["a note"]);
  watch.close();
});
