/**
 * One completion from the model's server (llama.cpp's `llama-server`, on a
 * Unix socket), read as it streams, under a deadline. It never throws: what
 * went wrong comes back as a kind.
 */

import { list, maybe, nullable, num, obj, optional, str } from "@dashi/shape";
import { realTimers, type Timers } from "../../shared/time/index.ts";
import type { Message } from "../prompt.ts";

export interface CompleteOptions {
  socket: string;
  deadlineMs: number;
  /** The most tokens the answer may have: a runaway answer is cut, and then refused for its length. */
  maxTokens: number;
  signal?: AbortSignal | undefined;
  timers?: Timers;
  now?: () => number;
}

export type Completed =
  | { ok: true; text: string; firstTokenMs: number | null; tokens: number }
  | { ok: false; why: "starting" | "deadline" | "gone"; detail: string; firstTokenMs: number | null; tokens: number };

/** The server says more than this in each chunk; the rest is not read. */
const LOOSE = { strict: false };
const Chunk = obj(
  {
    choices: optional(list(obj({ delta: optional(obj({ content: optional(nullable(str())) }, LOOSE)) }, LOOSE))),
    timings: optional(obj({ predicted_n: optional(num()) }, LOOSE)),
  },
  LOOSE,
);

/** The server's address for `fetch`: the host is not used, the socket is. */
const URL = "http://dashi-rewrite/v1/chat/completions";

interface Reading {
  text: string;
  firstTokenMs: number | null;
  tokens: number;
}

/** Reads the stream's lines into `into`; returns when the server says it is done or the stream ends. */
async function read(body: ReadableStream<Uint8Array>, into: Reading, elapsed: () => number): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const bytes of body) {
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const chunk = maybe(Chunk, json);
      const piece = chunk?.choices?.[0]?.delta?.content;
      if (piece) {
        into.firstTokenMs ??= elapsed();
        into.text += piece;
        into.tokens++;
      }
      const counted = chunk?.timings?.predicted_n;
      if (counted !== undefined) into.tokens = counted;
    }
  }
}

export async function complete(messages: readonly Message[], options: CompleteOptions): Promise<Completed> {
  const { timers = realTimers, now = () => performance.now() } = options;
  const started = now();
  const elapsed = (): number => Math.round(now() - started);
  const into: Reading = { text: "", firstTokenMs: null, tokens: 0 };
  const failed = (why: "starting" | "deadline" | "gone", detail: string): Completed => ({
    ok: false,
    why,
    detail,
    firstTokenMs: into.firstTokenMs,
    tokens: into.tokens,
  });
  if (options.signal?.aborted) return failed("gone", "aborted");
  const abort = new AbortController();
  let ended: "deadline" | "gone" | null = null;
  const end = (why: "deadline" | "gone") => (): void => {
    ended ??= why;
    abort.abort();
  };
  const timer = timers.set(end("deadline"), options.deadlineMs);
  const onAbort = end("gone");
  options.signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(URL, {
      unix: options.socket,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, stream: true, temperature: 0, max_tokens: options.maxTokens, cache_prompt: true }),
      signal: abort.signal,
    });
    // 503: the model is still being read from disk.
    if (response.status === 503) return failed("starting", "the model is loading");
    if (!response.ok || !response.body) return failed("gone", `the server answered ${response.status}`);
    await read(response.body, into, elapsed);
    if (ended) return failed(ended, ended === "deadline" ? `no whole answer in ${options.deadlineMs} ms` : "aborted");
    return { ok: true, text: into.text, firstTokenMs: into.firstTokenMs, tokens: into.tokens };
  } catch (error) {
    if (ended) return failed(ended, ended === "deadline" ? `no whole answer in ${options.deadlineMs} ms` : "aborted");
    return failed("gone", error instanceof Error ? error.message : String(error));
  } finally {
    timers.clear(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Whether the server is up and its model is in memory. */
export async function healthy(socket: string): Promise<boolean> {
  try {
    const response = await fetch("http://dashi-rewrite/health", { unix: socket });
    return response.ok;
  } catch {
    return false;
  }
}
