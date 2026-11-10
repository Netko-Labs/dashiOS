/**
 * Noticing that the compositor is gone. The supervisor is not a Wayland
 * client, so nothing else tells it the session ended; left alone it would
 * restart the shell against a dead display until it gave up.
 */

/** Whether `pid` exists (a process we may not signal still exists). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

export interface ParentProbe {
  /** The process that started the supervisor (`-c` runs it through sh). */
  parentPid: number;
  /** dashi-comp itself, when dashi-session told us (DASHI_COMP_PID). */
  compositorPid: number | null;
  currentParentPid(): number;
  isAlive(pid: number): boolean;
}

/** True once the compositor has exited: it is gone, or we were reparented. */
export function compositorGone(probe: ParentProbe): boolean {
  if (probe.currentParentPid() !== probe.parentPid) return true;
  if (probe.compositorPid !== null && !probe.isAlive(probe.compositorPid)) return true;
  return false;
}

/** Parse DASHI_COMP_PID; anything but a plain positive integer is ignored. */
export function parsePid(value: string | undefined): number | null {
  if (!value || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  return Number(value);
}

/** Poll for the compositor's exit; returns the function that stops polling. */
export function watchCompositor(onGone: () => void, intervalMs = 1_000): () => void {
  const probe: ParentProbe = {
    parentPid: process.ppid,
    compositorPid: parsePid(process.env.DASHI_COMP_PID),
    currentParentPid: () => process.ppid,
    isAlive: isProcessAlive,
  };
  const timer = setInterval(() => {
    if (!compositorGone(probe)) return;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  return () => clearInterval(timer);
}
