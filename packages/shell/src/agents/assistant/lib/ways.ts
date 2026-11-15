/**
 * The two ways an ask drives Dashi's tools (decisions.md D148), on the same
 * server with the same policy: a harness the person set up, in the sandbox
 * (harness.ts), or the shell's own loop for a key or a model on this
 * computer (model-loop.ts). Each gives back everything that was said, or
 * throws what went wrong.
 */

import { AnswerError, HARNESSES, type HarnessId, promptStyle, styledPrompt } from "../../ask/index.ts";
import type { TaskPolicy } from "../../lib/session/session-types.ts";
import { contextBlock, type Moment } from "../context.ts";
import type { Conversation } from "../conversation.ts";
import { assistantPrompt, SMALL_ASSISTANT_PROMPT } from "../prompt.ts";
import type { AssistantOptions } from "../types.ts";
import { claudeModel } from "./claude-model.ts";
import { askHarness } from "./harness.ts";
import { localModel } from "./local-model.ts";
import { askModel } from "./model-loop.ts";
import type { Running } from "./running.ts";

export interface WayAsk {
  options: AssistantOptions;
  talk: Conversation;
  /** The conversation's id: its connections' task. */
  task: string;
  words: string;
  moment: Moment;
  run: Running;
  say(text: string): void;
}

export const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

/** Way one: the harness, in the sandbox, on the full server. */
export async function viaHarness({ options, talk, task, words, moment, run, say }: WayAsk, harness: HarnessId): Promise<string> {
  const info = HARNESSES[harness];
  const ask = (session: string | null) => {
    const interrupted = session !== null && talk.exchanges.at(-1)?.interrupted ? "(They stopped you before you finished the last one.)\n" : "";
    const prompt = `${interrupted}${words}\n\n${contextBlock(moment, { fresh: session === null, earlier: session === null ? talk.exchanges : [] })}`;
    return askHarness(options.harness, { harness, task, prompt, system: assistantPrompt(), session, signal: run.signal, say });
  };
  let end = await ask(talk.session);
  // A session that can't be resumed (it was cleared away): the same ask again, told what was said before.
  if (end.error && talk.session !== null && end.said === "" && run.steps.length === 0 && !run.signal.aborted) end = await ask(null);
  if (run.signal.aborted) throw new DOMException("Stopped.", "AbortError");
  if (end.missing) throw new AnswerError("not-installed", `${info.binary} isn't installed.`);
  talk.session = end.session;
  // It ended badly having done nothing: whatever it printed ("Not logged in · Please run /login") is not an answer.
  if (end.error && (end.said === "" || run.steps.length === 0)) {
    options.log?.(`assistant harness: ${end.error}`);
    throw info.signedOut(end.error)
      ? new AnswerError("not-signed-in", "It isn't signed in. Sign in from the launcher.")
      : new AnswerError("failed", "It stopped before it answered.");
  }
  return end.said;
}

/** Way two: the shell's own loop, for a key (`local` false) or a model on this computer. */
export async function viaModel({ options, talk, task, words, moment, run, say }: WayAsk, local: boolean, policy: TaskPolicy): Promise<string> {
  const agents = options.agents();
  if (!agents) throw new AnswerError("failed", "Dashi's tools aren't running in this session.");
  const fetching = options.fetch ? { fetch: options.fetch } : {};
  const model = local
    ? localModel({ model: () => options.settings().agents.localModel ?? null, ...fetching })
    : claudeModel({ key: async () => (await options.keys.anthropic())?.key ?? null, ...fetching });
  const system = local ? styledPrompt(SMALL_ASSISTANT_PROMPT, promptStyle.get().small) : assistantPrompt();
  const before = talk.messages;
  const prompt = `${words}\n\n${contextBlock(moment, { fresh: before.length === 0 })}`;
  const link = agents.connect(task, policy);
  let said = "";
  const hear = (text: string): void => {
    said += text;
    say(text);
  };
  try {
    const end = await askModel({ model, link, system, messages: before, words, prompt, signal: run.signal, say: hear });
    talk.messages = end.messages;
    return end.said;
  } catch (error) {
    // What was heard of it stays in the conversation, so "no, the other one" makes sense.
    if (isAbort(error)) talk.messages = [...before, model.user(prompt), model.said(`${said.trim()} (interrupted)`.trim())];
    throw error;
  } finally {
    link.close();
  }
}
