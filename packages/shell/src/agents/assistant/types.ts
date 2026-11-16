/** What Dashi's assistant is given and what it offers (agents/assistant/; decisions.md D147 to D149). */

import type { ActionState, Outcome } from "../../actions/types.ts";
import type { Timers } from "../../shared/time/index.ts";
import type { AnswererChoice, Fetch, HistoryLog, ModelKeys, Undo } from "../ask/index.ts";
import type { Grants } from "../consent.ts";
import type { LocalLink } from "../lib/server-local.ts";
import type { TaskHooks, TaskPolicy } from "../lib/session/session-types.ts";
import type { PersonAnswer } from "../presence.ts";
import type { Moment } from "./context.ts";
import type { Conversation, TalkLog } from "./conversation.ts";
import type { HarnessHost } from "./lib/harness.ts";
import type { By, Transcript } from "./transcript.ts";

/** settings.json `agents.models`: per answerer, the model when typed and when spoken (decisions.md D262). */
export type ModelChoices = Readonly<Partial<Record<string, { typed?: string; spoken?: string }>>>;

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
  /** Spoken (the capsule) or typed (the launcher); spoken unless said. */
  by?: By;
}

export interface AssistantSettings {
  /** Who answers, the models (lib/channel.ts), and "Read typed answers aloud" (off unless true). */
  agents: { answerer?: AnswererChoice; localModel?: string; models?: ModelChoices; readTyped?: boolean };
}

export interface AssistantOptions {
  settings(): AssistantSettings;
  /** The agents' server; null before it starts or without a compositor. */
  agents(): { connect(task: string, policy: TaskPolicy): LocalLink; stopTask(task: string): void; grants: Grants } | null;
  /** Plan mode, for a spoken ask to an answerer that has no loop yet (GPT): the launcher's planner. */
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
  /** A turn kept working on its own ended: the notification (decisions.md D261). */
  done?(title: string, body: string): void;
  /** Say a typed answer out loud ("Read typed answers aloud"). */
  speak?(text: string): void;
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
  /** The conversation as the launcher shows it, spoken and typed turns alike. */
  transcript: Pick<Transcript, "subscribe" | "getSnapshot">;
  /** A typed ask from the launcher: answered in the transcript; false when nothing can take it (no answerer, the screen locked). */
  type(words: string): boolean;
  /** ❖Esc: the turn at work stops; the conversation stays open. */
  stop(): void;
  /** ❖↩ Keep working on it: the turn at work goes on by itself, with room for a longer job; false when nothing works. */
  keepWorking(): boolean;
  /** The person answered the question waiting in the launcher. */
  reply(answer: PersonAnswer): boolean;
  /** What a turn asked this way would be answered with now ("Claude Code · opus"); null with no answerer. */
  model(by: By): string | null;
  /** Whether conversation `task`'s turn goes on by itself now: the bar's one indicator shows it then, and only then. */
  background(task: string): boolean;
  /** The policy for a connection of the conversation's own task; null for any other task. */
  policy(task: string): TaskPolicy | null;
  close(): void;
}
