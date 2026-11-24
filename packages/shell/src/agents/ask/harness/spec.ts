/**
 * What a harness is to Dashi (catalog.ts lists them): where it is, how it
 * signs in, and its command line for one turn, as data.
 */

import type { HarnessId } from "../answerer.ts";

/** What a turn's command line is built from. */
export interface HarnessTurn {
  /** The prompt for this turn (the request, or a follow-up with how the last plan went). */
  prompt: string;
  /** What the harness is told before anything (answerer.ts SYSTEM_PROMPT, for plan mode). */
  system: string;
  /** The harness's own session to continue, from its last turn; null on the first. */
  session: string | null;
  /** The model to run with (`--model`), as Settings › Agents names it; its own default when unset. */
  model?: string;
  /** Dashi's plan-mode server, as a stdio MCP server the harness starts: the bridge and its socket. */
  mcp: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> };
  /** The program's version, for a harness whose command line depends on it (`versioned`); unknown when unset or null. */
  version?: string | null;
}

/** A turn's command line: the arguments after the program, what goes on stdin, and variables to add. */
export interface HarnessCommand {
  args: string[];
  stdin: string;
  env: Record<string, string>;
}

/** What a finished run printed, read. */
export interface HarnessOutput {
  /** Its session, for a follow-up; null when it didn't say. */
  session: string | null;
  /** Its last words (empty when it only made calls). */
  text: string;
  /** What went wrong, in its words; null when it ended well. */
  error: string | null;
}

export interface HarnessSpec {
  id: HarnessId;
  /** The program's name on PATH. */
  binary: string;
  /** Where its installers put it besides PATH, under the home folder. */
  dirs: readonly string[];
  /** What it answers with, on its row: "Your Claude subscription". */
  uses: string;
  /** How to install it, shown while it isn't. */
  install: string;
  /** How to sign in, in Terminal: the arguments after the program. */
  signIn: readonly string[];
  /** Whether its command line depends on its version: the program is asked it (`--version`) before a turn (version.ts). */
  versioned?: boolean;
  /**
   * What of the home folder it needs, bound read-write into its sandbox
   * (its login, and the sessions a follow-up resumes); nothing else of the
   * home folder is there. `env` is the session's environment, for a folder
   * the person moved (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*).
   */
  state(home: string, env: Readonly<Record<string, string | undefined>>): string[];
  /** Variables of the session it may see beside the basic ones (a provider's key, for OpenCode). */
  passEnv?: RegExp;
  /** Whether it is signed in, without a model call; null when that can't be told cheaply. */
  signedIn:
    | { kind: "command"; args: readonly string[]; read(stdout: string, code: number | null): boolean | null }
    | { kind: "file"; path(home: string, env: Readonly<Record<string, string | undefined>>): string; read(text: string): boolean | null };
  command(turn: HarnessTurn): HarnessCommand;
  read(stdout: string, code: number | null): HarnessOutput;
  /** Whether its error means it isn't signed in (or its login lapsed). */
  signedOut(error: string): boolean;
}

/** The plan-mode server's name in every harness: its tools are `mcp__dashi__*`, `dashi_*`. */
export const PLAN_SERVER = "dashi";

const SIGNED_OUT = /not logged in|log ?in|sign ?in|unauthori[sz]ed|\b401\b|authenticat|oauth|token (?:has )?expired|invalid api key|api key/i;

/** Whether a harness's error means it isn't signed in (or its login lapsed): the words they all use. */
export const signedOutWords = (error: string): boolean => SIGNED_OUT.test(error);
