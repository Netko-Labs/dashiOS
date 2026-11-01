/**
 * Writes that follow a slider. Dragging fires many values a second and each
 * write is a process (`wpctl`, `brightnessctl`), so while one runs the newer
 * values replace each other and only the last runs next.
 */

export function latestWins<T>(write: (value: T) => Promise<unknown>): (value: T) => void {
  let running = false;
  let pending: { value: T } | null = null;
  const run = async (value: T): Promise<void> => {
    running = true;
    try {
      await write(value);
    } catch (error) {
      console.error("dashi-shell: a Control Center write failed:", error);
    }
    running = false;
    if (pending) {
      const next = pending.value;
      pending = null;
      await run(next);
    }
  };
  return (value) => {
    if (running) pending = { value };
    else void run(value);
  };
}
