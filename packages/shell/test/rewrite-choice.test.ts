/**
 * What corrects dictation is the person's choice (rewrite/start.ts, rewrite/lib/hosted.ts; decisions.md D200): the
 * model on this computer they picked, the rules alone, or Claude with their key, whose request carries no sampling
 * parameters, thinking off and effort low, and goes to api.anthropic.com only.
 */

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CorrectionChoice, isCorrectionChoice, type RewriteRequest, startRewriter } from "../src/rewrite/index.ts";
import { HOSTED_MODEL, hostedBody, hostedRewriter } from "../src/rewrite/lib/hosted.ts";
import { GEMMA, SPEAKOFLOW } from "../src/rewrite/lib/model.ts";
import { modelPath } from "../src/rewrite/lib/service.ts";

const request = (transcript: string): RewriteRequest => ({ transcript, languages: ["en"], vocabulary: ["Dashi"], before: "", tone: "", deadlineMs: 2000 });

test("each choice names its model in the logs, and only a known choice is read from settings", () => {
  let chosen: CorrectionChoice = "speakoflow";
  const env = { XDG_RUNTIME_DIR: "", HOME: "/nowhere" };
  const rewriter = startRewriter({ tidy: () => true, choice: () => chosen, env });
  expect(rewriter.model()).toBe("speakoflow-mini-q4");
  chosen = "gemma";
  expect(rewriter.model()).toBe("gemma-4-e2b-q4");
  chosen = "rules";
  expect(rewriter.model()).toBe("rules");
  chosen = "key";
  expect(rewriter.model()).toBe(HOSTED_MODEL);
  expect(isCorrectionChoice("gemma")).toBe(true);
  expect(isCorrectionChoice("gpt")).toBe(false);
});

test("a model on this computer is used only when its own file is here, whole", () => {
  const home = mkdtempSync(join(tmpdir(), "dashi-choice-"));
  const env = { DASHI_VOICE_MODELS: join(home, "voice"), XDG_RUNTIME_DIR: "", HOME: home };
  expect(modelPath(env, GEMMA)).toBe(join(home, "voice", "rewrite-gemma", "gemma-4-E2B-it-Q4_K_M.gguf"));
  expect(modelPath(env, SPEAKOFLOW)).toBe(join(home, "voice", "rewrite", "SpeakoFlow-Mini-0.8B-Q4_K_M.gguf"));
  mkdirSync(join(home, "voice", "rewrite"), { recursive: true });
  writeFileSync(modelPath(env, SPEAKOFLOW), "part of it");
  let chosen: CorrectionChoice = "gemma";
  const rewriter = startRewriter({ tidy: () => true, choice: () => chosen, env });
  expect(rewriter.state()).toBe("no-model");
  chosen = "rules";
  expect(rewriter.state()).toBe("no-model");
  expect(startRewriter({ tidy: () => false, choice: () => "gemma", env }).state()).toBe("off");
});

test("Claude's request: the prompt's rules as the system part, no sampling parameters, thinking off, effort low", () => {
  const body = hostedBody(request("Meet at five, no, six."));
  expect(body.model).toBe("claude-haiku-5-5");
  expect(body).not.toHaveProperty("temperature");
  expect(body.thinking).toEqual({ type: "disabled" });
  expect(body.output_config).toEqual({ effort: "low" });
  expect(String(body.system)).toContain("You clean up dictated text.");
  const messages = body.messages as Array<{ role: string; content: string }>;
  expect(messages.every((message) => message.role !== "system")).toBe(true);
  expect(messages.at(-1)?.content).toContain("Meet at five, no, six.");
});

test("with the key: the answer is checked as the local model's is; with none, nothing is sent", async () => {
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  const answer = (text: string, stop = "end_turn"): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: stop }));
    }) as typeof fetch;
  const fixed = await hostedRewriter({ key: async () => "sk-test", fetch: answer("Meet at six.") }).rewrite(request("Meet at five, no, six."));
  expect(fixed).toMatchObject({ kind: "text", text: "Meet at six." });
  expect(sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
  expect(sent[0]?.headers["x-api-key"]).toBe("sk-test");
  // An answer that adds what was not said is refused, as the local model's is.
  const added = await hostedRewriter({ key: async () => "sk-test", fetch: answer("Sure! Here is a poem about cats and dogs and birds and more.") }).rewrite(
    request("Meet at five."),
  );
  expect(added.kind).toBe("failed");
  const refused = await hostedRewriter({ key: async () => "sk-test", fetch: answer("", "refusal") }).rewrite(request("Meet at five, no, six."));
  expect(refused).toMatchObject({ kind: "failed", why: "refused" });
  const before = sent.length;
  const none = hostedRewriter({ key: async () => null, fetch: answer("x") });
  expect(await none.rewrite(request("Meet at five, no, six."))).toMatchObject({ kind: "failed", why: "no-model" });
  expect(sent.length).toBe(before);
  expect(none.advice()).toEqual({ land: "refine", deadlineMs: 6000 });
});
