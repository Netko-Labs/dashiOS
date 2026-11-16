/**
 * Package and source changes as jobs on the Store's one queue (queue.ts):
 * installing or removing an RPM, updating Dashi's own packages, turning a
 * source on or off. Each reads the catalog again when it ends, so every row
 * shows what is now true; Dashi's update also looks for updates again.
 */

import type { CatalogEntry, Offer, Source } from "../../../src/shared/software/index.ts";
import type { Job } from "./queue.ts";
import type { Services } from "./services.ts";

type Deps = Pick<Services, "packages" | "index" | "store">;

const reread =
  (deps: Deps): (() => void) =>
  () =>
    void deps.index.reload();

export function installPackageJob(deps: Deps, entry: CatalogEntry, offer: Offer): Job {
  return {
    operation: { key: `package:install:${offer.ref}`, kind: "install", id: offer.ref, name: entry.name, subject: "package" },
    start: (report, signal) => deps.packages.install(offer, report, signal),
    done: reread(deps),
  };
}

export function removePackageJob(deps: Deps, entry: CatalogEntry, offer: Offer): Job {
  return {
    operation: { key: `package:remove:${offer.ref}`, kind: "remove", id: offer.ref, name: entry.name, subject: "package" },
    start: (report, signal) => deps.packages.remove(offer.ref, report, signal),
    done: reread(deps),
  };
}

/** Dashi's own packages, updated alone (no password: its source is already on). */
export function updateDashiJob(deps: Deps, names: readonly string[]): Job {
  return {
    operation: { key: "dashi", kind: "system-update", name: "Dashi", subject: "package" },
    start: (report, signal) => deps.packages.updateSome(names, report, signal),
    done: () => {
      void deps.store.checkUpdates();
      void deps.index.reload();
    },
  };
}

export function sourceJob(deps: Deps, source: Source, on: boolean): Job {
  return {
    operation: { key: `source:${source.id}`, kind: "update", id: source.id, name: source.label, subject: "source" },
    start: () => deps.packages.setSource(source, on),
    done: () => {
      void deps.index.reload();
      void deps.store.checkUpdates();
    },
  };
}
