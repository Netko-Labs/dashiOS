/**
 * Installing, updating, and removing applets from the catalog. Nothing is
 * written before the package checks against the index (size, sha256, the
 * author's signature, the installed version's key for an update, not
 * pulled: @dashi/applet's verifyPackage), and nothing runs before that: the
 * shell's launcher starts what lands in the applets folder, in its sandbox.
 * Each install records the catalog it came from (its index address) beside
 * the author key it was verified with; an update comes only from that
 * catalog, signed with that key. The kill switch is here too: a pulled
 * version that is installed is disabled, and the launcher stops it, by the
 * pulled list of the catalog it came from alone.
 */

import {
  type CatalogIndex,
  compareVersions,
  consentNames,
  type IndexApplet,
  type IndexVersion,
  type InstalledApplet,
  type InstallRecord,
  installable,
  installFiles,
  isPulled,
  type PulledVersion,
  removeInstalled,
  scanInstalled,
  sha256,
  type UnreadableApplet,
  unpack,
  verifyPackage,
  writeRecord,
} from "@dashi/applet";
import { installedFrom, type StoreApplet } from "./merge.ts";

export interface InstallerOptions {
  root: string;
  dataRoot: string;
  dashiVersion: string;
  /** Dashi's catalog's index address: where an install record that names none came from. */
  dashiCatalog: string;
  /** A package's bytes, from the catalog at `catalog` (its hosts' rules). */
  download(url: string, size: number, catalog: string): Promise<Uint8Array>;
}

export class InstallError extends Error {}

export class AppletInstaller {
  constructor(private readonly options: InstallerOptions) {}

  installed(): InstalledApplet[] {
    return scanInstalled(this.options.root).applets;
  }

  /** What is installed, and what is installed but no longer reads (it doesn't run; it needs an update). */
  scan(): { applets: InstalledApplet[]; unreadable: UnreadableApplet[] } {
    return scanInstalled(this.options.root);
  }

  /** The catalog an installed applet came from; null for one added by hand. */
  catalogOf(applet: Pick<InstalledApplet, "record">): string | null {
    return installedFrom(applet.record, this.options.dashiCatalog);
  }

  /** The newest version of `applet` this Dashi can install, or null. */
  available(applet: IndexApplet): IndexVersion | null {
    return installable(applet, this.options.dashiVersion);
  }

  /**
   * Installs (or updates to) the newest good version, with the permissions
   * the person allowed on the consent sheet; returns the version installed.
   */
  async install(applet: StoreApplet, consent: readonly string[]): Promise<string> {
    const version = this.available(applet);
    if (!version) throw new InstallError(`${applet.manifest.name} has no version for this Dashi`);
    const current = this.installedRecord(applet.manifest.id);
    // An update comes only from the catalog the installed version came from (one installed by hand has none).
    const from = current ? this.catalogOf({ record: current }) : null;
    if (from !== null && from !== applet.from.url)
      throw new InstallError(`${applet.manifest.name} was installed from another catalog, and only that catalog can update it`);
    // An update must be signed by the key the installed version was; one installed by hand has none to match.
    const installedKey = current?.authorKey ?? undefined;
    const bytes = await this.options.download(version.url, version.size, applet.from.url);
    const checked = verifyPackage(bytes, applet, version, installedKey);
    if (checked !== true) throw new InstallError(checked.error);
    const unpacked = unpack(bytes);
    if ("error" in unpacked) throw new InstallError(unpacked.error);
    if (unpacked.manifest.id !== applet.manifest.id || unpacked.manifest.version !== version.version)
      throw new InstallError(`the package is ${unpacked.manifest.id} ${unpacked.manifest.version}, not what the index lists`);
    const asked = new Set(consentNames(unpacked.manifest));
    installFiles(this.options.root, unpacked, {
      version: version.version,
      sha256: sha256(bytes),
      authorKey: applet.authorKey,
      source: "catalog",
      catalog: applet.from.url,
      // Only what it asks for now, of what was allowed.
      consent: consent.filter((name) => asked.has(name)),
    });
    return version.version;
  }

  /**
   * The record of what is installed as `id`, read or not: an update to one
   * that no longer reads answers to its record's catalog and key all the
   * same. One whose record is damaged too can't be updated, only removed.
   */
  private installedRecord(id: string): InstallRecord | null {
    const { applets, unreadable } = this.scan();
    const mine = applets.find((each) => each.manifest.id === id);
    if (mine) return mine.record;
    const broken = unreadable.find((each) => each.id === id);
    if (broken && !broken.record) throw new InstallError(`${broken.name ?? id} can’t be read, so it can’t be updated: remove it, then get it again`);
    return broken?.record ?? null;
  }

  remove(id: string, withData = false): void {
    removeInstalled(this.options.root, id, withData ? this.options.dataRoot : undefined);
  }

  /**
   * Turns off every installed version the index of the catalog at `catalog`
   * pulled, of the applets that came from it; returns their ids. An entry
   * this Dashi can't read still pulls: its pulled list is read alone.
   */
  disablePulled(index: CatalogIndex, catalog: string): string[] {
    const pulls = (id: string): PulledVersion[] => [
      ...(index.applets.find((each) => each.manifest.id === id)?.pulled ?? []),
      ...index.skipped.filter((each) => each.id === id).flatMap((each) => each.pulled),
    ];
    const disabled: string[] = [];
    for (const applet of this.installed()) {
      if (this.catalogOf(applet) !== catalog || applet.record.disabled?.reason === "pulled") continue;
      const pull = pulls(applet.manifest.id).find((each) => each.version === applet.record.version);
      if (!pull) continue;
      const reason = pull.reason;
      writeRecord(applet.dir, { ...applet.record, disabled: { reason: "pulled", ...(reason ? { detail: reason } : {}) } });
      disabled.push(applet.manifest.id);
    }
    return disabled;
  }
}

/** What the store shows for one applet: not installed, installed (current), an update, or pulled. */
export type AppletStatus =
  | { kind: "get"; version: IndexVersion | null }
  | { kind: "installed"; installed: InstalledApplet }
  | { kind: "update"; installed: InstalledApplet; version: IndexVersion }
  | { kind: "pulled"; installed: InstalledApplet; reason: string; good: IndexVersion | null }
  /** Installed, but its files no longer read: `good` is the version that mends it, when this entry may update it. */
  | { kind: "unreadable"; unreadable: UnreadableApplet; good: IndexVersion | null };

/**
 * `entry`'s state against what is installed. One installed from another
 * catalog (or by hand) than `entry`'s is installed, never updated or pulled
 * from here: only its own catalog speaks for it.
 */
export function statusOf(
  entry: StoreApplet,
  installed: readonly InstalledApplet[],
  dashiVersion: string,
  dashiCatalog: string,
  unreadable: readonly UnreadableApplet[] = [],
): AppletStatus {
  const mine = installed.find((each) => each.manifest.id === entry.manifest.id);
  const good = installable(entry, dashiVersion);
  const broken = mine ? undefined : unreadable.find((each) => each.id === entry.manifest.id);
  if (broken) {
    // Only its own catalog mends it, and only when its record says which that is.
    const mends = broken.record !== null && installedFrom(broken.record, dashiCatalog) === entry.from.url;
    return { kind: "unreadable", unreadable: broken, good: mends ? good : null };
  }
  if (!mine) return { kind: "get", version: good };
  const from = installedFrom(mine.record, dashiCatalog);
  if (from !== null && from !== entry.from.url) {
    return mine.record.disabled?.reason === "pulled"
      ? { kind: "pulled", installed: mine, reason: mine.record.disabled.detail ?? "It was pulled from its catalog.", good: null }
      : { kind: "installed", installed: mine };
  }
  if (isPulled(entry, mine.record.version) || mine.record.disabled?.reason === "pulled") {
    const reason =
      entry.pulled.find((pull) => pull.version === mine.record.version)?.reason ?? mine.record.disabled?.detail ?? "It was pulled from the catalog.";
    return { kind: "pulled", installed: mine, reason, good: good && good.version !== mine.record.version ? good : null };
  }
  if (good && compareVersions(good.version, mine.record.version) > 0) return { kind: "update", installed: mine, version: good };
  return { kind: "installed", installed: mine };
}
