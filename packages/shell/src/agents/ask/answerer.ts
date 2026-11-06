/**
 * Who answers the launcher's Ask (docs/betterments.html, "Agents in the
 * launcher"; docs/actions.md, "Agents in the launcher"): a coding agent the
 * person already has (Claude Code, Codex, OpenCode), signed in with their
 * own subscription and run in plan mode (harness/); a model on this
 * computer; Claude or GPT with the person's key; or nobody. The person picks
 * in Settings › Agents or the Setup Assistant (settings.json
 * `agents.answerer`); until they do, there is none, and the launcher offers
 * "Set up an agent…" only when ⇥ asks for one. Installed harnesses are
 * offered first, then a local model, then the APIs, then none.
 *
 * An answerer turns the person's words into a plan: the tool calls it would
 * make, which Dashi shows before anything runs (plan.ts). Only the typed
 * request (and, on a follow-up, how the last plan went) is sent; no model is
 * called while typing, ever.
 */

/** The coding agents that answer through plan mode (harness/). */
export type HarnessId = "claude-code" | "codex" | "opencode";
export const HARNESS_IDS: readonly HarnessId[] = ["claude-code", "codex", "opencode"];
export const isHarnessId = (value: unknown): value is HarnessId => HARNESS_IDS.some((id) => id === value);

/** Settings' choice: `null` when the person hasn't picked yet. */
export type AnswererChoice = HarnessId | "local" | "claude" | "gpt" | "none";
/** In the order Settings and Setup offer them: the harnesses, a local model, the APIs, none. */
export const ANSWERER_CHOICES: readonly AnswererChoice[] = [...HARNESS_IDS, "local", "claude", "gpt", "none"];

export const isAnswererChoice = (value: unknown): value is AnswererChoice => ANSWERER_CHOICES.some((choice) => choice === value);

export type AnswererId = Exclude<AnswererChoice, "none">;

/** What a row says about an answerer: its name, and where the words go. */
export interface AnswererInfo {
  id: AnswererId;
  /** "Claude Code", "Local model". */
  name: string;
  /** Short, after the name on the Ask row: "Claude · Anthropic, your key". */
  where: string;
}

export const ANSWERERS: Readonly<Record<AnswererId, AnswererInfo>> = {
  "claude-code": { id: "claude-code", name: "Claude Code", where: "Claude Code · your Claude subscription" },
  codex: { id: "codex", name: "Codex", where: "Codex · your ChatGPT plan" },
  opencode: { id: "opencode", name: "OpenCode", where: "OpenCode · its own provider" },
  local: { id: "local", name: "Local model", where: "Local · stays on this computer" },
  claude: { id: "claude", name: "Claude", where: "Claude · Anthropic, your key" },
  gpt: { id: "gpt", name: "GPT", where: "GPT · OpenAI, your key" },
};

/** The answerer a choice names; null for none, or nothing picked yet. */
export const answererOf = (choice: AnswererChoice | null | undefined): AnswererInfo | null =>
  choice === null || choice === undefined || choice === "none" ? null : ANSWERERS[choice];

/** One tool the plan may use, as models are told of it. */
export interface PlanTool {
  name: string;
  description: string;
  /** JSON Schema for its arguments. */
  schema: Record<string, unknown>;
  /** The action's own check of a call's arguments: plan mode answers a call that fails it, so the agent can fix the call. */
  check?(args: Record<string, unknown>): { ok: true } | { ok: false; error: string };
}

/** A call the model wants made. Its input is as untrusted as anything from outside. */
export interface ModelCall {
  id: string;
  name: string;
  input: unknown;
}

/** One turn of the conversation: the person's words, and how the last plan's calls went. */
export interface Turn {
  text: string;
  results: ReadonlyArray<{ id: string; text: string; error: boolean }>;
}

export interface ModelReply {
  /** What the model said besides its calls (a sentence when it can't plan). */
  text: string;
  calls: ModelCall[];
}

/** Why an answer didn't come, in words a row can say. */
export type AnswerFailure =
  /** No key for the provider (Claude, GPT): Settings › Agents says where it goes. */
  | "no-key"
  /** The harness isn't installed (any more): Settings › Agents says how to install it. */
  | "not-installed"
  /** The harness is installed but not signed in: its sign-in runs in Terminal. */
  | "not-signed-in"
  /** Nothing answered (offline, the local model not running, a timeout). */
  | "no-answer"
  /** No local model is installed. */
  | "no-model"
  /** The provider declined the request. */
  | "refused"
  /** Anything else: the provider's error, shortened. */
  | "failed";

export class AnswerError extends Error {
  constructor(
    readonly failure: AnswerFailure,
    message: string,
  ) {
    super(message);
  }
}

/** An answerer at work: one turn at a time, over a history only it reads. */
export interface Answerer {
  readonly info: AnswererInfo;
  /**
   * Answer `turn` after `history` (what this answerer returned last time, or
   * empty); resolves with the reply and the history to send next time.
   * Rejects with an AnswerError.
   */
  turn(history: readonly unknown[], turn: Turn, tools: readonly PlanTool[], signal: AbortSignal): Promise<{ reply: ModelReply; history: unknown[] }>;
}

/** What every answerer is told, before the person's words. */
export const SYSTEM_PROMPT = [
  "You plan actions on Dashi, a desktop computer, for the person using it.",
  "They typed a request in the launcher. Answer by calling the tools that do what they asked, in the order they should run.",
  "Dashi shows your calls to the person as numbered steps and runs exactly those calls only if the person approves; nothing runs before that.",
  "You can't see the screen, the windows, or the files, and nothing you call runs until later, so plan from the request alone.",
  "If no tool can do what they asked, call none and say so in one short sentence. Don't ask questions back.",
].join(" ");
