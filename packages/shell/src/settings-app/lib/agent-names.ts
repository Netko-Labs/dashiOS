/**
 * Naming an agent in Settings from the key its answers are kept under
 * (agents/peer.ts, agents/lib/invocation.ts): the executable's path, plus what an
 * interpreter runs, or `ssh:<name>` for a remote agent.
 *
 *   /usr/bin/claude                              a program
 *   /usr/bin/bun /home/me/agent.ts               a script
 *   /usr/bin/python3 -m tool in /home/me/proj    a module
 *   /usr/bin/node -e sha256:ab12…                inline code
 */

import { basename } from "node:path";

export interface AgentName {
  /** What to call it. */
  title: string;
  /** Where it runs from, shortened. */
  detail: string;
}

/** `/home/me/x` as `~/x`. */
function shorten(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

export function describeAgentKey(key: string, home: string): AgentName {
  if (key.startsWith("ssh:")) return { title: key.slice(4) || "Unknown", detail: "Remote agent over SSH" };
  // An executable path has no spaces in the keys the shell writes; what follows the first space is what it runs.
  const space = key.indexOf(" ");
  if (space < 0) return { title: basename(key) || key, detail: shorten(key, home) };
  const executable = key.slice(0, space);
  const rest = key.slice(space + 1);
  const program = basename(executable);
  const module = /^-m (.+) in (.+)$/.exec(rest);
  if (module) return { title: module[1] as string, detail: `${program} -m, in ${shorten(module[2] as string, home)}` };
  if (/^-e sha256:/.test(rest)) return { title: "Inline code", detail: `${program} -e` };
  return { title: basename(rest) || rest, detail: `${program} ${shorten(rest, home)}` };
}
