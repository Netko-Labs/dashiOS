/**
 * Dashi's assistant with the tools it asked for (decisions.md D200, D203,
 * D207): a scripted model that waits for a slow page with wait_for instead of
 * reading it again and again, and says how it is going with tell_person
 * without ending the turn. The model is told of both, and of read_page's modes.
 */

import { expect, test } from "bun:test";
import { ASSISTANT_PROMPT } from "../src/agents/assistant/prompt.ts";
import { INSTRUCTIONS } from "../src/agents/tools/index.ts";
import { fakeAssistant } from "./support/assistant.ts";

test("a slow page: one wait, a progress line said while working, then the answer", async () => {
  const fake = fakeAssistant([
    { say: "Opening the shop.", calls: [{ name: "open_url", arguments: { url: "http://localhost:8765/slow.html" } }] },
    { calls: [{ name: "tell_person", arguments: { text: "Still looking: the page is loading." } }] },
    { calls: [{ name: "wait_for", arguments: { text: "Results ready", timeout: 20 } }] },
    { calls: [{ name: "read_page", arguments: { mode: "items" } }] },
    { say: "The results are ready." },
  ]);
  const answer = await fake.ask("Find me a bike on the slow shop.");
  // One wait, no read loop: the model read each result before the next call.
  expect(fake.ran).toEqual(["open_url", "tell_person", "wait_for", "read_page"]);
  expect(fake.sent).toHaveLength(5);
  // The progress line is the capsule's line while it works; the turn went on after it.
  expect(fake.steps).toEqual(["Opening localhost", "Still looking: the page is loading.", "Waiting", "Reading the page"]);
  expect(fake.said.join("").replace(/\s+/g, " ").trim()).toBe("Opening the shop. The results are ready.");
  expect(answer).toEqual({ say: "" });
});

test("the assistant's prompt and every agent's instructions name wait_for, read_page's modes and tell_person", () => {
  for (const words of [ASSISTANT_PROMPT, INSTRUCTIONS]) {
    expect(words).toContain("wait_for");
    expect(words).toMatch(/"main"/);
    expect(words).toMatch(/"items"/);
    expect(words).toContain("tell_person");
    expect(words).toContain("notify_person");
  }
});
