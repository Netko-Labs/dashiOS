/**
 * What the shell and Dashi's browser extension say to each other, through
 * dashi-browser-host (docs/actions.md, "Websites"). The shell sends requests
 * (`{id, method, params}`); the extension answers each once (`{id, ok,
 * result | error}`). The host's first line is its own (`host`): the browser's
 * process and the extension that started it.
 *
 * Parsed on receipt: the browser's pages are untrusted, and so is what a
 * broken extension might send. Pure, so tested.
 */

export type BrowserMethod = "tabs" | "activate" | "open" | "read" | "click" | "fill" | "select" | "press" | "scroll" | "field" | "filled";

export interface BrowserRequest {
  id: number;
  method: BrowserMethod;
  params: Record<string, unknown>;
}

export type BrowserReply = { id: number; ok: true; result: Record<string, unknown> } | { id: number; ok: false; error: string };

/** The host's introduction: which browser started it, for which extension. */
export interface HostHello {
  event: "host";
  /** The browser's process (the host's parent): its windows are this pid's. */
  browserPid: number;
  /** The extension's id, from the origin the browser gave the host. */
  extension: string;
  version: string;
}

export type FromBrowser = { kind: "reply"; reply: BrowserReply } | { kind: "hello"; hello: HostHello } | { kind: "invalid"; why: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One line from the host. */
export function parseFromBrowser(line: string): FromBrowser {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "invalid", why: "not JSON" };
  }
  if (!isRecord(value)) return { kind: "invalid", why: "not an object" };
  if (value.event === "host") {
    const { browserPid, extension, version } = value;
    if (typeof browserPid !== "number" || !Number.isInteger(browserPid) || browserPid <= 1) return { kind: "invalid", why: "bad browserPid" };
    if (typeof extension !== "string" || typeof version !== "string") return { kind: "invalid", why: "bad host hello" };
    return { kind: "hello", hello: { event: "host", browserPid, extension, version } };
  }
  const { id, ok } = value;
  if (typeof id !== "number" || !Number.isInteger(id)) return { kind: "invalid", why: "no id" };
  if (ok === true) return { kind: "reply", reply: { id, ok, result: isRecord(value.result) ? value.result : {} } };
  if (ok === false) return { kind: "reply", reply: { id, ok, error: typeof value.error === "string" ? value.error.slice(0, 2000) : "The browser failed." } };
  return { kind: "invalid", why: "no ok" };
}

/** A tab as the extension describes it. */
export interface TabInfo {
  id: number;
  windowId: number;
  active: boolean;
  title: string;
  url: string;
  loading: boolean;
}

export function parseTab(value: unknown): TabInfo | null {
  if (!isRecord(value)) return null;
  const { id, windowId, active, title, url, loading } = value;
  if (typeof id !== "number" || typeof windowId !== "number") return null;
  return {
    id,
    windowId,
    active: active === true,
    title: typeof title === "string" ? title : "",
    url: typeof url === "string" ? url : "",
    loading: loading === true,
  };
}

/** A field as the extension found it (sign-in's check, agents/secrets/lib/field-check.ts). */
export interface FieldReport {
  /** The frame it is in (0: the page itself). */
  frameId: number;
  kind: "password" | "text" | "other";
  /** The addresses of the documents around it, innermost first: its frame's, then each parent's. */
  documents: string[];
  /** Whether it has the focus in its page now. */
  focused: boolean;
  /** Where it is, in CSS pixels of the tab's viewport (null in a frame, which is placed in its own). */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** The viewport's size in CSS pixels. */
  viewport: { width: number; height: number };
  tab: TabInfo;
}

export function parseField(value: Record<string, unknown>): FieldReport | null {
  const { kind, documents, focused, rect, viewport, frameId } = value;
  const tab = parseTab(value.tab);
  if (!tab || (kind !== "password" && kind !== "text" && kind !== "other")) return null;
  if (!Array.isArray(documents) || !documents.every((url) => typeof url === "string")) return null;
  const box = (input: unknown) =>
    isRecord(input) && ["x", "y", "width", "height"].every((key) => typeof input[key] === "number")
      ? (input as { x: number; y: number; width: number; height: number })
      : null;
  const size = isRecord(viewport) && typeof viewport.width === "number" && typeof viewport.height === "number" ? viewport : { width: 0, height: 0 };
  return {
    frameId: typeof frameId === "number" && Number.isInteger(frameId) ? frameId : 0,
    kind,
    documents: documents as string[],
    focused: focused === true,
    rect: box(rect),
    viewport: { width: Number(size.width), height: Number(size.height) },
    tab,
  };
}
