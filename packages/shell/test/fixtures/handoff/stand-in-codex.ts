#!/usr/bin/env bun
/**
 * A stand-in for Codex, for checking agents from the launcher in the VM
 * where no harness is signed in (dashi-0.5.0-review/26-launcher-agents): it
 * takes `codex exec --json …` as agents/handoff/commands.ts builds it,
 * starts Dashi's MCP server from its `-c mcp_servers.dashi.*` overrides,
 * makes real calls to it (so the steps, the questions and the sandbox are
 * Dashi's own), and prints Codex's documented JSONL events. Its "model" is
 * a script: it never calls one.
 *
 * The first turn opens the test site (test/fixtures/sign-in-site), reads it,
 * and signs in with the password field's number (Dashi asks the person which
 * login). A resumed turn (`resume <id>`) says what it heard and reads the
 * page again. "@slow" in the words waits longer between steps.
 */

const argv = process.argv.slice(2);
const overrides = argv.flatMap((arg, at) => (arg === "-c" ? [argv[at + 1] ?? ""] : []));
const value = (key: string) => overrides.find((each) => each.startsWith(`mcp_servers.dashi.${key}=`))?.slice(`mcp_servers.dashi.${key}=`.length) ?? "";
const resumed = argv.includes("resume") ? (argv[argv.indexOf("resume") + 1] ?? null) : null;
const prompt = await new Response(Bun.stdin.stream()).text();
const words = prompt.split("\n\n").at(-1)?.trim() ?? "";
const slow = prompt.includes("@slow");
const site = "http://signin.localhost:8443/";

const out = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
const pause = (ms: number) => Bun.sleep(slow ? ms * 2 : ms);

const server = Bun.spawn([JSON.parse(value("command") || '""') as string, ...(JSON.parse(value("args") || "[]") as string[])], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
const reader = server.stdout.getReader();
let buffered = "";
let nextId = 0;

async function request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = ++nextId;
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  for (;;) {
    const end = buffered.indexOf("\n");
    if (end >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      if (message.id !== id) continue;
      if (message.error) throw new Error(message.error.message);
      return message.result ?? {};
    }
    const { value: chunk, done } = await reader.read();
    if (done) throw new Error("Dashi's MCP server went away");
    buffered += new TextDecoder().decode(chunk);
  }
}

let item = 0;
/** One tool call, as Codex reports it: started, then completed or failed. */
async function call(tool: string, args: Record<string, unknown>): Promise<string | null> {
  const id = `item_${++item}`;
  out({ type: "item.started", item: { id, type: "mcp_tool_call", server: "dashi", tool, arguments: args, status: "in_progress" } });
  try {
    const result = await request("tools/call", { name: tool, arguments: args });
    const text = ((result.content as Array<{ type: string; text?: string }>) ?? []).map((part) => part.text ?? "").join("\n");
    if (result.isError) {
      out({ type: "item.completed", item: { id, type: "mcp_tool_call", server: "dashi", tool, arguments: args, error: { message: text }, status: "failed" } });
      return null;
    }
    out({
      type: "item.completed",
      item: { id, type: "mcp_tool_call", server: "dashi", tool, arguments: args, result: { content: [{ type: "text", text }] }, status: "completed" },
    });
    return text;
  } catch (error) {
    out({
      type: "item.completed",
      item: { id, type: "mcp_tool_call", server: "dashi", tool, arguments: args, error: { message: String(error) }, status: "failed" },
    });
    return null;
  }
}
const say = (text: string) => out({ type: "item.completed", item: { id: `item_${++item}`, type: "agent_message", text } });

await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-stand-in", version: "0" } });
out({ type: "thread.started", thread_id: resumed ?? `stand-in-${crypto.randomUUID()}` });
out({ type: "turn.started" });

if (resumed) {
  say(`Steps: 1. You said: “${words.slice(0, 80)}”`);
  await pause(1500);
  await call("read_page", {});
  await pause(1000);
  say(`Noted: ${words.slice(0, 60)}\nI'll keep it in mind on the test site.`);
} else {
  say("Steps: 4");
  await pause(1500);
  await call("open_url", { url: site });
  await pause(2000);
  const page = (await call("read_page", {})) ?? "";
  await pause(2000);
  const ref = /\[(\d+)\] password field/.exec(page)?.[1];
  const signedIn = ref ? await call("sign_in", { ref: Number(ref), site: "signin.localhost", submit: true }) : null;
  await pause(2000);
  await call("read_page", {});
  say(signedIn ? "Signed you in to the test site\nsignin.localhost · as the login you chose" : "Couldn't sign in to the test site\nNo login was allowed");
}
out({ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } });
server.kill();
process.exit(0);
