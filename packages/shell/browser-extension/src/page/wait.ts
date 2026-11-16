/**
 * What wait_for waits for in a page, and the pure part of telling whether
 * it happened (content/wait.ts watches the page; this is tested without one).
 */

export type PageWait =
  | { kind: "text"; text: string }
  | { kind: "text-gone"; text: string }
  | { kind: "element"; ref: number; state: "present" | "enabled" | "gone" }
  | { kind: "quiet"; quietMs: number };

export interface WaitResult {
  met: boolean;
  /** How long it waited, in ms. */
  ms: number;
  /** For text: the line it was found in; for an element: what it is now. */
  detail?: string;
}

const fold = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

/** The line of the page's shown text that holds `wanted` (case and spacing ignored), or null. */
export function lineWith(pageText: string, wanted: string): string | null {
  const needle = fold(wanted).trim();
  if (!needle) return null;
  for (const line of pageText.split("\n")) {
    if (fold(line).includes(needle)) return line.trim().slice(0, 200);
  }
  return null;
}

/** A wait from the background's message, or null when it is not one. */
export function parseWait(message: Record<string, unknown>): PageWait | null {
  const text = typeof message.text === "string" ? message.text : "";
  switch (message.kind) {
    case "text":
    case "text-gone":
      return text ? { kind: message.kind, text } : null;
    case "element": {
      const state = message.state === "enabled" || message.state === "gone" ? message.state : "present";
      return typeof message.ref === "number" ? { kind: "element", ref: message.ref, state } : null;
    }
    case "quiet":
      return { kind: "quiet", quietMs: typeof message.quietMs === "number" ? message.quietMs : 500 };
    default:
      return null;
  }
}
