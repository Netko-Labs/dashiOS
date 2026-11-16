/**
 * Corrections by Claude with the person's own key (decisions.md D200): chosen in Settings › Voice, "Corrections", only
 * when a key is set in Settings › Agents. The same prompt and checks as the model on this computer; one Messages API
 * request per dictation, over `fetch` to api.anthropic.com only (the base URL is fixed, so no setting of the session
 * sends the key or the words elsewhere). What was said leaves the computer, which the row says before it is chosen.
 *
 * Claude Haiku 5.5, for speed: thinking off and effort low (a sentence is cleaned, not reasoned about); no sampling
 * parameters (the API version refuses them). A network answer can take a second or more, so dictation lands the rules'
 * text first and replaces it when the answer comes (`refine`).
 *
 * The key goes in this request's headers and nowhere else: never logged, never in an error, never shown.
 */

import { list, maybe, nullable, obj, optional, str } from "@dashi/shape";
import { checkAnswer } from "../checks.ts";
import { rewriteMessages } from "../prompt.ts";
import type { RewriteFailure, RewriteReply, RewriteRequest, Rewriter } from "../types.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
export const HOSTED_MODEL = "claude-haiku-5-5";
/** The API version the request is written for (as agents/ask's Claude requests). */
const VERSION = "2026-10-21";
/** The longest a correction by Claude is waited for, the rules' text already typed. */
export const HOSTED_DEADLINE_MS = 6000;

const LOOSE = { strict: false };
const Reply = obj({ content: list(obj({ type: str(), text: optional(str()) }, LOOSE)), stop_reason: optional(nullable(str())) }, LOOSE);

export interface HostedOptions {
  /** Claude's key from Settings › Agents (the vault, else the session's); null when there is none. */
  key(): Promise<string | null>;
  /** For tests: what the request is sent with. */
  fetch?: typeof fetch;
  now?: () => number;
}

/** The request's body: the prompt's system part on its own, the examples and the transcript as the conversation. */
export function hostedBody(request: RewriteRequest): Record<string, unknown> {
  const messages = rewriteMessages({ ...request, tone: "", before: "" });
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const words = request.transcript.trim().split(/\s+/).length;
  return {
    model: HOSTED_MODEL,
    max_tokens: words * 3 + 64,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    // The prompt and its examples are the same every time: cached, so each dictation pays for its own words only.
    cache_control: { type: "ephemeral" },
    system,
    messages: messages.filter((message) => message.role !== "system"),
  };
}

export function hostedRewriter({ key, fetch: send = fetch, now = () => performance.now() }: HostedOptions): Rewriter {
  let hasKey: boolean | null = null;
  const look = (): void =>
    void key().then(
      (found) => (hasKey = found !== null),
      () => (hasKey = false),
    );
  look();
  return {
    rewrite: async (request): Promise<RewriteReply> => {
      const started = now();
      const timings = { firstTokenMs: null, tokens: 0 };
      const failed = (why: RewriteFailure, detail: string): RewriteReply => ({
        kind: "failed",
        why,
        detail,
        timings: { ...timings, totalMs: Math.round(now() - started) },
      });
      if (request.transcript.trim() === "") return { kind: "unchanged", timings: { ...timings, totalMs: 0 } };
      const found = await key().catch(() => null);
      hasKey = found !== null;
      if (!found) return failed("no-model", "no key");
      const signals = [AbortSignal.timeout(Math.max(1, request.deadlineMs)), ...(request.signal ? [request.signal] : [])];
      let body: unknown;
      try {
        const response = await send(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": found, "anthropic-version": VERSION },
          body: JSON.stringify(hostedBody(request)),
          signal: AbortSignal.any(signals),
        });
        if (!response.ok) return failed("gone", `HTTP ${response.status}`);
        body = await response.json();
      } catch {
        return failed(request.signal?.aborted ? "gone" : "deadline", "no answer in time");
      }
      const reply = maybe(Reply, body);
      if (!reply || reply.stop_reason === "refusal") return failed("refused", reply ? "refusal" : "unreadable");
      const text = reply.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
      const checked = checkAnswer(request.transcript, text, request.vocabulary);
      const totalMs = Math.round(now() - started);
      if (!checked.ok) return failed("refused", checked.check);
      if (checked.unchanged) return { kind: "unchanged", timings: { ...timings, totalMs } };
      return { kind: "text", text: checked.text, timings: { ...timings, totalMs } };
    },
    warm: look,
    state: () => (hasKey === false ? "no-model" : "ready"),
    advice: () => ({ land: "refine", deadlineMs: HOSTED_DEADLINE_MS }),
  };
}
