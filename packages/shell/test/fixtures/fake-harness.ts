/**
 * A stand-in for Claude Code, Codex and OpenCode in tests (agents-ask-harness):
 * it reads its command line the way the real CLI's is built
 * (agents/ask/harness/catalog.ts), starts the MCP server it was given (Dashi's
 * plan mode, through the dashi-mcp bridge), makes the calls the prompt asks
 * for, and prints the CLI's output format. Which CLI it is comes from its
 * first argument: `exec` is Codex, `run` OpenCode, anything else Claude Code.
 *
 * The prompt says what to do: "@hang" never ends; "@signed-out" answers as a
 * CLI that isn't signed in; "@bad" makes a call whose arguments don't pass
 * first; otherwise it plans Dark Mode on and opening Notes. "--resume" (or
 * Codex's `resume`, OpenCode's `--session`) puts "resumed <id>" in its words.
 */

const argv = process.argv.slice(2);
const kind = argv[0] === "exec" ? "codex" : argv[0] === "run" ? "opencode" : "claude-code";
const after = (flag: string): string | null => {
  const at = argv.indexOf(flag);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
};

interface Server {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function server(): Server {
  if (kind === "claude-code") {
    const config = JSON.parse(after("--mcp-config") ?? "{}") as { mcpServers: Record<string, Server> };
    const dashi = config.mcpServers.dashi;
    if (!dashi) throw new Error("no dashi server");
    return dashi;
  }
  if (kind === "opencode") {
    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}") as {
      mcp: Record<string, { command: string[]; environment: Record<string, string> }>;
    };
    const dashi = config.mcp.dashi;
    if (!dashi) throw new Error("no dashi server");
    const [command = "", ...args] = dashi.command;
    return { command, args, env: dashi.environment };
  }
  const overrides = argv.flatMap((arg, at) => (arg === "-c" ? [argv[at + 1] ?? ""] : []));
  const value = (key: string) => overrides.find((each) => each.startsWith(`mcp_servers.dashi.${key}=`))?.slice(`mcp_servers.dashi.${key}=`.length) ?? "";
  const env = Object.fromEntries(
    [...value("env").matchAll(/([A-Z_]+)=("(?:[^"\\]|\\.)*")/g)].map((match) => [match[1] ?? "", JSON.parse(match[2] ?? '""') as string]),
  );
  return { command: JSON.parse(value("command")) as string, args: JSON.parse(value("args")) as string[], env };
}

const stdin = await new Response(Bun.stdin.stream()).text();
const prompt = kind === "opencode" ? (argv.at(-1) ?? "") : stdin;
const resumed =
  kind === "claude-code" ? after("--resume") : kind === "opencode" ? after("--session") : argv.includes("resume") ? argv[argv.indexOf("resume") + 1] : null;
const session = resumed ?? `session-${process.pid}`;

if (prompt.includes("@hang")) await new Promise(() => {});

if (prompt.includes("@signed-out")) {
  if (kind === "claude-code")
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", session_id: session }));
  if (kind === "codex") console.log(JSON.stringify({ type: "error", message: "401 Unauthorized: please log in" }));
  if (kind === "opencode")
    console.log(JSON.stringify({ type: "error", sessionID: session, error: { name: "ProviderAuthError", data: { message: "No API key for the provider" } } }));
  process.exit(1);
}

// The MCP client: one request at a time, over the server's stdio.
const { command, args, env } = server();
const child = Bun.spawn([command, ...args], { env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
const reader = child.stdout.getReader();
let buffered = "";
let id = 0;
async function request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const mine = ++id;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: mine, method, params })}\n`);
  child.stdin.flush();
  for (;;) {
    const newline = buffered.indexOf("\n");
    if (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
      if (message.id === mine) return message.result ?? {};
      continue;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("the server went away");
    buffered += new TextDecoder().decode(value);
  }
}

await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: kind, version: "0" } });
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
const listed = (await request("tools/list")) as { tools: Array<{ name: string }> };
const answers: string[] = [];
const call = async (name: string, input: Record<string, unknown>) => {
  const result = (await request("tools/call", { name, arguments: input })) as { content: Array<{ text: string }>; isError?: boolean };
  answers.push(`${result.isError ? "error" : "ok"}: ${result.content[0]?.text ?? ""}`);
};
if (prompt.includes("@bad")) await call("set_setting", { name: "dark_mode", value: "very" });
await call("set_setting", { name: "dark_mode", value: true });
await call("launch_app", { app: "Notes" });
child.stdin.end();
await child.exited;

const words = [`${listed.tools.length} tools`, ...answers, ...(resumed ? [`resumed ${resumed}`] : [])].join(" | ");
if (kind === "claude-code") console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: words, session_id: session }));
if (kind === "codex") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: session }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: words } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
}
if (kind === "opencode") {
  console.log(JSON.stringify({ type: "step_start", sessionID: session, part: { type: "step-start" } }));
  console.log(JSON.stringify({ type: "text", sessionID: session, part: { type: "text", text: words } }));
}
export {};
