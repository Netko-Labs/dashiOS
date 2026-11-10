/**
 * The Files app's folders as agents see them (shared/files/agent.ts has the
 * rules: where an agent may look, and what it may do). A status line names
 * what is being done, never a file or folder: names are the person's.
 */

import { homedir, userInfo } from "node:os";
import { clean } from "../../notifications/index.ts";
import { type AgentPolicy, listFolder as list, openForAgent, planTrash, searchFor, trashForAgent } from "../../shared/files/agent.ts";
import { systemMimeIndex } from "../../shared/files/mime.ts";
import { OPEN_TIMEOUT_MS } from "../../shared/files/open.ts";
import { quietContext } from "../../shared/files/ops.ts";
import { userDirs } from "../../shared/files/xdg.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";

function currentPolicy(): AgentPolicy {
  const home = process.env.HOME || homedir();
  let user = process.env.USER ?? "user";
  try {
    user = userInfo().username;
  } catch {
    // The environment's name stands.
  }
  return { home, user, userDirs: userDirs().map((dir) => dir.path) };
}

export async function listFolder(call: { path: string; hidden: boolean; limit: number }, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking in a folder");
  const result = await list(call.path, { hidden: call.hidden, limit: call.limit }, { policy: currentPolicy(), index: systemMimeIndex() });
  return "error" in result ? toolError(result.error) : json({ path: result.path, entries: result.entries, total: result.total, shown: result.entries.length });
}

export async function searchFiles(call: { query: string; folder: string | null; limit: number }, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Searching your files");
  const result = await searchFor(call.query, { folder: call.folder, limit: call.limit }, { policy: currentPolicy(), index: systemMimeIndex() });
  return "error" in result ? toolError(result.error) : json({ results: result.results, total: result.total, ...(result.truncated ? { truncated: true } : {}) });
}

export async function openFile(call: { path: string }, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Opening a file");
  const result = await openForAgent(call.path, { policy: currentPolicy(), index: systemMimeIndex() });
  if ("error" in result) return toolError(result.error);
  return result.confirmed
    ? text(`Opened the ${result.kind} in its app.`, { path: result.opened, kind: result.kind, opened: true })
    : text(
        `Asked its app to open the ${result.kind}, but the app hadn't taken it after ${OPEN_TIMEOUT_MS / 1000} s. It may still be starting: take a screenshot before going on.`,
        {
          path: result.opened,
          kind: result.kind,
          opened: false,
        },
      );
}

export async function trashFile(call: { path: string }, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at a file to move to the Trash");
  const policy = currentPolicy();
  const plan = await planTrash(call.path, policy);
  if ("error" in plan) return toolError(plan.error);
  // What the person is asked is the real name, cleaned: it is theirs to see, and only they see this sheet.
  const name = clean(plan.name, 80);
  const yes = await ctx.confirm({
    summary: `move “${name}” to the Trash`,
    detail:
      plan.kind === "folder"
        ? "The folder and everything in it go to the Trash. You can put it back from there."
        : "It goes to the Trash. You can put it back from there.",
    action: "Move to Trash",
    danger: true,
  });
  if (!yes) return toolError("The person did not allow that file to be moved to the Trash. Don't ask again unless they agree.");
  ctx.status("Moving a file to the Trash");
  // They may have taken a while: look again, and trash only what they were shown.
  const again = await planTrash(call.path, policy);
  if ("error" in again || again.path !== plan.path)
    return toolError("The file changed while the person was deciding, so nothing was moved. List the folder and try again.");
  const problem = await trashForAgent(again, quietContext());
  return problem ? toolError(`It couldn't be moved to the Trash: ${problem}`) : text("It is in the Trash.", { trashed: true });
}
