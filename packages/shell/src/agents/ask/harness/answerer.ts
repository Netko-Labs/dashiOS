/**
 * A harness (Claude Code, Codex, OpenCode) as the launcher's answerer,
 * through plan mode (docs/actions.md, "Plan mode"). Each turn:
 *
 * 1. The plan socket for the turn is served (plan-server.ts): its tools are
 *    the plan's, and a call is recorded, never run.
 * 2. The harness runs headless in Dashi's agent sandbox (dashi-agent with a
 *    plan profile: a private home folder with only its login and install,
 *    run.ts), its own tools off and only `dashi` for MCP (catalog.ts). It
 *    answers with its own login, so a subscription works.
 * 3. When it ends, the calls it made are the plan; its session is kept, and
 *    a follow-up resumes it.
 *
 * A turn that takes too long is stopped; so is one the person stops (Esc,
 * Stop), along with everything it started.
 */

import { join } from "node:path";
import { isRecord } from "@dashi/shape";
import { ANSWERERS, AnswerError, type Answerer, type PlanTool, promptStyle, SYSTEM_PROMPT, styledPrompt, type Turn } from "../answerer.ts";
import { oneLine } from "../plan.ts";
import type { HarnessSpec } from "./catalog.ts";
import type { FoundHarness } from "./detect.ts";
import { PlanRecorder, type PlanServer, servePlan } from "./lib/plan-server.ts";
import { bridgeInside, harnessEnv, type Runner, type ShellPaths } from "./run.ts";

/** What a harness is told, in plan mode: the answerers' words, and that its calls are only recorded. */
export const HARNESS_PROMPT = [
  SYSTEM_PROMPT,
  "Your only tools are Dashi's, in plan mode: each call adds a step to the plan and runs nothing.",
  "When the plan is complete, end your turn without describing it.",
].join(" ");

/** The harness's prompt now: its own words whole, then how the person made Dashi sound, then the closing line (answerer.ts `styledPrompt`). */
export const harnessPrompt = (): string => styledPrompt(HARNESS_PROMPT, promptStyle.get().full);

/** How long a turn may take, start-up and all. */
export const TURN_TIMEOUT_MS = 120_000;

/** The prompt for a turn: the words, after how the last plan went on a follow-up. */
export function turnPrompt(turn: Turn): string {
  if (turn.results.length === 0) return turn.text;
  const went = turn.results.map((result, index) => `- Step ${index + 1}: ${result.error ? "not done" : "done"}. ${oneLine(result.text, 200)}`);
  return ["How the last plan went:", ...went, "", "Now the person asks:", turn.text].join("\n");
}

/** What the answerer keeps between turns: the harness's session. */
interface Kept {
  session: string | null;
}
const keptOf = (history: readonly unknown[]): Kept => {
  const last = history.at(-1);
  return { session: isRecord(last) && typeof last.session === "string" ? last.session : null };
};

export interface HarnessOptions {
  spec: HarnessSpec;
  /** Where it is installed now; null when it isn't. */
  find(): FoundHarness | null;
  run: Runner;
  shell: ShellPaths;
  /** The session's environment (HOME, XDG_RUNTIME_DIR, PATH…). */
  env: Readonly<Record<string, string | undefined>>;
  /** Whether a connection to the plan socket comes from this turn's sandbox (by the agent's pid and dashi-agent's). */
  fromTurn(peer: number | null, agent: number | null): boolean;
  serve?: typeof servePlan;
  timeoutMs?: number;
  /** For tests: run the harness itself, without dashi-agent. */
  direct?: boolean;
}

let turns = 0;

export function harnessAnswerer(options: HarnessOptions): Answerer {
  const { spec } = options;
  const info = ANSWERERS[spec.id];
  return {
    info,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const home = options.env.HOME;
      const runtime = options.env.XDG_RUNTIME_DIR;
      if (!home || !runtime) throw new AnswerError("failed", `${info.name} can't start without a session.`);
      const found = options.find();
      if (!found) throw new AnswerError("not-installed", `${info.name} isn't installed.`);
      const kept = keptOf(history);
      const id = `${spec.id}-${process.pid}-${++turns}`;
      const recorder = new PlanRecorder(tools, `plan-${id}`);
      let agent: number | null = null;
      const server: PlanServer = (options.serve ?? servePlan)(join(runtime, "dashi-plan", `${id}.sock`), recorder, (peer) => options.fromTurn(peer, agent));
      try {
        const bridge = options.direct
          ? { command: options.shell.bun, args: [options.shell.bridge], env: { DASHI_MCP_SOCKET: server.path } }
          : bridgeInside(options.shell, runtime);
        const command = spec.command({ prompt: turnPrompt(turn), system: harnessPrompt(), session: kept.session, mcp: bridge });
        const profile = {
          socket: server.path,
          readOnly: [...found.readOnly, ...[options.shell.bun, options.shell.bridge].filter((path) => path.startsWith(`${home}/`))],
          state: spec.state(home, options.env),
          cwd: join(runtime, "dashi-launcher"),
        };
        const argv = options.direct
          ? [found.program, ...command.args]
          : [options.shell.bun, options.shell.dashiAgent, "--name", `plan-${spec.id}`, "--", found.program, ...command.args];
        const env = harnessEnv(spec, options.env, { ...command.env, ...(options.direct ? {} : { DASHI_AGENT_PLAN: JSON.stringify(profile) }) });
        const running = options.run(argv, { env, stdin: command.stdin });
        agent = running.pid;
        const stop = () => running.stop();
        signal.addEventListener("abort", stop, { once: true });
        let late = false;
        const timeout = setTimeout(() => {
          late = true;
          stop();
        }, options.timeoutMs ?? TURN_TIMEOUT_MS);
        let code: number | null;
        let stdout: string;
        try {
          [code, stdout] = await Promise.all([running.exited, running.stdout]);
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", stop);
        }
        if (signal.aborted) throw new DOMException("Stopped.", "AbortError");
        const output = spec.read(stdout, code);
        const calls = [...recorder.calls];
        // A plan cut off mid-way is not a plan.
        if (late) throw new AnswerError("no-answer", `${info.name} took too long.`);
        if (output.error && calls.length === 0) {
          if (spec.signedOut(output.error)) throw new AnswerError("not-signed-in", `${info.name} isn't signed in.`);
          throw new AnswerError("failed", oneLine(`${info.name}: ${output.error}`, 120));
        }
        return { reply: { text: output.text, calls }, history: [{ session: output.session ?? kept.session } satisfies Kept] };
      } finally {
        server.close();
      }
    },
  };
}
