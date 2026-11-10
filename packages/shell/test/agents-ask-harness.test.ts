import { describe, expect, test } from "bun:test";
import { ANSWERER_CHOICES } from "../src/agents/ask/answerer.ts";
import { answererRows } from "../src/agents/ask/choices.ts";
import { signInCommand } from "../src/agents/ask/harness/catalog.ts";
import { type Files, findHarness, HARNESSES, harnessStatuses, installReads, signedIn } from "../src/agents/ask/harness/index.ts";
import { agentHandlers } from "../src/launcher/agents/handlers.ts";
import { failureLine } from "../src/launcher/agents/plan-view.tsx";
import { taskSubmit } from "../src/launcher/agents/task-mode.tsx";

describe("finding harnesses", () => {
  const home = "/home/alexk";
  const files = (executables: string[], links: Record<string, string> = {}, heads: Record<string, string> = {}, existing: string[] = []): Files => ({
    isExecutable: (path) => executables.includes(path),
    real: (path) => links[path] ?? (executables.includes(path) ? path : null),
    exists: (path) => existing.includes(path),
    head: (path) => heads[path] ?? null,
  });

  test("on PATH first, then where installers put it; links are followed to the program", () => {
    const fs = files(["/home/alexk/.local/bin/claude"], { "/home/alexk/.local/bin/claude": "/home/alexk/.local/share/claude/versions/2.1.317" });
    const found = findHarness(HARNESSES["claude-code"], home, "/usr/bin:/bin", fs);
    expect(found).toEqual({
      path: "/home/alexk/.local/bin/claude",
      program: "/home/alexk/.local/share/claude/versions/2.1.317",
      readOnly: ["/home/alexk/.local/share/claude/versions/2.1.317"],
    });
    expect(findHarness(HARNESSES.codex, home, "/usr/bin", fs)).toBeNull();
    // Installed for everyone: nothing of the home folder to bind.
    expect(findHarness(HARNESSES.codex, home, "/usr/local/bin:/usr/bin", files(["/usr/local/bin/codex"]))?.readOnly).toEqual([]);
  });

  test("a Node script brings its package, and an interpreter under the home folder its install", () => {
    const script = "/home/alexk/.npm-global/lib/node_modules/@openai/codex/bin/codex.js";
    const fs = files(
      ["/home/alexk/.npm-global/bin/codex", "/home/alexk/.nvm/versions/node/v24.1.0/bin/node"],
      { "/home/alexk/.npm-global/bin/codex": script },
      { [script]: "#!/usr/bin/env node\n" },
      ["/home/alexk/.npm-global/lib/node_modules/@openai/codex/package.json"],
    );
    expect(installReads(script, home, "/home/alexk/.nvm/versions/node/v24.1.0/bin:/usr/bin", fs)).toEqual([
      "/home/alexk/.npm-global/lib/node_modules/@openai/codex",
      "/home/alexk/.nvm/versions/node/v24.1.0",
    ]);
  });

  test("signed in: Claude Code's status, Codex's exit code, OpenCode's login file; never a model call", async () => {
    const found = { path: "/usr/bin/x", program: "/usr/bin/x", readOnly: [] };
    const asked: string[][] = [];
    const probe = (stdout: string, code: number | null) => async (argv: readonly string[]) => {
      asked.push([...argv]);
      return { stdout, code };
    };
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe('{"loggedIn": true, "authMethod": "claude.ai"}', 0))).toBe(true);
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe('{"loggedIn": false}', 1))).toBe(false);
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe("garbage", 0))).toBeNull();
    expect(asked[0]).toEqual(["/usr/bin/x", "auth", "status", "--json"]);
    expect(await signedIn(HARNESSES.codex, found, home, {}, probe("Logged in using ChatGPT", 0))).toBe(true);
    expect(await signedIn(HARNESSES.codex, found, home, {}, probe("Not logged in", 1))).toBe(false);
    expect(asked.at(-1)).toEqual(["/usr/bin/x", "login", "status"]);
    const read = (text: string | null) => (path: string) => (path === "/home/alexk/.local/share/opencode/auth.json" ? text : null);
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read('{"anthropic":{"type":"oauth"}}'))).toBe(true);
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read("{}"))).toBeNull();
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read(null))).toBeNull();
  });

  test("statuses come in the catalog's order, a missing one not installed", async () => {
    const fs = files(["/usr/bin/claude"]);
    const statuses = await harnessStatuses([HARNESSES["claude-code"], HARNESSES.codex, HARNESSES.opencode], { HOME: home, PATH: "/usr/bin" }, fs, async () => ({
      stdout: '{"loggedIn":true}',
      code: 0,
    }));
    expect(statuses).toEqual([
      { id: "claude-code", installed: true, signedIn: true },
      { id: "codex", installed: false, signedIn: null },
      { id: "opencode", installed: false, signedIn: null },
    ]);
  });
});

describe("the rows and their order", () => {
  test("harnesses first, then a local model, the APIs, then none", () => {
    expect(ANSWERER_CHOICES).toEqual(["claude-code", "codex", "opencode", "local", "claude", "gpt", "none"]);
    const rows = answererRows([
      { id: "claude-code", installed: true, signedIn: true },
      { id: "codex", installed: true, signedIn: false },
      { id: "opencode", installed: false, signedIn: null },
    ]);
    expect(rows.map((row) => row.value)).toEqual(["claude-code", "codex", "local", "claude", "gpt", "opencode", "none"]);
    expect(rows[0]?.detail).toBe("Your Claude subscription. Signed in.");
    expect(rows[1]?.detail).toBe("Your ChatGPT plan. Not signed in: run codex login in Terminal.");
    expect(rows.find((row) => row.value === "opencode")).toMatchObject({
      available: false,
      detail: "Not installed. Install it with curl -fsSL https://opencode.ai/install | bash",
    });
    // Chosen before it went: it stays where it was, and can't be picked again.
    expect(answererRows([{ id: "opencode", installed: false, signedIn: null }], "opencode")[2]).toMatchObject({ value: "opencode", available: true });
    expect(answererRows(null)[0]?.detail).toBe("Your Claude subscription. Looking…");
  });

  test("a harness that isn't signed in: Return opens Terminal, with the command to type", () => {
    expect(signInCommand("claude-code")).toBe("claude auth login");
    expect(signInCommand("gpt")).toBeNull();
    expect(failureLine({ kind: "not-signed-in", text: "Claude Code isn't signed in." }, "claude auth login")).toBe(
      "Claude Code isn't signed in. Return opens Terminal to sign in with claude auth login.",
    );
    expect(failureLine({ kind: "not-installed", text: "Codex isn't installed." })).toBe("Codex isn't installed. Return opens Settings.");
    const task = {
      id: "t",
      answerer: { id: "claude-code" as const, name: "Claude Code", where: "" },
      request: "x",
      phase: "failed" as const,
      steps: [],
      said: "",
      failure: { kind: "not-signed-in" as const, text: "" },
    };
    expect(taskSubmit(task, "", null)).toEqual({ kind: "sign-in" });
  });

  test("Esc while a plan is still being asked for stops it; on a plan it only goes back", () => {
    const stopped: string[] = [];
    const handlers = (phase: "asking" | "planned") =>
      agentHandlers({
        agents: { stop: (item: { kind: string; id?: string }) => stopped.push(`${item.kind}:${item.id ?? ""}`) } as never,
        snapshot: null,
        mode: "task",
        task: { id: "t1", answerer: { id: "claude-code", name: "Claude Code", where: "" }, request: "x", phase, steps: [], said: "", failure: null },
        text: "",
        draft: "",
        selectedRow: undefined,
        openTask: () => {},
        clearDraft: () => {},
        editWords: () => {},
        back: () => {},
        close: () => {},
        say: () => {},
        sayDone: () => {},
        offerSetUp: () => {},
      });
    handlers("planned").leave();
    expect(stopped).toEqual([]);
    handlers("asking").leave();
    expect(stopped).toEqual(["task:t1"]);
  });
});
