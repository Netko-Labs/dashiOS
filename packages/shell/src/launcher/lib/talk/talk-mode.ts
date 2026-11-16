/**
 * The launcher as the conversation's view (decisions.md D261): what Return
 * does with what is in the field, what the field's right end says, and the
 * answer's words cut into what the view draws (paragraphs, lists, links).
 * Pure: the view draws it, the tests read it.
 */

import type { DashiTurn, TranscriptView } from "../../../agents/index.ts";
import type { Hint } from "../../verbs.ts";

export type TalkSubmit =
  /** The words are the next turn (a turn still at work is stopped first). */
  | { kind: "send"; text: string }
  /** Return on a question that waits for a yes: yes. */
  | { kind: "yes" }
  /** Words typed while a question waits: its answer (a yes-or-no question's words are a no and the next turn). */
  | { kind: "answer"; text: string }
  | { kind: "instead"; text: string }
  /** The last turn failed: its one way on (Terminal to sign in, Settings › Agents). */
  | { kind: "sign-in" }
  | { kind: "settings" }
  | { kind: "none" };

const lastDashi = (view: TranscriptView): DashiTurn | undefined => view.turns.findLast((turn): turn is DashiTurn => turn.kind === "dashi");

/** What Return does with `draft` in the field. */
export function talkSubmit(view: TranscriptView, draft: string): TalkSubmit {
  const text = draft.trim();
  const waiting = view.waiting;
  if (waiting?.kind === "yes-no") return text ? { kind: "instead", text } : { kind: "yes" };
  if (waiting?.kind === "words") return text ? { kind: "answer", text } : { kind: "none" };
  if (text) return { kind: "send", text };
  const last = lastDashi(view);
  if (view.working || last?.state !== "failed") return { kind: "none" };
  return last.failed?.go === "launcher" ? { kind: "sign-in" } : last.failed?.go === "agents" ? { kind: "settings" } : { kind: "none" };
}

/** The field's right end: Stop and Keep working while it works, else what Return does, and Esc. */
export function talkHints(view: TranscriptView, draft: string): Hint[] {
  const text = draft.trim();
  if (view.waiting?.kind === "yes-no") return text ? [{ keys: "↩", label: "Send instead" }] : [{ keys: "↩", label: view.waiting.yes ?? "Yes" }];
  if (view.waiting?.kind === "words") return [{ keys: "↩", label: "Answer" }];
  if (view.working && !view.background)
    return [...(text ? [{ keys: "↩", label: "Send" }] : []), { keys: "❖↩", label: "Keep working on it" }, { keys: "❖Esc", label: "Stop" }];
  const submit = talkSubmit(view, draft);
  const go: Hint[] =
    submit.kind === "send"
      ? [
          { keys: "↩", label: "Send" },
          { keys: "❖↩", label: "Send and keep working" },
        ]
      : submit.kind === "sign-in"
        ? [{ keys: "↩", label: "Open Terminal" }]
        : submit.kind === "settings"
          ? [{ keys: "↩", label: "Open Settings" }]
          : [];
  return [...go, { keys: "Esc", label: "Close" }];
}

/** The placeholder: a reply, an answer to the question, or the first ask. */
export function talkPlaceholder(view: TranscriptView, name: string): readonly string[] {
  if (view.waiting?.kind === "yes-no") return ["Or type what to do instead", "Or type instead"];
  if (view.waiting?.kind === "words") return ["Type your answer"];
  return view.turns.length === 0 ? [`Ask ${name} anything`, "Ask anything"] : [`Reply to ${name}`, "Reply"];
}

/** A piece of an answer as the view draws it. */
export type Block = { kind: "paragraph"; text: string } | { kind: "item"; text: string; mark: string } | { kind: "code"; text: string };

/** An answer's words as blocks: paragraphs by blank lines, list items by "- ", "* " or "1. ", fenced code as is. */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      blocks.push({ kind: "item", text: item[3] ?? "", mark: item[2] ? `${item[2]}.` : "•" });
    } else if (line.trim() === "") flush();
    else paragraph.push(line.trim());
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flush();
  return blocks;
}

/** A line's words and the links in it, in order: a link is pressable. Markdown's `[words](https://…)` keeps its words. */
export type Span = { text: string; url?: string; code?: true };

export function spansOf(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+[^\s).,;:!?])|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > at) spans.push({ text: text.slice(at, match.index) });
    if (match[1] && match[2]) spans.push({ text: match[1], url: match[2] });
    else if (match[3]) spans.push({ text: match[3], url: match[3] });
    else if (match[4]) spans.push({ text: match[4], code: true });
    else spans.push({ text: match[5] ?? "" });
    at = match.index + match[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at) });
  return spans;
}

/** The empty view's tries: the person's recent asks, else these, until they have some. */
export const FIRST_TRIES: readonly string[] = [
  "Open Helium and go to YouTube",
  "Turn on Dark Mode",
  "What's on my calendar today?",
  "Put these two windows side by side",
  "What's the weather in Bogotá?",
];

export function tries(recent: readonly string[]): readonly string[] {
  const own = [...new Set(recent.map((ask) => ask.trim()).filter(Boolean))].slice(0, 5);
  return own.length > 0 ? own : FIRST_TRIES;
}
