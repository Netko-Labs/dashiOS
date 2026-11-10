/**
 * A picture Metal can't draw as it is, or must draw turned or smaller, is
 * made once as a PNG by ImageMagick and kept in the cache: this is that job,
 * and the PNG's size from its header. Callers asking for the same copy at the
 * same time share one run (`inflight`).
 */

import type { Format } from "../../src/shared/files/kinds.ts";
import { cacheFile, cacheKey, partialName, publish, type Stamp } from "./cache.ts";
import { CONVERT_MEMORY_MIB, CONVERT_TIMEOUT_MS, magickArgs, REDUCED_PIXELS } from "./convert.ts";
import { readSize, type Size } from "./dimensions.ts";
import { runTool } from "./tools.ts";
import { mod4 } from "./zoom.ts";

export interface ReducedJob {
  root: string;
  path: string;
  stamp: Stamp;
  format: Format;
  turns: number;
  /** The runs going on, by cache key: a caller asking for one that runs shares it. */
  inflight: Map<string, Promise<string | null>>;
}

/** The cached PNG of a picture turned `turns` quarters and reduced, made now if it isn't there; null when it can't be made. */
export async function reducedPng(job: ReducedJob): Promise<string | null> {
  const key = cacheKey(job.stamp, `img:${job.format}:${mod4(job.turns)}:${REDUCED_PIXELS}`);
  const out = cacheFile(job.root, key, "png");
  return once(job.inflight, key, async () => {
    if (await Bun.file(out).exists()) return out;
    const partial = partialName(out);
    const args = magickArgs({ format: job.format, turns: job.turns, maxPixels: REDUCED_PIXELS, output: partial });
    if (!args) return null;
    const result = await runTool(args, { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB, input: Bun.file(job.path) });
    if (!result.ok || !(await Bun.file(partial).exists())) return null;
    publish(partial, out);
    return out;
  });
}

/** Run one job per key at a time; callers asking for the same thing share it. */
function once(inflight: Map<string, Promise<string | null>>, key: string, job: () => Promise<string | null>): Promise<string | null> {
  const running = inflight.get(key);
  if (running) return running;
  const started = job().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}

/** A PNG's pixel size from its header, or null. */
export async function pngSize(path: string): Promise<Size | null> {
  try {
    const bytes = new Uint8Array(await Bun.file(path).slice(0, 32).arrayBuffer());
    return readSize("png", bytes);
  } catch {
    return null;
  }
}
