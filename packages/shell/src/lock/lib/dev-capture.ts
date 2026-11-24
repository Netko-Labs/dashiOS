/**
 * A picture of the real lock screen, for proof in the VM only (pass 49 could
 * not see it: agents are refused while locked, the person's ⇧❖3 never
 * reaches the shell then, and QEMU cannot read the GPU's screen).
 *
 * It exists only when the shell starts with `DASHI_DEV_LOCK_CAPTURE` naming
 * a folder. The installed `dashi-session` clears that variable before it
 * starts anything (only a checkout's session, `vm/dev-session`, keeps it),
 * so an installed Dashi has no such path at all. Even then:
 *
 * - the folder must be absolute, a real directory (not a link), owned by
 *   this user and closed to everyone else (mode 0700): no other account can
 *   ask for a picture or read one;
 * - it acts only while the screen is locked, and pictures only the screen:
 *   while locked, dashi-comp draws nothing of the session into a capture,
 *   only the wallpaper and the lock surface (render/scene.rs);
 * - a picture is asked by creating `ask` in the folder (the screen under the
 *   pointer) or `ask-<screen>` (that screen, by its output name: with two
 *   screens the other one shows the lock too); the shell takes it away and
 *   writes `lock-<n>.png` (`lock-<n>-<screen>.png`) beside it. Nothing it
 *   writes is read back, and an ask's contents are never read.
 */

import { existsSync, lstatSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** How often the folder is looked at while locked. */
export const DEV_CAPTURE_LOOK_MS = 500;

/** The folder, when the variable names one that is safe to use; else null, with why. */
export function devCaptureFolder(
  env: Readonly<Record<string, string | undefined>>,
  stat: (path: string) => { isDirectory(): boolean; isSymbolicLink(): boolean; uid: number; mode: number } = lstatSync,
  uid: number = process.getuid?.() ?? -1,
): { dir: string } | { refused: string } | null {
  const dir = env.DASHI_DEV_LOCK_CAPTURE;
  if (dir === undefined || dir === "") return null;
  if (!isAbsolute(dir)) return { refused: "it is not an absolute path" };
  try {
    const info = stat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return { refused: "it is not a directory" };
    if (info.uid !== uid) return { refused: "another user owns it" };
    if ((info.mode & 0o077) !== 0) return { refused: "others may open it (it must be 0700)" };
  } catch {
    return { refused: "it does not exist" };
  }
  return { dir };
}

export interface DevCaptureDeps {
  locked(): boolean;
  capture(path: string, output?: string): Promise<unknown>;
  /** The screens' output names, for `ask-<screen>`. */
  screens?(): Promise<readonly string[]>;
  now?(): number;
  exists?(path: string): boolean;
  remove?(path: string): void;
  log?(line: string): void;
}

/** One look: while locked, an `ask` in the folder becomes a picture. Resolves with its path, or null. */
export async function lookForAsk(dir: string, deps: DevCaptureDeps): Promise<string | null> {
  const exists = deps.exists ?? existsSync;
  if (!deps.locked()) return null;
  const screens = (await deps.screens?.().catch(() => [])) ?? [];
  const asks = [{ ask: join(dir, "ask"), output: undefined }, ...screens.map((output) => ({ ask: join(dir, `ask-${output}`), output }))];
  const asked = asks.find((each) => exists(each.ask));
  if (!asked) return null;
  (deps.remove ?? ((path: string) => rmSync(path, { force: true })))(asked.ask);
  const path = join(dir, `lock-${(deps.now ?? Date.now)()}${asked.output === undefined ? "" : `-${asked.output}`}.png`);
  await deps.capture(path, asked.output);
  deps.log?.(`dashi-shell: dev lock capture saved to ${path}`);
  return path;
}

/** Start looking (every half second) when the variable is set; returns the stop, or null when it is not. */
export function startDevCapture(env: Readonly<Record<string, string | undefined>>, deps: DevCaptureDeps): (() => void) | null {
  const folder = devCaptureFolder(env);
  if (folder === null) return null;
  const log = deps.log ?? console.log;
  if ("refused" in folder) {
    log(`dashi-shell: DASHI_DEV_LOCK_CAPTURE ignored: ${folder.refused}`);
    return null;
  }
  log(`dashi-shell: dev lock capture on, in ${folder.dir} (a checkout's session only)`);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void lookForAsk(folder.dir, deps)
      .catch((error: unknown) => log(`dashi-shell: dev lock capture failed: ${String(error)}`))
      .finally(() => {
        busy = false;
      });
  }, DEV_CAPTURE_LOOK_MS);
  return () => clearInterval(timer);
}
