/** What Dashi's assistant is given and what it offers (agents/assistant/; decisions.md D147 to D149). */

import type { ActionState, Outcome } from "../../actions/types.ts";
import type { Timers } from "../../shared/time/index.ts";
import type { AnswererChoice, Fetch, HistoryLog, ModelKeys, Undo } from "../ask/index.ts";
import type { Grants } from "../consent.ts";
import type { LocalLink } from "../lib/server-local.ts";
import type { TaskHooks, TaskPolicy } from "../lib/session/session-types.ts";
import type { AgentUi } from "../presence.ts";
import type { Moment } from "./context.ts";
import type { Conversation, TalkLog } from "./conversation.ts";
import type { HarnessHost } from "./lib/harness.ts";

/** What a spoken ask is answered with: what is left to say after what was said as it came. */
export interface SpokenAnswer {
  say: string;
  /** It didn't answer: the words also stay where the person looks, and a press goes there. */
  failed?: { go?: "voice" | "agents" | "launcher" };
}

/** What an ask tells while it is answered. */
export interface Hears {
  /** Words as they are written. */
  say(text: string): void;
  /** What Dashi is doing, in its own words. */
  step(title: string): void;
  /** The language the words were heard in ("es"), when they told it: the answer is in it. */
  language?: string | undefined;
}

export interface AssistantSettings {
  agents: { answerer?: AnswererChoice; localModel?: string; skipGrants?: boolean };
  /** Settings › Voice: "Ask before every step" keeps the plan and its card for spoken asks. */
  voice: { askEveryStep?: boolean };
}

export interface AssistantOptions {
  settings(): AssistantSettings;
  /** The agents' server; null before it starts or without a compositor. */
  agents(): { connect(task: string, policy: TaskPolicy): LocalLink; stopTask(task: string): void; grants: Grants } | null;
  /** The consent sheet, for the first use; null where there is none. */
  ui(): Pick<AgentUi, "ask"> | null;
  /** Plan mode, for "Ask before every step" and an answerer that has no loop yet: the launcher's planner. */
  planner: { ask(words: string, signal: AbortSignal): Promise<SpokenAnswer> };
  keys: ModelKeys;
  harness: HarnessHost;
  /** The moment the words are said in (context.ts): the window in front, the page, the time. */
  moment(): Promise<Moment>;
  /** What Dashi is called, on a sheet and in the history. */
  name(): string;
  locked(): boolean;
  /** A setting's value now, and where `set_setting` is: what an Undo is made of. */
  settingNow(name: string): ActionState;
  setSettingAddress(): string | null;
  /** Put a setting back, as the person. */
  runUndo(undo: Undo): Promise<Outcome>;
  history?: Pick<HistoryLog, "add" | "undone">;
  /** Keep one line the person asked to have remembered ("What I know about you"); false when it could not be kept. */
  remember?(fact: string): boolean;
  talkLog?: TalkLog;
  fetch?: Fetch;
  timers?: Timers;
  now?(): number;
  newId?(): string;
  /** One line for the shell's log. */
  log?(line: string): void;
  maxCalls?: number;
  maxMs?: number;
}

export interface Assistant extends TaskHooks {
  /** Answer what was said: by rule, by plan mode, or by the loop. */
  ask(words: string, signal: AbortSignal, hears?: Hears): Promise<SpokenAnswer>;
  /** The key went down: the moment is read now, before the words are known. */
  prepare(): void;
  /** The conversation: whether it is open, and its clock. */
  talk: Conversation;
  /** The policy for a connection of the conversation's own task; null for any other task. */
  policy(task: string): TaskPolicy | null;
  close(): void;
}
