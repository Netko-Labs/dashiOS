/** The answerer Settings names, made from its parts and kept while the choice stays the same. */

import { readFileSync } from "node:fs";
import { unitName } from "../sandbox.ts";
import { type Answerer, type AnswererChoice, answererOf, type HarnessId, isHarnessId } from "./answerer.ts";
import type { AskOptions, HarnessHost } from "./ask-types.ts";
import { claudeAnswerer } from "./claude.ts";
import { gptAnswerer } from "./gpt.ts";
import { findHarness, HARNESSES, harnessAnswerer, hostFiles, hostRunner, shellPaths } from "./harness/index.ts";
import { localAnswerer } from "./local.ts";

/** The scope a harness's turn runs in: dashi-agent names it after itself (sandbox.ts `unitName`). */
const planUnit = (id: HarnessId, pid: number): string => unitName(`plan-${id}`, pid);

/** Whether the process `pid` is in the scope `unit` (its cgroup, from /proc). */
function inUnit(pid: number, unit: string): boolean {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("0::"));
    return line?.slice(3).split("/").includes(unit) ?? false;
  } catch {
    return false;
  }
}

/** A harness (Claude Code, Codex, OpenCode) answering, found and run as `host` says. */
function harnessFor(id: HarnessId, host: HarnessHost): Answerer {
  const spec = HARNESSES[id];
  return harnessAnswerer({
    spec,
    find: () => (host.env.HOME ? findHarness(spec, host.env.HOME, host.env.PATH, host.files ?? hostFiles) : null),
    run: host.run ?? hostRunner((pid) => planUnit(id, pid)),
    shell: host.shell ?? shellPaths(),
    env: host.env,
    // Only this turn's sandbox may reach its plan socket.
    fromTurn: (peer, agent) => host.direct === true || (peer !== null && agent !== null && inUnit(peer, planUnit(id, agent))),
    ...(host.direct ? { direct: true } : {}),
    ...(host.timeoutMs ? { timeoutMs: host.timeoutMs } : {}),
  });
}

/** The answerer for a choice: a harness, a local model, or Claude's or GPT's API. */
function answererFor(id: string | undefined, options: AskOptions, host: HarnessHost): Answerer | null {
  const fetching = options.fetch ? { fetch: options.fetch } : {};
  if (id === undefined) return null;
  if (isHarnessId(id)) return harnessFor(id, host);
  if (id === "local") return localAnswerer({ model: () => options.settings.getSnapshot().data.agents.localModel ?? null, ...fetching });
  if (id === "claude") return claudeAnswerer({ key: async () => (await options.keys.anthropic())?.key ?? null, ...fetching });
  return gptAnswerer({
    key: async () => (await options.keys.openai())?.key ?? null,
    model: () => options.settings.getSnapshot().data.agents.gptModel ?? null,
    ...fetching,
  });
}

/** The answerer Settings names now (null for none), made again only when the choice changes. */
export function chosenAnswerer(options: AskOptions): () => Answerer | null {
  const host: HarnessHost = options.harnesses ?? { env: process.env };
  let made: { choice: AnswererChoice | undefined; answerer: Answerer | null } | null = null;
  return () => {
    const now = options.settings.getSnapshot().data.agents.answerer;
    if (made !== null && made.choice === now) return made.answerer;
    made = { choice: now, answerer: answererFor(answererOf(now)?.id, options, host) };
    return made.answerer;
  };
}
