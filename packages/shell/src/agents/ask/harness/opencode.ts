/**
 * How Dashi runs OpenCode, for every path that does (decisions.md D691):
 * plan mode (catalog.ts), a run from the launcher (handoff), and the
 * assistant, which takes the launcher's command line.
 *
 * - OpenCode 2 (checked against opencode 2.4.1's `run --help`, and run in a
 *   bwrap sandbox): `opencode run` goes to its shared background service
 *   (`opencode serve --service`), which lives outside the agent sandbox,
 *   can't see the turn's folder ("Location not found") and never reads
 *   `OPENCODE_CONFIG_CONTENT`. `--standalone` runs a private server inside
 *   the sandbox instead (D690), and `--archived` keeps Dashi's turns out of
 *   the person's own session list.
 * - OpenCode 1 (1.19, which opencode.ai/install still gives) has neither
 *   flag and runs its turn in its own process: its command line is as it was.
 *
 * Which is which, the program says (`--version`, version.ts); a version
 * that can't be told is taken as the current release, 2.
 */

import { join } from "node:path";
import { isRaw, jsonLines, str } from "./lib/harness-text.ts";
import { type HarnessCommand, type HarnessSpec, type HarnessTurn, PLAN_SERVER, signedOutWords } from "./spec.ts";
import { majorVersion } from "./version.ts";

/** The agent a turn runs as, made from Dashi's words in OPENCODE_CONFIG_CONTENT. */
export interface OpenCodeAgent {
  name: string;
  description: string;
}

const PLAN_AGENT: OpenCodeAgent = { name: "dashi-plan", description: "Plans actions on Dashi" };

/** What `opencode run` needs besides its words, by version: 2 and later a private server and an archived session; 1 nothing. */
export function opencodeFlags(version: string | null | undefined): string[] {
  const major = majorVersion(version);
  return major !== null && major < 2 ? [] : ["--standalone", "--archived"];
}

/** The one `opencode run` Dashi makes: every tool off but Dashi's, edits, shell and fetches denied, as `agent`. */
export function opencodeCommand(turn: HarnessTurn, agent: OpenCodeAgent): HarnessCommand {
  const tools = { "*": false, [`${PLAN_SERVER}_*`]: true };
  const config = {
    mcp: { [PLAN_SERVER]: { type: "local", command: [turn.mcp.command, ...turn.mcp.args], environment: { ...turn.mcp.env }, enabled: true } },
    tools,
    permission: { edit: "deny", bash: "deny", webfetch: "deny" },
    agent: { [agent.name]: { description: agent.description, mode: "primary", prompt: turn.system, tools } },
  };
  return {
    args: [
      "run",
      ...opencodeFlags(turn.version),
      "--format",
      "json",
      "--agent",
      agent.name,
      ...(turn.model ? ["--model", turn.model] : []),
      ...(turn.session ? ["--session", turn.session] : []),
      "--",
      turn.prompt,
    ],
    stdin: "",
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  };
}

export const opencode: HarnessSpec = {
  id: "opencode",
  binary: "opencode",
  dirs: [".opencode/bin", ".local/bin", ".bun/bin", ".npm-global/bin"],
  uses: "OpenCode’s configured provider",
  // opencode.ai's own line (D692): its `/install` gives OpenCode 1 only, `/v2/install` the current release.
  install: "curl -fsSL https://opencode.ai/v2/install | bash",
  signIn: ["auth", "login"],
  versioned: true,
  state: (home, env) => {
    const data = env.XDG_DATA_HOME || join(home, ".local/share");
    const config = env.XDG_CONFIG_HOME || join(home, ".config");
    const state = env.XDG_STATE_HOME || join(home, ".local/state");
    const cache = env.XDG_CACHE_HOME || join(home, ".cache");
    return [join(data, "opencode"), join(config, "opencode"), join(state, "opencode"), join(cache, "opencode")];
  },
  // Its provider may be configured by a key in the session.
  passEnv: /^(?:[A-Z0-9_]+_API_KEY|OPENCODE_[A-Z0-9_]+|AWS_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+|AZURE_[A-Z0-9_]+)$/,
  signedIn: {
    kind: "file",
    path: (home, env) => join(env.XDG_DATA_HOME || join(home, ".local/share"), "opencode", "auth.json"),
    read(text) {
      try {
        const auth: unknown = JSON.parse(text);
        return isRaw(auth) && Object.keys(auth).length > 0 ? true : null;
      } catch {
        return null;
      }
    },
  },
  command: (turn) => opencodeCommand(turn, PLAN_AGENT),
  read(stdout) {
    let session: string | null = null;
    const text: string[] = [];
    let error: string | null = null;
    for (const event of jsonLines(stdout)) {
      session = str(event.sessionID) ?? session;
      const part = isRaw(event.part) ? event.part : null;
      if (event.type === "text" && part) {
        const words = str(part.text);
        if (words) text.push(words);
      }
      if (event.type === "error") {
        const inner = isRaw(event.error) ? event.error : null;
        const data = inner && isRaw(inner.data) ? inner.data : null;
        error = str(data?.message) ?? str(inner?.message) ?? str(inner?.name) ?? "OpenCode stopped.";
      }
    }
    // Each text part its own paragraph: what is shown is the last, its final words (plan.ts `spokenWords`).
    return { session, text: error ? "" : text.join("\n\n").trim(), error };
  },
  signedOut: signedOutWords,
};
