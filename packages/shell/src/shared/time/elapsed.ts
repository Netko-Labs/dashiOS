/**
 * How long something has been going, as a timer shows it: the person's own
 * recording in the menu bar (recorder/indicator.tsx) and an agent that
 * records or sees the screen, in its row of the agents' panel
 * (agents-panel/lib/agents-rows.tsx).
 */

/** "0:07", "12:34", "1:02:03". */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
