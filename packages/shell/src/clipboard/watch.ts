/**
 * Keeping copies: the compositor says the clipboard has a new copy
 * (`selection`: its types, and the window that had the keyboard); the
 * privacy rules (privacy.ts) say whether it may be kept, from what the
 * shell can find out about that window; only then is it read, by type,
 * through data-control (io.ts), and added to the history. A copy that a
 * newer one overtook while it was being checked or read is dropped, so a
 * verdict never lands on another copy's data.
 *
 * The shell's own copies (pasting from the history, a snippet going in)
 * are known by their content: a paste moves its copy to the top as it was,
 * a snippet's text is never kept.
 */

import { readFileSync } from "node:fs";
import type { CompositorEvent, CompositorWindow } from "../compositor.ts";
import type { FieldCheck } from "./fields.ts";
import { type ClipboardHistory, copyId, type EntryKind, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, type NewCopy } from "./history.ts";
import { imageSize } from "./images.ts";
import type { ClipboardIo } from "./io.ts";
import { type CopyKind, hintIsSecret, PASSWORD_MANAGER_HINT, verdict } from "./privacy.ts";

export interface WatchDeps {
  on(listener: (event: CompositorEvent) => void): () => void;
  windows(): Promise<CompositorWindow[]>;
  history: ClipboardHistory;
  io: ClipboardIo;
  fields: FieldCheck;
  /** Clipboard history is on (Settings › Keyboard). */
  enabled(): boolean;
  /** The apps left out (privacy.ts DEFAULT_LEFT_OUT, as Settings has them). */
  leftOut(): readonly string[];
  /** The screen is being shared or recorded, or is locked. */
  paused(): boolean;
  /** Whether a window is Dashi's vault (Settings showing Passwords). */
  isVault(window: CompositorWindow): boolean;
  /** What the person calls a window's app. */
  appName(window: CompositorWindow): string;
  /** A process's program name (/proc/<pid>/comm). */
  program?(pid: number): string | null;
}

/** A process's name, as the kernel has it. */
export function programOf(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The file URIs of a URI list (or GNOME's copied-files list, whose first line says copy or cut). */
export function fileUris(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("file://"));
}

/** A copy read as `kind`, made into what the history keeps; null when there is nothing worth keeping. */
export function copyFrom(kind: CopyKind, bytes: Uint8Array, app: { name: string | null; appId?: string }): NewCopy | null {
  const base = { app: app.name, ...(app.appId ? { appId: app.appId } : {}) };
  if (kind.kind === "image") {
    const size = imageSize(bytes);
    return { ...base, kind: "image", mime: kind.mime, imageBytes: bytes, ...(size ? { size } : {}) };
  }
  const text = new TextDecoder().decode(bytes);
  if (kind.kind === "files") {
    const uris = fileUris(text);
    return uris.length > 0 ? { ...base, kind: "files", mime: "text/uri-list", text: `${uris.join("\r\n")}\r\n` } : null;
  }
  return text.trim() === "" ? null : { ...base, kind: "text", mime: "text/plain;charset=utf-8", text };
}

const contentOf = (copy: NewCopy): string | Uint8Array => copy.imageBytes ?? copy.text ?? "";

export class ClipboardWatch {
  private serial = 0;
  private readonly own = new Map<string, "bump" | "skip">();
  private readonly waiting = new Set<() => void>();
  private readonly off: () => void;
  private readonly expiry: ReturnType<typeof setInterval>;

  constructor(private readonly deps: WatchDeps) {
    this.off = deps.on((event) => {
      if (event.event !== "selection") return;
      for (const wake of [...this.waiting]) wake();
      void this.copied(event.mimeTypes, event.window).catch((error) => console.error("dashi-shell: clipboard history:", error));
    });
    this.expiry = setInterval(() => deps.history.expire(), 3600_000);
  }

  /** The shell is about to copy this: when it comes back, `bump` keeps the entry as it is (on top), `skip` keeps nothing. */
  expect(kind: EntryKind, content: string | Uint8Array, how: "bump" | "skip"): void {
    this.own.set(copyId(kind, content), how);
  }

  /** Resolves true at the next copy (the compositor's `selection`), false after `ms`. */
  nextCopy(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiting.delete(wake);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiting.delete(wake);
        resolve(false);
      }, ms);
      this.waiting.add(wake);
    });
  }

  private async copied(mimeTypes: readonly string[], windowId: number | null): Promise<void> {
    const serial = ++this.serial;
    const deps = this.deps;
    if (!deps.enabled() || mimeTypes.length === 0) return;
    const window = windowId === null ? null : ((await deps.windows().catch(() => [])).find((each) => each.id === windowId) ?? null);
    const pid = window?.pid ?? null;
    const name = window ? deps.appName(window) : null;
    const passwordField = pid !== null && !deps.paused() ? await deps.fields.passwordFocused(pid).catch(() => false) : false;
    const decided = verdict(
      {
        mimeTypes,
        app: window ? { appId: window.appId, program: pid === null ? null : (deps.program ?? programOf)(pid) } : null,
        vault: window ? deps.isVault(window) : false,
        passwordField,
        paused: deps.paused(),
      },
      deps.leftOut(),
    );
    if ("ignore" in decided) return;
    if ("skip" in decided) return deps.history.skipped(decided.skip, name);
    if (decided.readHint) {
      const hint = await deps.io.read(PASSWORD_MANAGER_HINT, 64);
      if (hintIsSecret(hint === null ? null : new TextDecoder().decode(hint))) return deps.history.skipped("secret", name);
    }
    if (serial !== this.serial) return;
    const max = decided.keep.kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
    const bytes = await deps.io.read(decided.keep.mime, max);
    // A newer copy came while this one was read: its data may be the newer one's.
    if (bytes === null || serial !== this.serial) return;
    const copy = copyFrom(decided.keep, bytes, { name, ...(window ? { appId: window.appId } : {}) });
    if (!copy) return;
    const id = copyId(copy.kind, contentOf(copy));
    const own = this.own.get(id);
    this.own.delete(id);
    if (own === "skip") return;
    const before = own === "bump" ? deps.history.get(id) : undefined;
    deps.history.add(before ? { ...copy, app: before.app, ...(before.appId ? { appId: before.appId } : {}) } : copy);
  }

  close(): void {
    this.off();
    clearInterval(this.expiry);
  }
}
