#!/usr/bin/env bun
/**
 * dashi-agent: run an agent in Dashi's agent sandbox (src/agents/sandbox.ts),
 * so it can use the person's secrets through Dashi but never read them:
 *
 *   dashi-agent claude                 (then: claude mcp add dashi -- dashi-mcp)
 *   dashi-agent --name work -- codex
 *   dashi-agent --print claude         (show the commands, run nothing)
 *
 * It re-runs itself inside a new systemd scope (dashi-agent-<name>-<n>.scope),
 * starts the bus filter there, outside bubblewrap where the agent can't reach
 * it, then the agent inside bubblewrap, and cleans up when the agent ends.
 */

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { type Exists, proxyArgs, type SandboxEnv, sandboxArgs, unitName } from "../src/agents/sandbox.ts";

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
  let filter: ReturnType<typeof Bun.spawn> | null = null;
  let bus: string | null = null;
  const address = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${join(env.runtime, "bus")}`;
  if (proxy) {
    bus = join(work, "bus");
    filter = Bun.spawn(proxyArgs(proxy, address, bus), { stdio: ["ignore", "ignore", "inherit"] });
    for (let i = 0; i < 50 && !existsSync(bus); i++) await sleep(20);
    if (!existsSync(bus)) bus = null;
  }
  const agent = Bun.spawn(sandboxArgs(command, { env, exists, bwrap, unit, bus }), { stdio: ["inherit", "inherit", "inherit"] });
  const code = await agent.exited;
  filter?.kill();
  rmSync(work, { recursive: true, force: true });
  return code;
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
  if (print) {
    const env = environment();
    console.log(`systemd-run --user --scope --unit=${unit}`);
    console.log(sandboxArgs(argv, { env, exists, bwrap: "bwrap", unit, bus: join(env.runtime, "dashi-agent", unit, "bus") }).join(" \\\n  "));
    return 0;
  }
  const scope = Bun.spawn(
    ["systemd-run", "--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, "--", process.execPath, import.meta.path, "--in-scope", unit, "--", ...argv],
    { stdio: ["inherit", "inherit", "inherit"] },
  );
  return scope.exited;
}

process.exit(await main(process.argv.slice(2)));
