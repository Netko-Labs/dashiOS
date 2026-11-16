/**
 * A scripted stand-in for llama-server on a Unix socket: each completion
 * request gets the next step of the script, said the way the real server
 * says it (server-sent events, more fields than the client reads).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bool, int, list, must, obj, str } from "@dashi/shape";
import type { Timers } from "../../src/shared/time/index.ts";

export type Step =
  | { say: string; pieces?: number }
  /** Says the pieces, then never finishes. */
  | { stall: string[] }
  | { status: number };

const AskedShape = obj({ messages: list(obj({ role: str(), content: str() })), max_tokens: int(), stream: bool() }, { strict: false });

export interface Asked {
  messages: { role: string; content: string }[];
  maxTokens: number;
  stream: boolean;
}

const chunk = (content: string | null, extra: object = {}): string =>
  `data: ${JSON.stringify({ choices: [{ finish_reason: null, index: 0, delta: content === null ? { role: "assistant", content: null } : { content } }], created: 1, id: "chatcmpl-x", model: "m", object: "chat.completion.chunk", ...extra })}\n\n`;

function stream(step: Step): Response {
  if ("status" in step) return new Response(JSON.stringify({ error: { message: "Loading model", code: step.status } }), { status: step.status });
  const encoder = new TextEncoder();
  const pieces =
    "stall" in step ? step.stall : (step.say.match(new RegExp(`.{1,${Math.max(1, Math.ceil(step.say.length / (step.pieces ?? 3)))}}`, "gs")) ?? []);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(chunk(null)));
      for (const piece of pieces) controller.enqueue(encoder.encode(chunk(piece)));
      if ("stall" in step) return;
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", index: 0, delta: {} }], timings: { predicted_n: pieces.length, predicted_ms: 1, prompt_n: 30 } })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

export interface ScriptedServer {
  socket: string;
  /** The completion requests so far. */
  asked: Asked[];
  /** How many times `/health` was asked. */
  health: number;
  /** Whether `/health` says the model is in memory. */
  up: boolean;
  script: Step[];
  close(): void;
}

export function scriptedServer(script: Step[] = []): ScriptedServer {
  const folder = mkdtempSync(join(tmpdir(), "dashi-rewrite-"));
  const state: ScriptedServer = { socket: join(folder, "s.sock"), asked: [], health: 0, up: true, script, close: () => {} };
  const server = Bun.serve({
    unix: state.socket,
    async fetch(request) {
      if (new URL(request.url).pathname === "/health") {
        state.health++;
        return new Response(state.up ? '{"status":"ok"}' : '{"error":{"message":"Loading model"}}', { status: state.up ? 200 : 503 });
      }
      const asked = must(AskedShape, await request.json());
      state.asked.push({ messages: asked.messages, maxTokens: asked.max_tokens, stream: asked.stream });
      return stream(state.script.shift() ?? { say: "" });
    },
  });
  state.close = () => {
    void server.stop(true);
    rmSync(folder, { recursive: true, force: true });
  };
  return state;
}

/** Timers a test moves by hand, and the clock that goes with them. */
export function handTimers(): { timers: Timers; now: () => number; advance(ms: number): void; pending(): number } {
  let time = 0;
  let next = 1;
  const waiting = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      set: (callback, ms) => {
        waiting.set(next, { at: time + ms, run: callback });
        return next++;
      },
      clear: (handle) => {
        if (typeof handle === "number") waiting.delete(handle);
      },
    },
    now: () => time,
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...waiting].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > time || !waiting.has(id)) continue;
        waiting.delete(id);
        timer.run();
      }
    },
    pending: () => waiting.size,
  };
}
