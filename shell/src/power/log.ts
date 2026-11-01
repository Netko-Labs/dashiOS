/** Power is optional, so what is missing is said once and the shell goes on. */

const said = new Set<string>();

/** Logs `message` the first time `key` is seen. */
export function sayOnce(key: string, message: string, error?: unknown): void {
  if (said.has(key)) return;
  said.add(key);
  const detail = error instanceof Error ? `: ${error.message}` : error === undefined ? "" : `: ${String(error)}`;
  console.error(`dashi-shell: power: ${message}${detail}`);
}

/** Forget what was said (tests). */
export function forgetSaid(): void {
  said.clear();
}
