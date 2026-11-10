/**
 * What the Energy tab reads beyond processor time, as data: how often a
 * process's threads went to sleep and were woken (voluntary context
 * switches, /proc/<pid>/task/<tid>/status), and how busy it kept the GPU
 * (the `drm-*` lines a DRM driver writes in /proc/<pid>/fdinfo/<fd>: amdgpu,
 * i915 and nouveau in nanoseconds per engine, xe in cycles). Pure parsers and
 * the arithmetic between two looks; read.ts does the reading.
 */

/** GPU counters per engine ("gfx", "render", "compute"): time used and, for drivers that count cycles, the cycles that passed. */
export type GpuCounters = Record<string, { used: number; total: number | null }>;

/** `voluntary_ctxt_switches` from a status file: each one a sleep the thread was later woken from. */
export function parseWakeups(status: string): number | null {
  const match = status.match(/^voluntary_ctxt_switches:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

/** One DRM file's client id and its engines' counters; null for a file that isn't a DRM client or says nothing about engines. */
export function parseDrmFdinfo(text: string): { client: string; engines: GpuCounters } | null {
  let client: string | null = null;
  const engines: GpuCounters = {};
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "drm-client-id") client = value;
    const ns = key.match(/^drm-engine-(.+)$/);
    const cycles = key.match(/^drm-cycles-(.+)$/);
    const total = key.match(/^drm-total-cycles-(.+)$/);
    const number = Number(value.split(/\s+/)[0]);
    if (!Number.isFinite(number)) continue;
    if (ns?.[1] && !ns[1].startsWith("capacity")) engines[ns[1]] = { used: number, total: engines[ns[1]]?.total ?? null };
    else if (cycles?.[1]) engines[cycles[1]] = { used: number, total: engines[cycles[1]]?.total ?? null };
    else if (total?.[1]) engines[total[1]] = { used: engines[total[1]]?.used ?? 0, total: number };
  }
  return client !== null && Object.keys(engines).length > 0 ? { client, engines } : null;
}

/** Several DRM clients of one process (each counted once, though several fds may share one) added up. */
export function sumGpu(clients: ReadonlyArray<{ client: string; engines: GpuCounters }>): GpuCounters | null {
  if (clients.length === 0) return null;
  const seen = new Set<string>();
  const sum: GpuCounters = {};
  for (const { client, engines } of clients) {
    if (seen.has(client)) continue;
    seen.add(client);
    for (const [engine, counter] of Object.entries(engines)) {
      const before = sum[engine];
      sum[engine] = {
        used: (before?.used ?? 0) + counter.used,
        total: counter.total === null ? (before?.total ?? null) : (before?.total ?? 0) + counter.total,
      };
    }
  }
  return sum;
}

/**
 * Percent of the GPU kept busy between two looks `seconds` apart: the
 * busiest engine's share of the time (or of the cycles). Null when either
 * look has no counters.
 */
export function gpuPercent(before: GpuCounters | null, after: GpuCounters | null, seconds: number): number | null {
  if (!before || !after || seconds <= 0) return null;
  let busiest = 0;
  for (const [engine, now] of Object.entries(after)) {
    const then = before[engine];
    if (!then) continue;
    const used = Math.max(0, now.used - then.used);
    const span = now.total !== null && then.total !== null ? now.total - then.total : seconds * 1e9;
    if (span > 0) busiest = Math.max(busiest, used / span);
  }
  return Math.min(busiest, 1) * 100;
}

/**
 * A process's energy impact: the share of a core it keeps busy, plus the
 * share of the GPU, plus its wakeups (each wakes a sleeping core; 20 a second
 * are counted as one percent of a core). A relative number for ordering apps,
 * not watts: Linux doesn't say what one process draws.
 */
export function energyImpact(cpu: number, gpu: number | null, wakeupsPerSecond: number | null): number {
  return cpu + (gpu ?? 0) + (wakeupsPerSecond ?? 0) / WAKEUPS_PER_POINT;
}

export const WAKEUPS_PER_POINT = 20;
