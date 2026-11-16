/**
 * What the agents' software tools share: the backend (the Store's catalogs
 * and package tools, or a test's fakes), whether one of them is installing
 * or updating now (one at a time), and how long a call waits for the work.
 */

import { Catalog, CatalogError, cacheRoot, Flathub, JsonCache, Packages, Software, standIn, tidy } from "../../shared/software/index.ts";
import { type RunContext, type ToolResult, toolError } from "../context.ts";

export interface CatalogBackend {
  index: Pick<Catalog, "ready" | "search" | "entryFor">;
  packages: Pick<Packages, "install">;
}

/** What the tools need of the catalogs and the package tools; tests give fakes. */
export interface SoftwareBackend extends Partial<CatalogBackend> {
  catalog: Pick<Flathub, "search" | "details">;
  manager: Pick<Software, "installed" | "flatpakUpdates" | "systemUpdates" | "install" | "updateFlatpak" | "updateSystem" | "needsRestart">;
}

let shared: SoftwareBackend | null = null;

export function backend(ctx: RunContext): SoftwareBackend {
  if (shared === null) {
    const fake = standIn();
    const manager = new Software(fake ?? {});
    const installedFlatpaks = async (): Promise<string[]> => (manager.hasFlatpak ? (await manager.installed()).map((app) => app.id) : []);
    const run = fake?.run ? { run: fake.run } : {};
    shared = {
      catalog: new Flathub({ cache: new JsonCache(cacheRoot()) }),
      manager,
      index: new Catalog({ installedFlatpaks, ...run }),
      packages: new Packages(run),
    };
  }
  return ctx.desktop.software ?? shared;
}

/** How long a request waits for the work itself; past it the agent is told to check back. */
export const WORK_WAIT_MS = 10 * 60_000;

/** One install or update at a time, whoever asked. */
export const busy = { working: false };

export const unavailable = (error: unknown): ToolResult => {
  if (error instanceof CatalogError) return toolError(error.message);
  return toolError(error instanceof Error ? tidy(error.message, 300) : "Software could not do that.");
};

export const installedIds = async (b: SoftwareBackend): Promise<Set<string>> => {
  try {
    return new Set((await b.manager.installed()).map((app) => app.id));
  } catch {
    return new Set();
  }
};

export const person = (value: string, max = 80): string => tidy(value, max);

/** Waits for `work` up to `ms`; past it, says it carries on, so a long install doesn't hold the agent's call. */
async function within<T>(work: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ done: true as const, value })), late]);
  } finally {
    clearTimeout(timer);
  }
}

export const bounded = <T>(work: Promise<T>): Promise<{ done: true; value: T } | { done: false }> => within(work, WORK_WAIT_MS);
