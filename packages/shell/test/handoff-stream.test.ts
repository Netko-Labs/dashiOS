import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eventsOf, stepsPlanned, streamEvents, toolName } from "../src/agents/handoff/lib/stream.ts";
import { cut, hostOf, stepWords } from "../src/agents/handoff/words.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/handoff", name), "utf8");

describe("Claude Code's stream-json (recorded from 2.1.319)", () => {
  const events = streamEvents("claude-code", fixture("claude-code.jsonl"));

  test("its session, each call and how it went, what it said, and its end", () => {
    expect(events.map((event) => event.kind)).toEqual(["session", "said", "call", "result", "call", "result", "said", "session", "done"]);
    expect(events[0]).toEqual({ kind: "session", id: "5861c09c-c73a-4942-a744-8577b7750b31" });
    expect(events[2]).toEqual({ kind: "call", id: "toolu_01KmhNMsTtFfu6JLaMKGLdVz", tool: "open_url", input: { url: "https://example.com" } });
    expect(events[3]).toEqual({ kind: "result", id: "toolu_01KmhNMsTtFfu6JLaMKGLdVz", ok: true, text: "Opened example.com (Example Domain)" });
    expect(events.at(-1)).toEqual({ kind: "done", text: "The heading on example.com is **Example Domain**." });
  });

  test("its plan's size, as Dashi asks for it", () => {
    const said = events.find((event) => event.kind === "said");
    expect(said?.kind === "said" ? stepsPlanned(said.text) : null).toBe(2);
  });

  test("an error result is a failure, with its words", () => {
    expect(eventsOf("claude-code", '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}')).toEqual([
      { kind: "failed", error: "Not logged in · Please run /login" },
    ]);
    expect(eventsOf("claude-code", '{"type":"result","subtype":"error_max_turns","is_error":false}')).toEqual([{ kind: "failed", error: "error_max_turns" }]);
  });

  test("a tool result marked as an error", () => {
    expect(
      eventsOf("claude-code", '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"refused"}]}}'),
    ).toEqual([{ kind: "result", id: "t1", ok: false, text: "refused" }]);
  });

  test("banners, blank and broken lines are nothing", () => {
    expect(eventsOf("claude-code", "")).toEqual([]);
    expect(eventsOf("claude-code", "Warning: something")).toEqual([]);
    expect(eventsOf("claude-code", '{"type":"assistant","message":')).toEqual([]);
    expect(eventsOf("claude-code", '{"type":"rate_limit_event","rate_limit_info":{}}')).toEqual([]);
  });
});

describe("Codex's exec --json (from its docs)", () => {
  const events = streamEvents("codex", fixture("codex.jsonl"));

  test("the thread, its MCP calls, a failed one, its words and the turn's end", () => {
    expect(events.map((event) => event.kind)).toEqual(["session", "said", "call", "result", "call", "result", "said", "done"]);
    expect(events[2]).toEqual({ kind: "call", id: "item_2", tool: "open_url", input: { url: "https://bodytech.com.co" } });
    expect(events[5]).toEqual({ kind: "result", id: "item_3", ok: false, text: "The person didn't allow it." });
    expect(events.at(-1)).toEqual({ kind: "done", text: "" });
  });

  test("signed out (recorded from codex-cli 0.167.0): its retries aren't the end, its last error is", () => {
    const signedOut = streamEvents("codex", fixture("codex-signed-out.jsonl"));
    expect(signedOut.map((event) => event.kind)).toEqual(["session", "failed", "failed"]);
    expect(signedOut[1]).toMatchObject({ kind: "failed", error: expect.stringContaining("401 Unauthorized") });
    expect(eventsOf("codex", '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401)"}')).toEqual([]);
  });

  test("a failed turn", () => {
    expect(eventsOf("codex", '{"type":"turn.failed","error":{"message":"401 Unauthorized"}}')).toEqual([{ kind: "failed", error: "401 Unauthorized" }]);
  });

  test("a command it ran is a step of its own", () => {
    expect(eventsOf("codex", '{"type":"item.started","item":{"id":"i9","type":"command_execution","command":"ls"}}')).toEqual([
      { kind: "call", id: "i9", tool: "shell", input: { command: "ls" } },
    ]);
  });
});

describe("OpenCode's run --format json (from its docs)", () => {
  const events = streamEvents("opencode", fixture("opencode.jsonl"));

  test("each tool part is a call and its outcome; the session on every event", () => {
    const kinds = events.filter((event) => event.kind !== "session").map((event) => event.kind);
    expect(kinds).toEqual(["said", "call", "result", "call", "result", "said"]);
    expect(events.find((event) => event.kind === "call")).toEqual({ kind: "call", id: "call_a1", tool: "open_url", input: { url: "https://example.com" } });
    expect(events.filter((event) => event.kind === "result").map((event) => event.kind === "result" && event.ok)).toEqual([true, false]);
    expect(new Set(events.filter((event) => event.kind === "session").map((event) => event.kind === "session" && event.id))).toEqual(
      new Set(["ses_6a1f2c3d4e5fWXyz"]),
    );
  });

  test("an error event", () => {
    expect(eventsOf("opencode", '{"type":"error","error":{"name":"ProviderAuthError","data":{"message":"No API key"}}}')).toEqual([
      { kind: "failed", error: "No API key" },
    ]);
  });
});

describe("steps in Dashi's words", () => {
  test("Dashi's tools take their prefix off", () => {
    expect(toolName("mcp__dashi__sign_in")).toBe("sign_in");
    expect(toolName("dashi_pay")).toBe("pay");
    expect(toolName("Bash")).toBe("Bash");
  });

  test("while it runs, and once it has", () => {
    expect(stepWords("open_url", { url: "https://www.bodytech.com.co/clases" }, false)).toBe("Opening bodytech.com.co");
    expect(stepWords("open_url", { url: "https://www.bodytech.com.co/clases" }, true)).toBe("Opened bodytech.com.co");
    expect(stepWords("sign_in", { site: "bodytech.com.co" }, false)).toBe("Signing in to bodytech.com.co");
    expect(stepWords("pay", { site: "signin.localhost", amount: "4.20" }, false)).toBe("Paying signin.localhost $4.20");
    expect(stepWords("hand_over", { reason: "Solve the CAPTCHA" }, false)).toBe("Waiting for you: Solve the CAPTCHA");
  });

  test("other tools by their catalog title, else their name", () => {
    expect(stepWords("set_setting", {}, false, "Change a setting")).toBe("Changing a setting");
    expect(stepWords("set_setting", {}, true, "Change a setting")).toBe("Change a setting");
    expect(stepWords("weird_tool", {}, false)).toBe("Using weird tool");
  });

  test("hosts and cut words", () => {
    expect(hostOf("bodytech.com.co")).toBe("bodytech.com.co");
    expect(hostOf("not a url at all")).toBeNull();
    expect(cut("Book a spinning class at Bodytech on Thursday morning", 30)).toBe("Book a spinning class at…");
  });
});
