/**
 * The Store's catalog on this computer (D320): Flathub's AppStream file,
 * Fedora's and RPM Fusion's AppStream data, and dnf's cache for every
 * enabled repository (Fedora, Terra, each COPR the person enabled) as one
 * list, one row per app with every source that has it. Search is in memory
 * and offline. Each source is read on its own: one that fails or is slow
 * leaves the others' rows in place (KDE Discover's lesson), and nothing here
 * waits on the network except Flathub's daily file, which is fetched in the
 * background and only replaces what was read once it has arrived.
 *
 * Used by the Store window and by the agents' software tools.
 */

import { join } from "node:path";
import type { CatalogData, CatalogEntry, Offer, SearchResult } from "./catalog-types.ts";
import type { FetchLike } from "./fetch.ts";
import type { AppStreamApp } from "./lib/appstream.ts";
import { appStreamFile, flathubFile, systemAppStream } from "./lib/catalog-files.ts";
import { mergeCatalog } from "./lib/catalog-merge.ts";
import { searchCatalog } from "./lib/catalog-search.ts";
import { remotes } from "./lib/package-cmd.ts";
import {
  appsCommand,
  firstTransactionCommand,
  installedCommand,
  packagesCommand,
  parseApps,
  parseInstalled,
  parsePackages,
  parseRepoList,
  parseTransactionNames,
  repoListCommand,
} from "./lib/rpm-query.ts";
import { run as defaultRun, type Runner } from "./lib/run.ts";
import { cacheRoot } from "./paths.ts";
import { type Repo, type Source, sourcesFrom } from "./sources.ts";

export interface CatalogDeps {
  run?: Runner;
  fetch?: FetchLike;
  root?: string;
  now?: () => number;
  /** The Flatpak apps installed (the Store's own list); none when there is no flatpak. */
  installedFlatpaks?: () => Promise<string[]>;
  /** Fedora's catalog folder (tests point it elsewhere). */
  swcatalog?: string;
  arch?: string;
  /** Fetches the metadata of every repository that is on (`pkcon refresh`, no password): for one enabled since dnf last looked. */
  refreshMetadata?: () => Promise<boolean>;
}

/** Repositories that are on but have nothing in dnf's cache: a COPR just enabled in Terminal, before anything refreshed. */
export function emptyRepos(repos: readonly Repo[], packageRepos: ReadonlySet<string>): string[] {
  return repos.filter((repo) => repo.enabled && !packageRepos.has(repo.id) && !/-(debuginfo|source|testing)/.test(repo.id)).map((repo) => repo.id);
}

const machineArch = (): string => (process.arch === "arm64" ? "aarch64" : "x86_64");

/** `flatpak remotes --columns=name,options`: Flathub is off only when every installation that has it says `disabled`. */
export function flathubEnabled(output: string): boolean {
  const lines = output.split("\n").filter((line) => line.split(/\s+/)[0] === "flathub");
  return lines.length === 0 || lines.some((line) => !/\bdisabled\b/.test(line));
}

export class Catalog {
  private data: CatalogData | null = null;
  private loading: Promise<CatalogData> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly run: Runner;
  private readonly dir: string;
  private readonly now: () => number;
  private refreshed = false;

  constructor(private readonly deps: CatalogDeps = {}) {
    this.run = deps.run ?? defaultRun;
    this.dir = join(deps.root ?? cacheRoot(), "catalog");
    this.now = deps.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** What was read last; null before the first read finishes. */
  snapshot = (): CatalogData | null => this.data;

  /** Reads every source from this computer (a few hundred ms), then Flathub's file in the background when it is a day old. */
  load(): Promise<CatalogData> {
    this.loading ??= this.build(false).finally(() => {
      this.loading = null;
      void this.build(true).catch(() => {});
    });
    return this.loading;
  }

  /** The catalog, reading it first if it never was. */
  async ready(): Promise<CatalogData> {
    return this.data ?? (await this.load());
  }

  /** Reads everything again (after an install, a source turned on or off). */
  reload(): Promise<CatalogData> {
    return this.build(false);
  }

  search(query: string, limit?: number): SearchResult {
    return this.data === null ? { apps: [], tools: [] } : searchCatalog(this.data.entries, query, limit);
  }

  entry(key: string): CatalogEntry | undefined {
    return this.data?.entries.find((entry) => entry.key === key);
  }

  /** The row that offers this Flatpak or package (`flathub:org.x.Y`, `rpm:htop`). */
  entryFor(kind: Offer["kind"], ref: string): CatalogEntry | undefined {
    return this.data?.entries.find((entry) => entry.offers.some((offer) => offer.kind === kind && offer.ref === ref));
  }

  sources(): Source[] {
    return this.data?.sources ?? [];
  }

  private async text(command: string[]): Promise<string> {
    const result = await this.run(command, { timeoutMs: 60_000, keep: 64 * 1024 * 1024 });
    return result.code === 0 ? result.output : "";
  }

  private async flathub(network: boolean): Promise<AppStreamApp[]> {
    const file = await flathubFile(this.dir, { now: this.now(), online: network, ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}) });
    return file === null ? [] : appStreamFile(file, this.dir, "flathub");
  }

  private async build(network: boolean): Promise<CatalogData> {
    const settle = <T>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);
    const [repoText, packagesText, appsText, installedText, remoteText, flatpaks, flathub, imageText] = await Promise.all([
      settle(this.text(repoListCommand()), ""),
      settle(this.text(packagesCommand()), ""),
      settle(this.text(appsCommand()), ""),
      settle(this.text(installedCommand()), ""),
      settle(this.text(remotes()), ""),
      settle(this.deps.installedFlatpaks?.() ?? Promise.resolve([]), []),
      settle(this.flathub(network), []),
      settle(this.text(firstTransactionCommand()), ""),
    ]);
    const repos: Repo[] = parseRepoList(repoText);
    const installed = parseInstalled(installedText);
    const packages = parsePackages(packagesText, this.deps.arch ?? machineArch());
    // Once a session, on the network round: a repository with no metadata yet is fetched, then everything is read again.
    if (network && !this.refreshed && this.deps.refreshMetadata && emptyRepos(repos, new Set(packages.map((pkg) => pkg.repoId))).length > 0) {
      this.refreshed = true;
      if (await this.deps.refreshMetadata().catch(() => false)) return this.build(false);
    }
    const sources = sourcesFrom(repos, flathubEnabled(remoteText));
    let rpmAppStream: AppStreamApp[] = [];
    try {
      rpmAppStream = systemAppStream(this.dir, this.deps.swcatalog);
    } catch {
      // Fedora's catalog unreadable: package names still find the apps.
    }
    const entries = mergeCatalog({
      sources,
      flathub,
      rpmAppStream,
      packages,
      rpmApps: parseApps(appsText),
      installedRpms: installed.from,
      imagePackages: parseTransactionNames(imageText),
      installedFlatpaks: new Set(flatpaks),
    });
    // A network round that found nothing new keeps what the local read had.
    if (network && flathub.length === 0 && this.data !== null) return this.data;
    this.data = { builtAt: this.now(), sources, entries };
    for (const listener of [...this.listeners]) listener();
    return this.data;
  }
}
