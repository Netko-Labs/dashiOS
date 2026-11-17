/**
 * The System widget's numbers: the processor's use since the last look, the
 * memory in use, and the graphics' busy share where the driver tells it
 * (amdgpu's `gpu_busy_percent`). Read every 2 s, and only while the widget
 * is on screen (the area open): nothing is read while nobody looks.
 */

import { readdirSync, readFileSync } from "node:fs";
import { Source } from "./source.ts";

export interface SystemNumbers {
  /** 0–100. */
  processor: number;
  cores: number;
  /** In GB. */
  memoryUsed: number;
  memoryTotal: number;
  /** 0–100, or null where the driver does not say. */
  graphics: number | null;
  /** The last 30 processor readings, oldest first, 0–1 (the history's dots). */
  history: readonly number[];
}

/** Busy and total jiffies from /proc/stat's first line. */
export function cpuTimes(stat: string): { busy: number; total: number } | null {
  const line = stat.split("\n").find((each) => each.startsWith("cpu "));
  if (!line) return null;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { busy: total - idle, total };
}

/** Used and total memory in GB from /proc/meminfo. */
export function memory(meminfo: string): { used: number; total: number } | null {
  const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(meminfo)?.[1] ?? Number.NaN);
  const total = kb("MemTotal");
  const available = kb("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(available)) return null;
  const gb = (value: number) => Math.round((value / 1024 / 1024) * 10) / 10;
  return { used: gb(total - available), total: gb(total) };
}

function graphicsBusy(): number | null {
  try {
    for (const card of readdirSync("/sys/class/drm")) {
      if (!/^card\d+$/.test(card)) continue;
      const value = Number(readFileSync(`/sys/class/drm/${card}/device/gpu_busy_percent`, "utf8").trim());
      if (Number.isFinite(value)) return value;
    }
  } catch {
    // No such file on this driver: the row says nothing.
  }
  return null;
}

export class SystemLoad extends Source<SystemNumbers | null> {
  private last: { busy: number; total: number } | null = null;
  private history: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private watchers = 0;

  /** A System widget came on screen: read while at least one is; the returned function says it went. */
  see(): () => void {
    this.watchers++;
    this.watch(true);
    let gone = false;
    return () => {
      if (gone) return;
      gone = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) this.watch(false);
    };
  }

  /** Reads while `seen`, every 2 s; stops when not. */
  watch(seen: boolean): void {
    if (seen && this.timer === null) {
      this.read();
      this.timer = setInterval(() => this.read(), 2000);
    } else if (!seen && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private read(): void {
    try {
      const times = cpuTimes(readFileSync("/proc/stat", "utf8"));
      const mem = memory(readFileSync("/proc/meminfo", "utf8"));
      if (!times || !mem) return;
      const share = this.last && times.total > this.last.total ? (times.busy - this.last.busy) / (times.total - this.last.total) : 0;
      this.last = times;
      this.history = [...this.history, share].slice(-30);
      const cores = readFileSync("/proc/cpuinfo", "utf8").match(/^processor\s*:/gm)?.length ?? 1;
      this.set({ processor: Math.round(share * 100), cores, memoryUsed: mem.used, memoryTotal: mem.total, graphics: graphicsBusy(), history: this.history });
    } catch {
      // A machine without /proc (a test): no numbers.
    }
  }
}
