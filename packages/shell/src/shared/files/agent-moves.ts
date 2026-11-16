/**
 * Moving, copying and renaming for agents (move_file, copy_file,
 * rename_file): both ends under the home folder and removable drives, never a
 * secret place, never the home folder or a standard folder itself. A name
 * already taken is refused unless the agent says `replace`, and then the one
 * there goes to the Trash first: nothing is lost for good.
 */

import type { AgentPolicy } from "./agent.ts";
import { placeForAgent } from "./agent-place.ts";
import { type Exec, exec } from "./exec.ts";
import { copyInto, moveInto, quietContext, renamePath } from "./ops.ts";
import { baseName, checkName, isInside, parentOf } from "./paths.ts";
import { protectedReason, trashPaths } from "./trashops.ts";

export type Moved = { from: string; to: string; trashed: boolean } | { error: string };

/** Where `to` lands: into it when it is a folder that exists, else at that path (its folder must exist). */
async function destination(from: string, to: string, policy: AgentPolicy): Promise<{ path: string; exists: boolean } | { error: string }> {
  const place = await placeForAgent(to, policy);
  if (!place.ok) return { error: place.error };
  if (place.exists && place.kind === "folder" && place.path !== from) {
    const inside = await placeForAgent(`${place.path}/${baseName(from)}`, policy);
    return inside.ok ? { path: inside.path, exists: inside.exists } : { error: inside.error };
  }
  return { path: place.path, exists: place.exists };
}

async function makeRoom(path: string, exists: boolean, replace: boolean, run: Exec): Promise<{ trashed: boolean } | { error: string }> {
  if (!exists) return { trashed: false };
  if (!replace)
    return { error: `Something called “${baseName(path)}” is already there. Say replace: true to put this in its place (the one there goes to the Trash).` };
  const result = await trashPaths([path], quietContext(), run);
  return result.failed.length > 0
    ? { error: `The one there couldn't be moved to the Trash, so nothing was done: ${result.failed[0]?.reason ?? ""}` }
    : { trashed: true };
}

export async function moveForAgent(
  how: "move" | "copy",
  fromInput: string,
  toInput: string,
  replace: boolean,
  policy: AgentPolicy,
  run: Exec = exec,
): Promise<Moved> {
  const source = await placeForAgent(fromInput, policy);
  if (!source.ok) return { error: source.error };
  if (!source.exists) return { error: "There is nothing at that path." };
  if (how === "move") {
    const reason = protectedReason(source.path, policy.home, policy.userDirs);
    if (reason) return { error: reason.replace("moved to the Trash", "moved") };
  }
  const target = await destination(source.path, toInput, policy);
  if ("error" in target) return target;
  if (target.path === source.path) return { error: "That is where it is already." };
  if (isInside(source.path, target.path)) return { error: "A folder can't go inside itself." };
  const room = await makeRoom(target.path, target.exists, replace, run);
  if ("error" in room) return room;
  try {
    const ctx = quietContext();
    const to =
      how === "move"
        ? await moveInto(source.path, parentOf(target.path), ctx, baseName(target.path))
        : await copyInto(source.path, parentOf(target.path), ctx, baseName(target.path));
    return { from: source.path, to: to ?? target.path, trashed: room.trashed };
  } catch (error) {
    return { error: `It couldn't be ${how === "move" ? "moved" : "copied"}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function renameForAgent(input: string, name: string, replace: boolean, policy: AgentPolicy, run: Exec = exec): Promise<Moved> {
  const bad = checkName(name);
  if (bad) return { error: bad };
  const source = await placeForAgent(input, policy);
  if (!source.ok) return { error: source.error };
  if (!source.exists) return { error: "There is nothing at that path." };
  const reason = protectedReason(source.path, policy.home, policy.userDirs);
  if (reason) return { error: reason.replace("moved to the Trash", "renamed") };
  const target = await placeForAgent(`${parentOf(source.path)}/${name}`, policy);
  if (!target.ok) return { error: target.error };
  const room = await makeRoom(target.path, target.exists, replace, run);
  if ("error" in room) return room;
  try {
    return { from: source.path, to: await renamePath(source.path, name), trashed: room.trashed };
  } catch (error) {
    return { error: `It couldn't be renamed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
