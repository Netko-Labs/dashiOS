#!/usr/bin/env bun
/**
 * dashi-task: one turn of an agent started from the launcher, as the main
 * process of its user service (src/agents/handoff/runner.ts starts it with
 * `systemd-run --user`, as applets are):
 *
 *   dashi-task --log STREAM --prompt PROMPT -- bun dashi-agent.ts --name task-ID -- claude -p …
 *
 * It gives the command the prompt on stdin, appends what it prints to
 * STREAM (the shell reads it as it grows, and again after a restart),
 * appends its errors to STREAM.err, and ends STREAM with
 * `{"dashi":"exit","code":N}`. SIGTERM (`systemctl --user stop`, the panel's
 * Stop) reaches the command, which stops the agent and its sandbox.
 */

import { appendFileSync, readFileSync } from "node:fs";

function fail(message: string): never {
  console.error(`dashi-task: ${message}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let log: string | null = null;
let prompt: string | null = null;
while (argv.length > 0 && argv[0] !== "--") {
  const [flag, value] = argv.splice(0, 2);
  if (flag === "--log") log = value ?? null;
  else if (flag === "--prompt") prompt = value ?? null;
  else fail(`unknown argument ${flag}`);
}
argv.shift();
if (!log || !prompt || argv.length === 0) fail("usage: dashi-task --log STREAM --prompt PROMPT -- COMMAND [ARGS...]");
const stream = log;

const line = (value: unknown) => appendFileSync(stream, `${JSON.stringify(value)}\n`, { mode: 0o600 });
line({ dashi: "start", pid: process.pid });

const child = Bun.spawn(argv, {
  stdin: new TextEncoder().encode(readFileSync(prompt, "utf8")),
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => child.kill("SIGTERM"));

/** Copy a stream to a file as it comes, whole lines at a time for stdout. */
async function copy(from: ReadableStream<Uint8Array>, to: string, lines: boolean): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of from) {
    const text = pending + decoder.decode(chunk, { stream: true });
    if (!lines) {
      appendFileSync(to, text, { mode: 0o600 });
      continue;
    }
    const end = text.lastIndexOf("\n");
    pending = text.slice(end + 1);
    if (end >= 0) appendFileSync(to, text.slice(0, end + 1), { mode: 0o600 });
  }
  if (pending) appendFileSync(to, `${pending}\n`, { mode: 0o600 });
}

await Promise.all([copy(child.stdout, stream, true), copy(child.stderr, `${stream}.err`, false)]);
const code = await child.exited;
line({ dashi: "exit", code: child.signalCode ? null : code });
process.exit(0);
