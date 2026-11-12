/**
 * Handing a `dashi://` link to the running shell from another process, over
 * the links socket (the shell serves it: actions/lib/links.ts): what `dashi-open` does, and what Dashi's apps
 * do to open a place in Settings (the portal's Access sheet opens Privacy &
 * Security). One request per connection; the shell answers one line.
 */

import { join } from "node:path";

/** The links socket's name in the runtime folder. */
export const LINKS_SOCKET = "dashi-links.sock";

export type LinkAnswer = { ok: true; text: string } | { ok: false; error: string };

/** Where the shell listens, for this user. */
export function linksSocketFor(env: Record<string, string | undefined> = process.env): string {
  if (env.DASHI_LINKS_SOCKET) return env.DASHI_LINKS_SOCKET;
  return join(env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`, LINKS_SOCKET);
}

/** The shell's answer line, read: what it said, or why the link wasn't opened. */
export function parseLinkAnswer(text: string): LinkAnswer {
  let reply: unknown = null;
  try {
    reply = JSON.parse(text.split("\n")[0] ?? "");
  } catch {
    // Below: no answer.
  }
  const fields = typeof reply === "object" && reply !== null ? (reply as Record<string, unknown>) : {};
  if (fields.ok === true) return { ok: true, text: typeof fields.text === "string" ? fields.text : "" };
  return { ok: false, error: typeof fields.error === "string" ? fields.error : "Dashi gave no answer." };
}

/** Open `url` in the running session. Never throws: a session that isn't there is an answer too. */
export async function openLink(url: string, path: string = linksSocketFor()): Promise<LinkAnswer> {
  let answer = "";
  // One decoder for the connection: a character cut between two chunks is held until the rest arrives.
  const decoder = new TextDecoder();
  const done = Promise.withResolvers<void>();
  try {
    const socket = await Bun.connect({
      unix: path,
      socket: {
        data(_socket, data) {
          answer += decoder.decode(data, { stream: true });
        },
        close() {
          done.resolve();
        },
        error() {
          done.resolve();
        },
      },
    });
    socket.write(`${JSON.stringify({ open: url })}\n`);
  } catch (error) {
    return { ok: false, error: `Dashi can't be reached at ${path} (${error}).` };
  }
  await done.promise;
  return parseLinkAnswer(answer);
}
