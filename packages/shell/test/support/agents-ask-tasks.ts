import type { ActionDef, Args, Outcome } from "../../src/actions/types.ts";
import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type Turn } from "../../src/agents/ask/answerer.ts";
import type { TaskRecord } from "../../src/agents/ask/history.ts";
import type { TaskDeps } from "../../src/agents/ask/lib/task-types.ts";
import { AskTasks } from "../../src/agents/ask/lib/tasks.ts";
import { TOOL_ACTIONS } from "../../src/agents/index.ts";

/** An answerer that replies with `calls` (or fails), and remembers each turn it was given. */
export function fakeAnswerer(replies: Array<ModelCall[] | AnswerError>): Answerer & { turns: Turn[]; histories: unknown[][] } {
  const turns: Turn[] = [];
  const histories: unknown[][] = [];
  return {
    info: ANSWERERS.claude,
    turns,
    histories,
    async turn(history, turn) {
      turns.push(turn);
      histories.push([...history]);
      const reply = replies.shift() ?? [];
      if (reply instanceof AnswerError) throw reply;
      return { reply: { text: reply.length === 0 ? "I can't do that here." : "", calls: reply }, history: [...history, turn.text] };
    },
  };
}

export function harness(
  answerer: Answerer | null,
  options: { person?: boolean[]; outcomes?: Outcome[]; settings?: Record<string, unknown>; gate?: Promise<void>; timers?: TaskDeps["timers"] } = {},
) {
  const ran: Array<{ address: string; args: Args; by: { agent: string; task: string } }> = [];
  const kept: TaskRecord[] = [];
  const undone: Array<[string, number]> = [];
  const undos: Args[] = [];
  const person = options.person ?? [true];
  const deps: TaskDeps = {
    answerer: () => answerer,
    actions: () => TOOL_ACTIONS,
    run: async (action: ActionDef, args, by) => {
      ran.push({ address: action.address, args, by });
      await options.gate;
      return options.outcomes?.shift() ?? { ok: true, text: "Done." };
    },
    personPressed: async () => person.shift() ?? true,
    settingNow: (name) => (options.settings?.[name] as boolean | undefined) ?? null,
    undo: async (undo) => {
      undos.push(undo.args);
      return { ok: true, text: "Put back." };
    },
    history: { add: (record) => kept.push(record), undone: (entry, step) => undone.push([entry, step]) },
    now: () => 1_000_000,
    timers: options.timers ?? { set: () => null, clear() {} },
  };
  return { tasks: new AskTasks(deps), ran, kept, undone, undos };
}

export const darkAndDock = [
  { id: "t1", name: "set_setting", input: { name: "dark_mode", value: true } },
  { id: "t2", name: "set_setting", input: { name: "dock_autohide", value: true } },
];
