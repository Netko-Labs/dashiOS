#!/usr/bin/env bun
/**
 * dashi-agent: run an agent in Dashi's agent sandbox (src/agents/sandbox.ts),
 * so it can use the person's secrets through Dashi but never read them:
 *
 *   dashi-agent claude                 (then: claude mcp add dashi -- dashi-mcp)
 *   dashi-agent --name work -- codex
 *   dashi-agent --print claude         (show the commands, run nothing)
 *
 * It asks the shell for the sandbox's token proxy (src/agents/tokens/), then
 * re-runs itself inside a new systemd scope (dashi-agent-<name>-<n>.scope),
 * starts the bus filter and the proxy's relay there, outside bubblewrap where
 * the agent can't reach them, then the agent inside bubblewrap, and cleans up
 * when the agent ends.
 *
 * With DASHI_AGENT_PLAN set (a plan profile, sandbox.ts `PlanProfile`), it
 * runs a harness answering the launcher in plan mode: a private home folder
 * with only the harness's login and install bound back, the turn's plan
 * socket, and no bus filter or token proxy (agents/ask/harness/). SIGTERM
 * stops the agent and cleans up (the launcher's Stop and Esc).
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { maybe, obj, str } from "@dashi/shape";
import { type Exists, type PlanProfile, parsePlanProfile, proxyArgs, type SandboxEnv, sandboxArgs, tokenProxyArgs, unitName } from "../src/agents/sandbox.ts";
import { relay, requestProxy } from "../src/agents/tokens/client.ts";
import { type ProxyGrant, tokensSocketPath } from "../src/agents/tokens/server.ts";

/** How the first half hands the token proxy to the half in the scope. */
const GRANT_VAR = "DASHI_TOKENS_GRANT";
/** A plan profile, from the shell's harness answerer. */
const PLAN_VAR = "DASHI_AGENT_PLAN";

/** Stop `child` when this process is asked to stop, so nothing is left running in the scope. */
function forwardStops(child: { kill(signal?: number | NodeJS.Signals): void }, cleanup: () => void = () => {}): void {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      child.kill("SIGTERM");
      cleanup();
      process.exit(143);
    });
  }
}

const exists: Exists = (path) => {
  try {
    return statSync(path).isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
};

function fail(message: string): never {
  console.error(`dashi-agent: ${message}`);
  process.exit(1);
}

function environment(): SandboxEnv {
  const home = process.env.HOME || fail("no HOME");
  const runtime = process.env.XDG_RUNTIME_DIR || fail("no XDG_RUNTIME_DIR");
  return {
    home,
    runtime,
    state: process.env.XDG_STATE_HOME || join(home, ".local/state"),
    config: process.env.XDG_CONFIG_HOME || join(home, ".config"),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Inside the scope: the bus filter, then the agent; the agent's exit code is ours. */
async function inScope(unit: string, command: string[]): Promise<number> {
  const env = environment();
  const bwrap = process.env.DASHI_AGENT_BWRAP || Bun.which("bwrap") || fail("bubblewrap (bwrap) is needed");
  const proxy = process.env.DASHI_AGENT_PROXY || Bun.which("xdg-dbus-proxy");
  const work = join(env.runtime, "dashi-agent", unit);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const plan = parsePlanProfile(process.env[PLAN_VAR]);
  if (process.env[PLAN_VAR] && !plan) fail("the plan profile doesn't parse");
  let filter: ReturnType<typeof Bun.spawn> | null = null;
  let bus: string | null = null;
  const address = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${join(env.runtime, "bus")}`;
  // A harness in plan mode gets no bus and no tokens: it answers with its own login, through the plan socket.
  if (proxy && !plan) {
    bus = join(work, "bus");
    filter = Bun.spawn(proxyArgs(proxy, address, bus), { stdio: ["ignore", "ignore", "inherit"] });
    for (let i = 0; i < 50 && !existsSync(bus); i++) await sleep(20);
    if (!existsSync(bus)) bus = null;
  }
  const tokens = plan ? null : await tokenRelay(env);
  const extra = ["--unsetenv", GRANT_VAR, "--unsetenv", PLAN_VAR, ...(tokens?.args ?? [])];
  const agent = Bun.spawn(sandboxArgs(command, { env, exists, bwrap, unit, bus, extra, ...(plan ? { plan } : {}) }), {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const cleanup = () => {
    tokens?.close();
    filter?.kill();
    rmSync(work, { recursive: true, force: true });
  };
  forwardStops(agent, cleanup);
  const code = await agent.exited;
  cleanup();
  return code;
}

/** For --print: a plan profile's arguments, with placeholders. */
const printedPlan = (env: SandboxEnv): PlanProfile => ({
  socket: join(env.runtime, "dashi-plan", "TURN.sock"),
  readOnly: [],
  state: [],
  cwd: join(env.runtime, "dashi-launcher"),
});

function parseGrant(text: string | undefined): ProxyGrant | null {
  if (!text) return null;
  try {
    return maybe(obj({ socket: str(), ca: str(), bundle: str(), key: str() }, { strict: false }), JSON.parse(text));
  } catch {
    return null;
  }
}

/** Inside the scope: a loopback port relayed to the token proxy, and bubblewrap's arguments for it. */
async function tokenRelay(env: SandboxEnv): Promise<{ args: string[]; close: () => void } | null> {
  const grant = parseGrant(process.env[GRANT_VAR]);
  if (!grant || !existsSync(grant.socket)) return null;
  try {
    const { port, close } = await relay(grant.socket);
    return { args: tokenProxyArgs(env, { ...grant, port }, process.env.NO_PROXY || process.env.no_proxy), close };
  } catch (error) {
    console.error(`dashi-agent: tokens won't reach this agent (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

/** Before the scope: the shell's token proxy for it, held while the agent runs; null without one. */
async function openTokens(unit: string): Promise<{ grant: ProxyGrant; close: () => void } | null> {
  const path = tokensSocketPath();
  if (!path || !existsSync(path)) {
    console.error("dashi-agent: Dashi's shell isn't running here, so tokens in your vault won't reach this agent");
    return null;
  }
  const answer = await requestProxy(path, unit);
  if ("error" in answer) {
    console.error(`dashi-agent: tokens won't reach this agent (${answer.error})`);
    return null;
  }
  return answer;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "--in-scope") {
    const [, unit, separator, ...command] = argv;
    if (!unit || separator !== "--" || command.length === 0) fail("bad --in-scope call");
    return inScope(unit, command);
  }
  let name: string | null = null;
  let print = false;
  while (argv.length > 0) {
    const [arg] = argv;
    if (arg === "--name") {
      name = argv[1] ?? fail("--name needs a value");
      argv = argv.slice(2);
    } else if (arg === "--print") {
      print = true;
      argv = argv.slice(1);
    } else if (arg === "--") {
      argv = argv.slice(1);
      break;
    } else break;
  }
  const [program] = argv;
  if (!program) fail("usage: dashi-agent [--name NAME] [--print] [--] COMMAND [ARGS...]");
  const unit = unitName(name ?? basename(program), process.pid);
  const planned = process.env[PLAN_VAR] !== undefined;
  if (print) {
    const env = environment();
    console.log(`systemd-run --user --scope --unit=${unit}`);
    const plan = planned ? (parsePlanProfile(process.env[PLAN_VAR]) ?? printedPlan(env)) : null;
    const tokens = plan ? [] : tokenProxyArgs(env, { socket: "PROXY_SOCKET", ca: "CA_PEM", bundle: "BUNDLE_PEM", key: "KEY", port: 0 });
    const bus = plan ? null : join(env.runtime, "dashi-agent", unit, "bus");
    console.log(sandboxArgs(argv, { env, exists, bwrap: "bwrap", unit, bus, extra: tokens, ...(plan ? { plan } : {}) }).join(" \\\n  "));
    return 0;
  }
  const tokens = planned ? null : await openTokens(unit);
  const scope = Bun.spawn(
    ["systemd-run", "--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, "--", process.execPath, import.meta.path, "--in-scope", unit, "--", ...argv],
    { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, ...(tokens ? { [GRANT_VAR]: JSON.stringify(tokens.grant) } : {}) } },
  );
  forwardStops(scope, () => tokens?.close());
  const code = await scope.exited;
  tokens?.close();
  return code;
}

process.exit(await main(process.argv.slice(2)));
