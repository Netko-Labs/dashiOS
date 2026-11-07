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
 * signs in from the user name field's number (Dashi asks the person which
 * login), enters the two-factor code (Dashi asks again) and verifies; it says
 * it signed in only when the page says so. A resumed turn (`resume <id>`)
 * says what it heard and reads the page four times, 3 s apart (time to stop
 * it). "@slow" in the words waits twice as long between steps.
 */

const argv = process.argv.slice(2);
// `codex login status` (how Dashi tells it's signed in, without a model call) and `--version`: a stand-in has no login to lack.
if (argv[0] === "login" && argv[1] === "status") {
  console.log("Logged in (a stand-in: there is no account)");
  process.exit(0);
}
if (argv[0] === "--version") {
  console.log("codex-cli 0.0.0 (stand-in)");
  process.exit(0);
}
const overrides = argv.flatMap((arg, at) => (arg === "-c" ? [argv[at + 1] ?? ""] : []));
const value = (key: string) => overrides.find((each) => each.startsWith(`mcp_servers.dashi.${key}=`))?.slice(`mcp_servers.dashi.${key}=`.length) ?? "";
const resumed = argv.includes("resume") ? (argv[argv.indexOf("resume") + 1] ?? null) : null;
const asked = await new Response(Bun.stdin.stream()).text();
const words = asked.split("\n\n").at(-1)?.trim() ?? "";
const slow = asked.includes("@slow");
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
  // A follow-up: it says what it heard, then reads the page a few times, slowly enough to be stopped.
  say(`Steps: 4. You said: “${words.slice(0, 80)}”`);
  for (let read = 0; read < 4; read++) {
    await pause(3000);
    await call("read_page", {});
  }
  say(`Noted: ${words.slice(0, 60)}\nI read the test site again.`);
} else {
  say("Steps: 6");
  await pause(1500);
  await call("open_url", { url: site });
  await pause(1500);
  const form = (await call("read_page", {})) ?? "";
  await pause(1500);
  // Dashi types the account, Tab, the password and Return from the user name field.
  const user = /\[(\d+)\] textbox "User name"/.exec(form)?.[1];
  if (user) await call("sign_in", { ref: Number(user), site: "signin.localhost", submit: true });
  await pause(1500);
  const second = (await call("read_page", {})) ?? "";
  const code = /\[(\d+)\] one-time code field/.exec(second)?.[1];
  const verify = /\[(\d+)\] button "Verify"/.exec(second)?.[1];
  if (code && verify) {
    await call("fill_code", { ref: Number(code), site: "signin.localhost" });
    await pause(1000);
    await call("click_element", { ref: Number(verify) });
  }
  await pause(1000);
  const last = (await call("read_page", {})) ?? "";
  // Only what the page says counts.
  const who = /signed in as (\w+)/i.exec(last)?.[1];
  say(
    who
      ? `Signed you in to the test site as ${who}\nsignin.localhost · with your saved login and its code`
      : "Couldn't sign in to the test site\nThe page didn't say you were signed in",
  );
}
out({ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } });
server.kill();
process.exit(0);

export {};
