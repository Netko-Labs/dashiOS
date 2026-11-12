/**
 * One write at a time per lane (an app's level, a stream's mute): while one
 * runs, a newer one replaces the one waiting, and both callers hear how the
 * newer went. So a slider's drag is a few writes, each the newest level.
 */

interface Lane {
  running: boolean;
  next: (() => Promise<boolean>) | null;
  waiters: Array<(ok: boolean) => void>;
}

export class Lanes {
  private readonly lanes = new Map<string, Lane>();

  /** Runs `work` in the lane `name` of `group`; `onIdle` hears when the lane has nothing left. */
  run(group: string, name: string, work: () => Promise<boolean>, onIdle: () => void): Promise<boolean> {
    const key = `${group}\u0000${name}`;
    const lane = this.lanes.get(key) ?? { running: false, next: null, waiters: [] };
    this.lanes.set(key, lane);
    return new Promise((resolve) => {
      lane.next = work;
      lane.waiters.push(resolve);
      if (lane.running) return;
      lane.running = true;
      void (async () => {
        while (lane.next) {
          const job = lane.next;
          const waiters = lane.waiters;
          lane.next = null;
          lane.waiters = [];
          let ok = false;
          try {
            ok = await job();
          } catch {
            ok = false;
          }
          for (const waiter of waiters) waiter(ok);
        }
        lane.running = false;
        this.lanes.delete(key);
        onIdle();
      })();
    });
  }

  /** Whether a write of `group` is running or waiting. */
  busy(group: string): boolean {
    const prefix = `${group}\u0000`;
    for (const key of this.lanes.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }
}
