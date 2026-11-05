/**
 * The launcher's timing log, for measuring the typing budget in the VM:
 * `DASHI_LAUNCHER_TIMING=1` in the shell's environment writes one line per
 * moment to its log (the journal), each against its budget (budget.ts):
 *
 *   dashi-shell: launcher: open → first frame 31.2 ms (budget 50 ms, resident host)
 *   dashi-shell: launcher: keystroke → rows sent 3.4 ms (budget 16 ms)
 *   dashi-shell: launcher: rows worked out 0.6 ms (budget 2 ms)
 *   dashi-shell: launcher: files 22.9 ms (budget 80 ms)
 *
 * Off, nothing is measured and nothing is written.
 */

export const isTiming = (env: Readonly<Record<string, string | undefined>> = process.env): boolean => env.DASHI_LAUNCHER_TIMING === "1";

const ON = isTiming();

/** One timing line, when timing is on; `note` says how it was done ("resident host"). */
export function logTiming(moment: string, ms: number, budgetMs: number, note?: string): void {
  if (!ON) return;
  console.error(timingLine(moment, ms, budgetMs, note));
}

export function timingLine(moment: string, ms: number, budgetMs: number, note?: string): string {
  const over = ms > budgetMs ? ", over" : "";
  return `dashi-shell: launcher: ${moment} ${ms.toFixed(1)} ms (budget ${budgetMs} ms${over}${note ? `, ${note}` : ""})`;
}

/** The clock timing reads, or null when timing is off (so nothing is measured). */
export const timingNow = (): number | null => (ON ? performance.now() : null);
