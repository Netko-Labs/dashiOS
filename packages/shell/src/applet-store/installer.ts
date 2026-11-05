/**
 * Installing, updating, and removing applets from the catalog. Nothing is
 * written before the package checks against the index (size, sha256, the
 * author's signature, the installed version's key for an update, not
 * pulled: @dashi/applet's verifyPackage), and nothing runs before that: the
 * shell's launcher starts what lands in the applets folder, in its sandbox.
 * The kill switch is here too: a pulled version that is installed is
 * disabled, and the launcher stops it.
 */

import {
  type CatalogIndex,
  compareVersions,
  type IndexApplet,
  type IndexVersion,
  type InstalledApplet,
  installable,
  installFiles,
  isPulled,
  permissionName,
  readInstalled,
  removeInstalled,
  sha256,
  unpack,
  verifyPackage,
  writeRecord,
} from "@dashi/applet";

export interface InstallerOptions {
  root: string;
  dataRoot: string;
  dashiVersion: string;
  download(url: string, size: number): Promise<Uint8Array>;
}

export class InstallError extends Error {}

export class AppletInstaller {
  constructor(private readonly options: InstallerOptions) {}

  installed(): InstalledApplet[] {
    return readInstalled(this.options.root);
  }

  /** The newest version of `applet` this Dashi can install, or null. */
  available(applet: IndexApplet): IndexVersion | null {
    return installable(applet, this.options.dashiVersion);
  }

  /**
   * Installs (or updates to) the newest good version, with the permissions
   * the person allowed on the consent sheet; returns the version installed.
   */
  async install(applet: IndexApplet, consent: readonly string[]): Promise<string> {
    const version = this.available(applet);
    if (!version) throw new InstallError(`${applet.manifest.name} has no version for this Dashi`);
    const current = this.installed().find((each) => each.manifest.id === applet.manifest.id);
    // An update must be signed by the key the installed version was; one installed by hand has none to match.
    const installedKey = current?.record.authorKey ?? undefined;
    const bytes = await this.options.download(version.url, version.size);
    const checked = verifyPackage(bytes, applet, version, installedKey);
    if (checked !== true) throw new InstallError(checked.error);
    const unpacked = unpack(bytes);
    if ("error" in unpacked) throw new InstallError(unpacked.error);
    if (unpacked.manifest.id !== applet.manifest.id || unpacked.manifest.version !== version.version)
      throw new InstallError(`the package is ${unpacked.manifest.id} ${unpacked.manifest.version}, not what the index lists`);
    const asked = new Set(unpacked.manifest.permissions.map(permissionName));
    installFiles(this.options.root, unpacked, {
      version: version.version,
      sha256: sha256(bytes),
      authorKey: applet.authorKey,
      source: "catalog",
      // Only what it asks for now, of what was allowed.
      consent: consent.filter((name) => asked.has(name)),
    });
    return version.version;
  }

  remove(id: string, withData = false): void {
    removeInstalled(this.options.root, id, withData ? this.options.dataRoot : undefined);
  }

  /** Turns off every installed version the index pulled; returns their ids. */
  disablePulled(index: CatalogIndex): string[] {
    const disabled: string[] = [];
    for (const applet of this.installed()) {
      const entry = index.applets.find((each) => each.manifest.id === applet.manifest.id);
      if (!entry || !isPulled(entry, applet.record.version) || applet.record.disabled?.reason === "pulled") continue;
      const reason = entry.pulled.find((pull) => pull.version === applet.record.version)?.reason;
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
  | { kind: "pulled"; installed: InstalledApplet; reason: string; good: IndexVersion | null };

export function statusOf(entry: IndexApplet, installed: readonly InstalledApplet[], dashiVersion: string): AppletStatus {
  const mine = installed.find((each) => each.manifest.id === entry.manifest.id);
  const good = installable(entry, dashiVersion);
  if (!mine) return { kind: "get", version: good };
  if (isPulled(entry, mine.record.version) || mine.record.disabled?.reason === "pulled") {
    const reason =
      entry.pulled.find((pull) => pull.version === mine.record.version)?.reason ?? mine.record.disabled?.detail ?? "It was pulled from the catalog.";
    return { kind: "pulled", installed: mine, reason, good: good && good.version !== mine.record.version ? good : null };
  }
  if (good && compareVersions(good.version, mine.record.version) > 0) return { kind: "update", installed: mine, version: good };
  return { kind: "installed", installed: mine };
}
