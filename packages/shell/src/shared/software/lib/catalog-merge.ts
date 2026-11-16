/**
 * Every source's answer folded into one row per app. An app is matched
 * across sources by its AppStream id, then by its desktop file's name
 * (Fedora's `gimp` package installs `org.gimp.GIMP.desktop`, Flathub's id is
 * `org.gimp.GIMP`). A package that isn't an app (no `application()`
 * provide) is a command-line tool, one row per package name. Offers are put
 * in the default order: installed first, then Flathub, Fedora, Terra, a COPR
 * (sources.ts, D321). Pure.
 */

import type { CatalogEntry, Offer } from "../catalog-types.ts";
import { type Source, sourceForRepo, sourceRank } from "../sources.ts";
import type { AppStreamApp } from "./appstream.ts";
import type { RpmApp, RpmPackage } from "./rpm-query.ts";

export interface MergeInput {
  sources: Source[];
  /** Flathub's catalog (only read when Flathub is on). */
  flathub: AppStreamApp[];
  /** Fedora's and RPM Fusion's AppStream data, with each app's `pkgname`; icons already turned into files. */
  rpmAppStream: AppStreamApp[];
  packages: RpmPackage[];
  rpmApps: RpmApp[];
  /** Installed RPMs: name to the repository dnf says it came from. */
  installedRpms: ReadonlyMap<string, string>;
  /** The packages the system's first transaction installed (the image's). */
  imagePackages?: ReadonlySet<string>;
  /** Installed only because another package needed them (dnf's reason): not an app the person added. */
  dependencies?: ReadonlySet<string>;
  installedFlatpaks: ReadonlySet<string>;
}

const norm = (id: string): string => id.toLowerCase();

/** `helium-browser-bin` → `Helium Browser Bin`: a name for an app whose repository has no AppStream data (Terra's, a COPR's). */
export function nameFromPackage(name: string): string {
  return name
    .replace(/-(bin|git|nightly)$/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

function offerOrder(sources: readonly Source[]): (a: Offer, b: Offer) => number {
  const rank = (offer: Offer): number => {
    const source = sources.find((each) => each.id === offer.source);
    return (offer.installed ? -10 : 0) + (source ? sourceRank(source) : 9);
  };
  return (a, b) => rank(a) - rank(b);
}

interface Builder {
  entries: Map<string, CatalogEntry>;
  /** Any id an app is known by (AppStream id, desktop id), lowercased, to its key. */
  alias: Map<string, string>;
}

function addFlathub(build: Builder, apps: readonly AppStreamApp[], installed: ReadonlySet<string>): void {
  for (const app of apps) {
    if (app.flatpak === null) continue;
    const key = `app:${norm(app.flatpak)}`;
    if (build.entries.has(key)) continue;
    build.entries.set(key, {
      key,
      kind: "app",
      name: app.name,
      summary: app.summary,
      developer: app.developer,
      icon: app.icon?.kind === "remote" ? app.icon.value : null,
      categories: app.categories,
      keywords: app.keywords,
      license: app.license,
      desktopId: app.desktopId ?? app.flatpak,
      offers: [
        {
          source: "flathub",
          kind: "flatpak",
          ref: app.flatpak,
          repoId: null,
          version: null,
          arch: null,
          verified: app.verified,
          installed: installed.has(app.flatpak),
          cameWithSystem: false,
        },
      ],
    });
    for (const id of [app.flatpak, app.id, app.desktopId]) if (id) build.alias.set(norm(id), key);
  }
}

function rpmOffers(name: string, input: MergeInput, byName: ReadonlyMap<string, RpmPackage[]>): Offer[] {
  const offers = new Map<string, Offer>();
  for (const pkg of byName.get(name) ?? []) {
    const source = sourceForRepo(input.sources, pkg.repoId);
    if (!source?.enabled) continue;
    const have = offers.get(source.id);
    // Fedora's `updates` beats `fedora`: the newer build of the same package.
    if (have && !(pkg.repoId === "updates")) continue;
    const from = input.installedRpms.get(name);
    const installed = from !== undefined && (from === pkg.repoId || sourceForRepo(input.sources, from)?.id === source.id);
    offers.set(source.id, {
      source: source.id,
      kind: "rpm",
      ref: name,
      repoId: pkg.repoId,
      version: pkg.evr,
      arch: pkg.arch,
      verified: false,
      installed,
      cameWithSystem: input.imagePackages?.has(name) ?? false,
      ...(input.dependencies?.has(name) ? { dependency: true as const } : {}),
    });
  }
  return [...offers.values()];
}

function addRpmApps(build: Builder, input: MergeInput, byName: ReadonlyMap<string, RpmPackage[]>): Set<string> {
  const meta = new Map(input.rpmAppStream.filter((app) => app.pkgname !== null).map((app) => [app.pkgname ?? "", app]));
  const used = new Set<string>();
  const seen = new Set<string>();
  for (const app of input.rpmApps) {
    if (seen.has(app.name)) continue;
    seen.add(app.name);
    const offers = rpmOffers(app.name, input, byName);
    if (offers.length === 0) continue;
    used.add(app.name);
    const stream = meta.get(app.name);
    const ids = [stream?.id, stream?.desktopId, ...app.desktopIds].filter((id): id is string => typeof id === "string");
    const found = ids.map((id) => build.alias.get(norm(id))).find((key) => key !== undefined);
    const entry = found === undefined ? undefined : build.entries.get(found);
    if (entry) {
      entry.offers.push(...offers.filter((offer) => !entry.offers.some((have) => have.source === offer.source)));
      if (entry.icon === null && stream?.icon?.kind === "cached") entry.icon = stream.icon.value;
      entry.desktopId ??= app.desktopIds[0] ?? null;
      continue;
    }
    const pkg = byName.get(app.name)?.[0];
    const key = `app:${norm(ids[0] ?? app.name)}`;
    if (build.entries.has(key)) continue;
    build.entries.set(key, {
      key,
      kind: "app",
      name: stream?.name ?? nameFromPackage(app.name),
      summary: stream?.summary ?? pkg?.summary ?? "",
      developer: stream?.developer ?? null,
      icon: stream?.icon?.kind === "cached" ? stream.icon.value : null,
      categories: stream?.categories ?? [],
      keywords: [...(stream?.keywords ?? []), app.name],
      license: stream?.license ?? null,
      desktopId: app.desktopIds[0] ?? null,
      offers,
    });
    for (const id of ids) build.alias.set(norm(id), key);
  }
  return used;
}

function addTools(build: Builder, input: MergeInput, byName: ReadonlyMap<string, RpmPackage[]>, apps: ReadonlySet<string>): void {
  for (const [name, packages] of byName) {
    if (apps.has(name)) continue;
    const offers = rpmOffers(name, input, byName);
    if (offers.length === 0) continue;
    const key = `tool:${name}`;
    build.entries.set(key, {
      key,
      kind: "tool",
      name,
      summary: packages[0]?.summary ?? "",
      developer: null,
      icon: null,
      categories: [],
      keywords: [],
      license: null,
      desktopId: null,
      offers,
    });
  }
}

/** A package installed from a file or a repository since removed (`@commandline`, `@System`): its first source counts as installed, so there are never two. */
function markUnknownOrigin(entry: CatalogEntry, installed: ReadonlyMap<string, string>): void {
  if (entry.offers.some((offer) => offer.installed)) return;
  const rpm = entry.offers.find((offer) => offer.kind === "rpm" && installed.has(offer.ref));
  if (rpm) rpm.installed = true;
}

/** One row per app and per tool, each with its offers in the default order. */
export function mergeCatalog(input: MergeInput): CatalogEntry[] {
  const build: Builder = { entries: new Map(), alias: new Map() };
  const flathubOn = input.sources.some((source) => source.kind === "flathub" && source.enabled);
  if (flathubOn) addFlathub(build, input.flathub, input.installedFlatpaks);
  const byName = new Map<string, RpmPackage[]>();
  for (const pkg of input.packages) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
  const apps = addRpmApps(build, input, byName);
  addTools(build, input, byName, apps);
  const order = offerOrder(input.sources);
  const entries = [...build.entries.values()];
  for (const entry of entries) {
    markUnknownOrigin(entry, input.installedRpms);
    entry.offers.sort(order);
  }
  return entries;
}
