import { afterEach, expect, test } from "bun:test";
import { MODEL } from "../src/rewrite/lib/model.ts";
import type { RewriteService } from "../src/rewrite/lib/service.ts";
import type { Speed, SpeedStore } from "../src/rewrite/lib/speed-store.ts";
import { rewriteMessages } from "../src/rewrite/prompt.ts";
import { createRewriter, type RewriterOptions, WORDS_MOST } from "../src/rewrite/rewriter.ts";
import type { RewriteRequest } from "../src/rewrite/types.ts";
import { handTimers, type ScriptedServer, type Step, scriptedServer } from "./support/rewrite-server.ts";
import { until } from "./support/time.ts";

let server: ScriptedServer | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

const request = (transcript: string, more: Partial<RewriteRequest> = {}): RewriteRequest => ({
  transcript,
  languages: ["en"],
  vocabulary: [],
  before: "",
  tone: "",
  deadlineMs: 1200,
  ...more,
});

const FAST: Speed = { model: MODEL.file, ms: 400 };

function memory(speed: Speed | null): SpeedStore & { written: Speed[] } {
  const store = {
    written: [] as Speed[],
    read: () => speed,
    write: (next: Speed) => {
      speed = next;
      store.written.push(next);
    },
  };
  return store;
}

/** A rewriter on a scripted server whose first answer is the priming one ("Okay."). */
function rig(script: Step[], options: Partial<RewriterOptions> & { speed?: SpeedStore } = {}) {
  const scripted = scriptedServer([{ say: "Okay." }, ...script]);
  server = scripted;
  const hand = handTimers();
  const calls = { start: 0, stop: 0 };
  const service: RewriteService = {
    socket: scripted.socket,
    start: async () => {
      calls.start++;
      return true;
    },
    stop: async () => {
      calls.stop++;
    },
  };
  const rewriter = createRewriter({ service, usable: () => "ok", speed: memory(FAST), timers: hand.timers, now: hand.now, ...options });
  return { rewriter, scripted, hand, calls };
}

test("a correction comes back as text, with what it took", async () => {
  const { rewriter, scripted } = rig([{ say: "Meet me at six." }]);
  const reply = await rewriter.rewrite(request("Meet me at five, no, I mean six."));
  expect(reply).toEqual({ kind: "text", text: "Meet me at six.", timings: { totalMs: 0, firstTokenMs: 0, tokens: 3 } });
  // The fixed part first, the transcript last, as a stream, with a ceiling on the answer.
  const asked = scripted.asked.at(-1);
  expect(asked?.messages[0]?.role).toBe("system");
  expect(asked?.messages.at(-1)?.content).toBe("<transcript>\nMeet me at five, no, I mean six.\n</transcript>");
  expect(asked?.stream).toBe(true);
  expect(asked?.maxTokens).toBe(8 * 3 + 32);
  expect(rewriter.state()).toBe("ready");
});

test("the same words back is 'unchanged'", async () => {
  const { rewriter } = rig([{ say: "\nIt works on my machine." }]);
  expect((await rewriter.rewrite(request("It works on my machine."))).kind).toBe("unchanged");
});

test("an answer that fails a check is refused, and names the check", async () => {
  const { rewriter } = rig([{ say: "Paris." }, { say: "Meet me at five." }]);
  expect(await rewriter.rewrite(request("What is the capital of France?"))).toMatchObject({ kind: "failed", why: "refused", detail: "overlap" });
  expect(await rewriter.rewrite(request("Meet me at five, no, I mean six."))).toMatchObject({ kind: "failed", why: "refused", detail: "earlier" });
});

test("the vocabulary goes before the transcript, cut to fifty; the tone and the caret's text are not sent to this model", async () => {
  const { rewriter, scripted } = rig([{ say: "Ask Claude Code." }]);
  const vocabulary = ["Claude Code", ...Array.from({ length: 80 }, (_, nth) => `Term${nth}`)];
  await rewriter.rewrite(request("Ask cloud code.", { vocabulary, tone: "Casual.", before: "Something typed before." }));
  const last = scripted.asked.at(-1)?.messages.at(-1)?.content ?? "";
  expect(last.startsWith("Vocabulary: Claude Code, Term0, ")).toBe(true);
  expect(last).toContain("Term48");
  expect(last).not.toContain("Term49");
  expect(last).not.toContain("Casual.");
  expect(last).not.toContain("Something typed before.");
  expect(last.endsWith("\n<transcript>\nAsk cloud code.\n</transcript>")).toBe(true);
});

test("the prompt has a place for the tone and for the text before the caret, cut to 200 characters, for a model that takes them", () => {
  const last = rewriteMessages({ transcript: "Hello.", vocabulary: [], tone: "Casual.", before: `${"x".repeat(300)} the end` }).at(-1)?.content ?? "";
  expect(last).toContain("Tone: Casual.\n");
  expect(last).toMatch(/before this \(do not repeat it\): x{192} the end\n<transcript>/);
});

test("no whole answer by the deadline: 'deadline', never a rejection", async () => {
  const { rewriter, scripted, hand } = rig([{ stall: ["Meet me"] }]);
  rewriter.warm();
  await until(() => rewriter.state() === "ready");
  const pending = rewriter.rewrite(request("Meet me at five, no, I mean six.", { deadlineMs: 900 }));
  await until(() => scripted.asked.length === 2);
  hand.advance(899);
  hand.advance(1);
  expect(await pending).toMatchObject({ kind: "failed", why: "deadline", timings: { totalMs: 900 } });
});

test("aborting the call ends it at once with 'gone', and the server is not taken for dead", async () => {
  const { rewriter, scripted } = rig([{ stall: ["Meet"] }, { say: "Fine." }]);
  const abort = new AbortController();
  const pending = rewriter.rewrite(request("Meet me at five, no, I mean six.", { signal: abort.signal }));
  await until(() => scripted.asked.length === 2);
  abort.abort();
  expect(await pending).toMatchObject({ kind: "failed", why: "gone", detail: "aborted" });
  expect(rewriter.state()).toBe("ready");
});

test("a server still loading the model answers 'starting'", async () => {
  const { rewriter } = rig([{ status: 503 }]);
  expect(await rewriter.rewrite(request("Meet me at five, no, I mean six."))).toMatchObject({ kind: "failed", why: "starting" });
});

test("off, no model, too slow: said at once and the server is never asked", async () => {
  for (const [options, why] of [
    [{ usable: () => "off" as const }, "off"],
    [{ usable: () => "no-model" as const }, "no-model"],
    [{ speed: memory({ model: MODEL.file, ms: 4000 }) }, "too-slow"],
    [{ service: null }, "no-model"],
  ] as const) {
    const { rewriter, scripted, calls } = rig([], options);
    rewriter.warm();
    expect(await rewriter.rewrite(request("Meet me at five, no, I mean six."))).toMatchObject({ kind: "failed", why });
    expect(rewriter.state()).toBe(why);
    expect([scripted.asked.length, scripted.health, calls.start]).toEqual([0, 0, 0]);
    scripted.close();
  }
});

test("a language the model is off for, an empty transcript, a transcript too long", async () => {
  const { rewriter, scripted } = rig([], { offFor: ["es"] });
  expect(await rewriter.rewrite(request("Nos vemos a las cinco, no, a las seis.", { languages: ["es-CO", "en"] }))).toMatchObject({
    kind: "failed",
    why: "off",
  });
  expect((await rewriter.rewrite(request("  "))).kind).toBe("unchanged");
  expect(await rewriter.rewrite(request("word ".repeat(WORDS_MOST + 1)))).toMatchObject({ kind: "failed", why: "refused", detail: "too long" });
  expect(scripted.asked.length).toBe(0);
});

test("the key going down starts the server once, primes it, and times it the first time only", async () => {
  const speed = memory(null);
  const { rewriter, scripted, calls, hand } = rig([{ say: "x" }, { say: "a" }, { say: "x" }, { say: "b" }, { say: "x" }, { say: "c" }], { speed });
  scripted.up = false;
  expect(rewriter.state()).toBe("asleep");
  rewriter.warm();
  rewriter.warm();
  expect(rewriter.state()).toBe("starting");
  await until(() => calls.start === 1 && scripted.health >= 2);
  scripted.up = true;
  // The loop that waits for the model looks again every 100 ms.
  await until(() => {
    hand.advance(100);
    return rewriter.state() === "ready";
  });
  expect(calls.start).toBe(1);
  // One priming request, then the test sentence three times, another sentence before each.
  expect(scripted.asked.length).toBe(7);
  expect(scripted.asked[0]?.maxTokens).toBe(4);
  expect(speed.written.map((written) => written.model)).toEqual([MODEL.file]);
});

test("a server that is up already is used as it is; a rewrite that arrives while it rises waits, within its deadline", async () => {
  const { rewriter, scripted, calls } = rig([{ say: "Meet me at six." }]);
  expect(rewriter.state()).toBe("asleep");
  const reply = await rewriter.rewrite(request("Meet me at five, no, I mean six."));
  expect(reply.kind).toBe("text");
  expect(calls.start).toBe(0);
  expect(scripted.asked.length).toBe(2);
});

test("a server that does not come up: 'starting' at the deadline, and asleep again after", async () => {
  const { rewriter, scripted, hand, calls } = rig([]);
  scripted.up = false;
  const pending = rewriter.rewrite(request("Meet me at five, no, I mean six.", { deadlineMs: 500 }));
  await until(() => calls.start === 1);
  hand.advance(500);
  expect(await pending).toMatchObject({ kind: "failed", why: "starting" });
  expect(scripted.asked.length).toBe(0);
});

test("ten idle minutes stop the server; the next key press starts it again", async () => {
  const { rewriter, hand, calls } = rig([{ say: "Meet me at six." }, { say: "Okay." }]);
  await rewriter.rewrite(request("Meet me at five, no, I mean six."));
  hand.advance(9 * 60_000);
  expect(calls.stop).toBe(0);
  hand.advance(60_000);
  await until(() => calls.stop === 1);
  expect(rewriter.state()).toBe("asleep");
  rewriter.warm();
  await until(() => rewriter.state() === "ready");
});

test("stop() stops the server and leaves no timer", async () => {
  const { rewriter, hand, calls } = rig([{ say: "Meet me at six." }]);
  await rewriter.rewrite(request("Meet me at five, no, I mean six."));
  await rewriter.stop();
  expect(calls.stop).toBe(1);
  expect(hand.pending()).toBe(0);
  expect(rewriter.state()).toBe("asleep");
});
