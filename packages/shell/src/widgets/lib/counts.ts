/** The lock screen's notifications as counts by app, newest app first: words never show while locked. */

export function noticeCounts(history: readonly { appName: string; desktopEntry: string }[]): { app: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of [...history].reverse()) {
    const app = entry.appName.trim() || entry.desktopEntry || "Notifications";
    counts.set(app, (counts.get(app) ?? 0) + 1);
  }
  return [...counts].map(([app, count]) => ({ app, count }));
}
