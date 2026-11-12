import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestProxy } from "../src/agents/tokens/client.ts";
import { parseOpen, serveTokens } from "../src/agents/tokens/server.ts";
import { source } from "./support/agent-tokens.ts";
import { until } from "./support/time.ts";

describe("the shell's socket for dashi-agent", () => {
  test("it takes one sandbox's scope name and nothing else", () => {
    expect(parseOpen('{"open":"dashi-agent-claude-7.scope"}')).toEqual({ unit: "dashi-agent-claude-7.scope" });
    expect(parseOpen('{"open":"../../etc"}')).toHaveProperty("error");
    expect(parseOpen('{"open":"dashi-agent-claude-7.scope","x":1}')).toHaveProperty("error");
    expect(parseOpen("nope")).toHaveProperty("error");
  });

  test("dashi-agent gets a proxy for its sandbox, which goes when it lets go", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-run-"));
    const path = join(runtime, "dashi-tokens.sock");
    const stop = serveTokens({ path, tokens: source, peer: () => 4242, cgroup: () => "0::/user.slice/session-2.scope\n" });
    try {
      const answer = await requestProxy(path, "dashi-agent-claude-7.scope");
      if ("error" in answer) throw new Error(answer.error);
      const { grant, close } = answer;
      expect(existsSync(grant.socket)).toBe(true);
      expect(readFileSync(grant.ca, "utf8")).toContain("BEGIN CERTIFICATE");
      expect(readFileSync(grant.bundle, "utf8").endsWith(readFileSync(grant.ca, "utf8"))).toBe(true);
      expect(grant.key.length).toBeGreaterThan(20);
      close();
      await until(() => !existsSync(grant.socket), "the grant's socket to go");
    } finally {
      stop();
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  test("a dashi-agent started inside a sandbox is turned away", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-run-"));
    const path = join(runtime, "dashi-tokens.sock");
    const stop = serveTokens({ path, tokens: source, peer: () => 4242, cgroup: () => "0::/user.slice/app.slice/dashi-agent-claude-1.scope\n" });
    try {
      expect(await requestProxy(path, "dashi-agent-claude-7.scope")).toHaveProperty("error");
    } finally {
      stop();
      rmSync(runtime, { recursive: true, force: true });
    }
  });
});
