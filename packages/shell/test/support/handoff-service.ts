import type { Files } from "../../src/agents/ask/harness/index.ts";
import { GrantsMemory, type TaskContext } from "../../src/agents/handoff/grants.ts";
import type { RunRecord } from "../../src/agents/handoff/lib/records.ts";
import type { FoundRun, TaskRunner, TurnRead, TurnStart } from "../../src/agents/handoff/lib/runner.ts";
import type { RunView } from "../../src/agents/handoff/run-view.ts";
import { startHandoff } from "../../src/agents/handoff/service.ts";

export const helium: TaskContext = {
  window: { id: 3, app: "Helium", title: "Clases · Bodytech", site: "bodytech.com.co", url: "https://bodytech.com.co/clases" },
  selection: null,
};

/** A runner that records what it was asked and plays lines into the watchers; `disk` is what a restarted shell finds. */
function fakeRunner(
  disk: { runs: FoundRun[]; running: Map<string, number>; turns: Map<string, TurnRead> } = { runs: [], running: new Map(), turns: new Map() },
) {
  const started: TurnStart[] = [];
  const stopped: string[] = [];
  const saved: RunRecord[] = [];
  const forgotten: string[] = [];
  const watchers = new Map<string, { line: (line: string) => void; exit: (code: number | null) => void }>();
  const runner: TaskRunner = {
    async start(turn) {
      started.push(turn);
      return null;
    },
    stop(run, turn) {
      stopped.push(`${run}:${turn}`);
    },
    watch(run, turn, line, exit) {
      watchers.set(`${run}:${turn}`, { line, exit });
      return () => watchers.delete(`${run}:${turn}`);
    },
    forget(run) {
      forgotten.push(run);
    },
    save(record) {
      saved.push(record);
    },
    readTurn: (run, turn) => disk.turns.get(`${run}:${turn}`) ?? null,
    found: () => ({ runs: disk.runs, running: disk.running }),
  };
  return { runner, started, stopped, saved, forgotten, watchers };
}

const files: Files = {
  isExecutable: (path) => path === "/home/alex/.local/bin/claude",
  real: (path) => path,
  exists: () => false,
  head: () => null,
};

export function service(disk?: Parameters<typeof fakeRunner>[0], options: { now?: () => number; ended?: (run: RunView) => void } = {}) {
  const fake = fakeRunner(disk);
  let id = 0;
  const handoff = startHandoff({
    ...options,
    settings: { getSnapshot: () => ({ data: { agents: {} } }), subscribe: () => () => {} },
    env: { HOME: "/home/alex", XDG_RUNTIME_DIR: "/run/user/1000", PATH: "/usr/bin" },
    runner: fake.runner,
    files,
    shell: { bun: "/usr/bin/bun", bridge: "/dashi/bin/dashi-mcp.ts", dashiAgent: "/dashi/bin/dashi-agent.ts", task: "/dashi/bin/dashi-task.ts" },
    memory: new GrantsMemory(null),
    settingNow: (name) => (name === "dark_mode" ? false : undefined),
    setSettingAddress: () => "dashi://settings/set",
    newId: () => `run${++id}`,
  });
  return { handoff, ...fake };
}

export const line = (value: unknown) => JSON.stringify(value);
