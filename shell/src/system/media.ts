/** The media keys, through `playerctl` (MPRIS): whichever player is current. */

import { hasProgram, type Run } from "./exec.ts";

export type MediaKey = "media-play-pause" | "media-play" | "media-pause" | "media-next" | "media-previous";

const COMMANDS: Record<MediaKey, string> = {
  "media-play-pause": "play-pause",
  "media-play": "play",
  "media-pause": "pause",
  "media-next": "next",
  "media-previous": "previous",
};

export function isMediaKey(name: string): name is MediaKey {
  return Object.hasOwn(COMMANDS, name);
}

/** Sends the key to the current player; false without playerctl. */
export async function pressMedia(run: Run, key: MediaKey, hasPlayerctl: boolean = hasProgram("playerctl")): Promise<boolean> {
  if (!hasPlayerctl) return false;
  await run(["playerctl", COMMANDS[key]]);
  return true;
}
