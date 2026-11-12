/**
 * Where a picture waits between the compositor writing it and an agent being
 * sent it: `$XDG_RUNTIME_DIR/dashi-agents`, which only the person can reach.
 * With no runtime folder (a run outside a session), a folder of its own in
 * the temporary folder, made 0700 under a name nobody else can make first:
 * never a fixed path there, which another account could own.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let own: string | null = null;

export function scratchDir(env: Record<string, string | undefined> = process.env): string {
  if (env.XDG_RUNTIME_DIR) {
    const dir = join(env.XDG_RUNTIME_DIR, "dashi-agents");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  own ??= mkdtempSync(join(env.TMPDIR || tmpdir(), "dashi-agents-"));
  return own;
}
